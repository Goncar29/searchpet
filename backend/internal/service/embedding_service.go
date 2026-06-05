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

	"github.com/pgvector/pgvector-go"
	"go.uber.org/zap"
	"lost-pets/internal/domain"
	"lost-pets/internal/event"
	"lost-pets/internal/repository"
)

const (
	hfCLIPEndpoint = "https://api-inference.huggingface.co/pipeline/feature-extraction/openai/clip-vit-base-patch32"
	hfTimeout      = 30 * time.Second
)

// EmbeddingService genera y gestiona los vectores CLIP para las fotos de mascotas perdidas.
// Se suscribe a tres eventos del EventBus: photo.uploaded, pet.lost, pet.found.
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
		hfEndpoint:    hfCLIPEndpoint,
		httpClient:    &http.Client{Timeout: hfTimeout},
		logger:        logger,
	}
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
// pero solo si la mascota tiene status = "lost". Si el status es otro, retorna silenciosamente.
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

	if pet.Status != "lost" {
		return // No indexamos fotos de mascotas que no están perdidas
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
	ctx := context.Background()

	photos, err := s.photoRepo.FindByPetID(ev.PetID.String())
	if err != nil {
		s.logger.Warn("[embedding] HandlePetLost: no se pudieron obtener las fotos",
			zap.String("pet_id", ev.PetID.String()),
			zap.Error(err),
		)
		return
	}

	for _, photo := range photos {
		vector, err := s.GenerateEmbeddingFromURL(ctx, photo.URL)
		if err != nil {
			s.logger.Warn("[embedding] HandlePetLost: fallo al generar embedding para foto",
				zap.String("pet_id", ev.PetID.String()),
				zap.String("photo_id", photo.ID.String()),
				zap.Error(err),
			)
			continue // el resto de las fotos deben procesarse igual
		}

		emb := &domain.PetEmbedding{
			PetID:     ev.PetID,
			PhotoID:   photo.ID,
			ModelVer:  "clip-vit-base-patch32",
			Embedding: pgvector.NewVector(vector),
		}

		if err := s.embeddingRepo.Upsert(ctx, emb); err != nil {
			s.logger.Warn("[embedding] HandlePetLost: fallo al persistir embedding",
				zap.String("pet_id", ev.PetID.String()),
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
