package service

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/pgvector/pgvector-go"
	"go.uber.org/zap"
	"lost-pets/internal/domain"
	"lost-pets/internal/event"
	"lost-pets/internal/repository"
)

const (
	// DefaultHFCLIPEndpoint is the HuggingFace router endpoint for the CLIP
	// feature-extraction pipeline. HuggingFace migrated away from the legacy
	// api-inference.huggingface.co domain (no longer resolves) to the router.
	// Override via config.Config.HFEndpoint / SetEndpoint if HF migrates again.
	DefaultHFCLIPEndpoint = "https://router.huggingface.co/hf-inference/models/openai/clip-vit-base-patch32/pipeline/feature-extraction"
	hfTimeout             = 30 * time.Second
)

// EmbeddingService genera y gestiona los vectores CLIP para las fotos de mascotas perdidas o callejeras.
// Se suscribe a cuatro eventos del EventBus: photo.uploaded, pet.lost, pet.stray, pet.found.
type EmbeddingService struct {
	embeddingRepo repository.PetEmbeddingRepository
	petRepo       repository.PetRepository
	photoRepo     repository.PhotoRepository
	hfAPIKey      string
	hfEndpoint    string
	httpClient    *http.Client
	logger        *zap.Logger
}

// NewEmbeddingService construye el servicio con sus dependencias.
func NewEmbeddingService(
	embeddingRepo repository.PetEmbeddingRepository,
	petRepo repository.PetRepository,
	photoRepo repository.PhotoRepository,
	apiKey string,
) *EmbeddingService {
	logger, _ := zap.NewProduction()
	return &EmbeddingService{
		embeddingRepo: embeddingRepo,
		petRepo:       petRepo,
		photoRepo:     photoRepo,
		hfAPIKey:      apiKey,
		hfEndpoint:    DefaultHFCLIPEndpoint,
		httpClient:    &http.Client{Timeout: hfTimeout},
		logger:        logger,
	}
}

// SetEndpoint overrides the HuggingFace CLIP endpoint used by this service.
// Intended for production wiring only — call from router setup when
// config.Config.HFEndpoint is set (e.g. after a future HF API migration).
func (s *EmbeddingService) SetEndpoint(endpoint string) {
	s.hfEndpoint = endpoint
}

// SetHTTPClientAndEndpoint replaces the HTTP client and HF endpoint used by this
// service. Intended for testing only — allows injecting a mock HTTP server.
func (s *EmbeddingService) SetHTTPClientAndEndpoint(client *http.Client, endpoint string) {
	s.httpClient = client
	s.hfEndpoint = endpoint
}

// RegisterListeners suscribe el servicio a los eventos relevantes del EventBus.
func (s *EmbeddingService) RegisterListeners(bus *event.EventBus) {
	bus.Subscribe("photo.uploaded", func(payload interface{}) {
		ev, ok := payload.(event.PhotoUploadedEvent)
		if !ok {
			s.logger.Warn("[embedding] payload inesperado en photo.uploaded")
			return
		}
		s.HandlePhotoUploaded(ev)
	})

	bus.Subscribe("pet.lost", func(payload interface{}) {
		ev, ok := payload.(event.PetLostEvent)
		if !ok {
			s.logger.Warn("[embedding] payload inesperado en pet.lost")
			return
		}
		s.HandlePetLost(ev)
	})

	bus.Subscribe("pet.stray", func(payload interface{}) {
		ev, ok := payload.(event.PetStrayEvent)
		if !ok {
			s.logger.Warn("[embedding] payload inesperado en pet.stray")
			return
		}
		s.HandlePetStray(ev)
	})

	bus.Subscribe("pet.found", func(payload interface{}) {
		ev, ok := payload.(event.PetFoundEvent)
		if !ok {
			s.logger.Warn("[embedding] payload inesperado en pet.found")
			return
		}
		s.HandlePetFound(ev)
	})
}

// HandlePhotoUploaded genera y persiste el embedding de una foto recién subida,
// pero solo si la mascota tiene status = "lost" o "stray". Si el status es otro, retorna silenciosamente.
func (s *EmbeddingService) HandlePhotoUploaded(ev event.PhotoUploadedEvent) {
	ctx := context.Background()

	pet, err := s.petRepo.FindByID(ev.PetID.String())
	if err != nil {
		s.logger.Warn("[embedding] HandlePhotoUploaded: no se encontró la mascota",
			zap.String("pet_id", ev.PetID.String()),
			zap.Error(err),
		)
		return
	}

	if pet.Status != domain.PetStatusLost && pet.Status != domain.PetStatusStray {
		return // Only index photos for lost or stray pets
	}

	vector, err := s.GenerateEmbeddingFromURL(ctx, ev.SecureURL)
	if err != nil {
		s.logger.Warn("[embedding] HandlePhotoUploaded: fallo al generar embedding",
			zap.String("pet_id", ev.PetID.String()),
			zap.String("photo_id", ev.PhotoID.String()),
			zap.Error(err),
		)
		return
	}

	emb := &domain.PetEmbedding{
		PetID:     ev.PetID,
		PhotoID:   ev.PhotoID,
		ModelVer:  "clip-vit-base-patch32",
		Embedding: pgvector.NewVector(vector),
	}

	if err := s.embeddingRepo.Upsert(ctx, emb); err != nil {
		s.logger.Warn("[embedding] HandlePhotoUploaded: fallo al persistir embedding",
			zap.String("pet_id", ev.PetID.String()),
			zap.Error(err),
		)
	}
}

// HandlePetLost genera embeddings para TODAS las fotos existentes de una mascota
// que acaba de cambiar su status a "lost".
func (s *EmbeddingService) HandlePetLost(ev event.PetLostEvent) {
	s.backfillEmbeddingsForPet(ev.PetID, "HandlePetLost")
}

// HandlePetStray genera embeddings para TODAS las fotos existentes de una mascota
// callejera recién creada (pet.stray, publicado desde CreatePet). En la práctica
// suele ser un no-op porque la mascota todavía no tiene fotos en ese momento;
// las fotos subidas después se indexan vía HandlePhotoUploaded.
func (s *EmbeddingService) HandlePetStray(ev event.PetStrayEvent) {
	s.backfillEmbeddingsForPet(ev.PetID, "HandlePetStray")
}

// backfillEmbeddingsForPet generates and upserts embeddings for every existing
// photo of the given pet. Shared by HandlePetLost and HandlePetStray — both
// transitions make a pet eligible for image search and require backfilling
// embeddings for photos uploaded before the transition.
func (s *EmbeddingService) backfillEmbeddingsForPet(petID uuid.UUID, callerName string) {
	ctx := context.Background()

	photos, err := s.photoRepo.FindByPetID(petID.String())
	if err != nil {
		s.logger.Warn(fmt.Sprintf("[embedding] %s: no se pudieron obtener las fotos", callerName),
			zap.String("pet_id", petID.String()),
			zap.Error(err),
		)
		return
	}

	for _, photo := range photos {
		vector, err := s.GenerateEmbeddingFromURL(ctx, photo.URL)
		if err != nil {
			s.logger.Warn(fmt.Sprintf("[embedding] %s: fallo al generar embedding para foto", callerName),
				zap.String("pet_id", petID.String()),
				zap.String("photo_id", photo.ID.String()),
				zap.Error(err),
			)
			continue // el resto de las fotos deben procesarse igual
		}

		emb := &domain.PetEmbedding{
			PetID:     petID,
			PhotoID:   photo.ID,
			ModelVer:  "clip-vit-base-patch32",
			Embedding: pgvector.NewVector(vector),
		}

		if err := s.embeddingRepo.Upsert(ctx, emb); err != nil {
			s.logger.Warn(fmt.Sprintf("[embedding] %s: fallo al persistir embedding", callerName),
				zap.String("pet_id", petID.String()),
				zap.String("photo_id", photo.ID.String()),
				zap.Error(err),
			)
		}
	}
}

// HandlePetFound elimina todos los embeddings de la mascota cuando es marcada como encontrada.
func (s *EmbeddingService) HandlePetFound(ev event.PetFoundEvent) {
	ctx := context.Background()

	if err := s.embeddingRepo.DeleteByPetID(ctx, ev.PetID); err != nil {
		s.logger.Warn("[embedding] HandlePetFound: fallo al eliminar embeddings",
			zap.String("pet_id", ev.PetID.String()),
			zap.Error(err),
		)
	}
}

// GenerateEmbedding genera un vector CLIP de 512 dimensiones a partir de bytes de imagen.
// Retorna error en caso de fallo de red o respuesta no-2xx de HuggingFace.
// Los callers async (handlers de eventos) suprimen el error. El caller sync (SearchByImage)
// debe surfacearlo como HTTP 503.
func (s *EmbeddingService) GenerateEmbedding(ctx context.Context, imageBytes []byte) ([]float32, error) {
	mime := http.DetectContentType(imageBytes)
	encoded := base64.StdEncoding.EncodeToString(imageBytes)
	dataURI := fmt.Sprintf("data:%s;base64,%s", mime, encoded)
	return s.callHFEmbedding(ctx, dataURI)
}

// GenerateEmbeddingFromURL genera un vector CLIP desde una URL pública (ej: Cloudinary).
func (s *EmbeddingService) GenerateEmbeddingFromURL(ctx context.Context, imageURL string) ([]float32, error) {
	return s.callHFEmbedding(ctx, imageURL)
}

// SearchSimilar genera un embedding a partir de bytes de imagen y retorna las mascotas
// perdidas más similares ordenadas por distancia coseno ascendente.
func (s *EmbeddingService) SearchSimilar(ctx context.Context, imageBytes []byte, limit int) ([]domain.ImageSearchResult, error) {
	vector, err := s.GenerateEmbedding(ctx, imageBytes)
	if err != nil {
		return nil, err
	}
	return s.embeddingRepo.FindSimilar(ctx, vector, limit)
}

// callHFEmbedding llama a la HF Inference API con el valor dado como "inputs".
// Acepta tanto URLs públicas como data URIs base64.
func (s *EmbeddingService) callHFEmbedding(ctx context.Context, inputs string) ([]float32, error) {
	body, err := json.Marshal(map[string]string{"inputs": inputs})
	if err != nil {
		return nil, fmt.Errorf("embedding: marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.hfEndpoint, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("embedding: build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+s.hfAPIKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("embedding: HF request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("embedding: HF returned %d: %s", resp.StatusCode, string(bodyBytes))
	}

	respBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("embedding: read response: %w", err)
	}

	// HF feature-extraction devuelve [][]float32 — tomamos response[0]
	var nested [][]float32
	if err := json.Unmarshal(respBytes, &nested); err == nil && len(nested) > 0 {
		return nested[0], nil
	}

	// Algunas versiones del pipeline devuelven []float32 directamente
	var flat []float32
	if err := json.Unmarshal(respBytes, &flat); err != nil {
		return nil, fmt.Errorf("embedding: parse response body: %w", err)
	}
	return flat, nil
}
