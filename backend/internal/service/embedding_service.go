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
	// DefaultJinaEndpoint is the Jina AI embeddings endpoint. We migrated off
	// HuggingFace serverless because it dropped CLIP image embeddings entirely
	// (every model returned 400 "Model not supported by provider hf-inference").
	// Override via config.Config.JinaEndpoint / SetEndpoint if Jina migrates.
	DefaultJinaEndpoint = "https://api.jina.ai/v1/embeddings"

	// jinaModel is the multimodal CLIP model. jinaDimensions uses Matryoshka
	// truncation to 512 so the output matches the existing pgvector(512) column
	// (no schema migration vs the previous openai/clip-vit-base-patch32).
	jinaModel      = "jina-clip-v2"
	jinaDimensions = 512
	embeddingModelVer = "jina-clip-v2"

	embeddingTimeout = 30 * time.Second
)

// EmbeddingService genera y gestiona los vectores CLIP para las fotos de mascotas perdidas o callejeras.
// Se suscribe a cuatro eventos del EventBus: photo.uploaded, pet.lost, pet.stray, pet.found.
type EmbeddingService struct {
	embeddingRepo repository.PetEmbeddingRepository
	petRepo       repository.PetRepository
	photoRepo     repository.PhotoRepository
	apiKey        string
	endpoint      string
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
		apiKey:        apiKey,
		endpoint:      DefaultJinaEndpoint,
		httpClient:    &http.Client{Timeout: embeddingTimeout},
		logger:        logger,
	}
}

// SetEndpoint overrides the embeddings endpoint used by this service.
// Intended for production wiring only — call from router setup when
// config.Config.JinaEndpoint is set (e.g. after a future Jina API migration).
func (s *EmbeddingService) SetEndpoint(endpoint string) {
	s.endpoint = endpoint
}

// SetHTTPClientAndEndpoint replaces the HTTP client and endpoint used by this
// service. Intended for testing only — allows injecting a mock HTTP server.
func (s *EmbeddingService) SetHTTPClientAndEndpoint(client *http.Client, endpoint string) {
	s.httpClient = client
	s.endpoint = endpoint
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
		ModelVer:  embeddingModelVer,
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
	s.backfillEmbeddingsForPet(context.Background(), ev.PetID, "HandlePetLost")
}

// HandlePetStray genera embeddings para TODAS las fotos existentes de una mascota
// callejera recién creada (pet.stray, publicado desde CreatePet). En la práctica
// suele ser un no-op porque la mascota todavía no tiene fotos en ese momento;
// las fotos subidas después se indexan vía HandlePhotoUploaded.
func (s *EmbeddingService) HandlePetStray(ev event.PetStrayEvent) {
	s.backfillEmbeddingsForPet(context.Background(), ev.PetID, "HandlePetStray")
}

// backfillEmbeddingsForPet generates and upserts embeddings for every existing
// photo of the given pet. Shared by HandlePetLost and HandlePetStray — both
// transitions make a pet eligible for image search and require backfilling
// embeddings for photos uploaded before the transition.
//
// Returns the number of photos successfully indexed and the number that failed
// (either the embedding call or the upsert). The async event handlers ignore
// the counts; BackfillAll aggregates them.
func (s *EmbeddingService) backfillEmbeddingsForPet(ctx context.Context, petID uuid.UUID, callerName string) (indexed, failed int) {
	photos, err := s.photoRepo.FindByPetID(petID.String())
	if err != nil {
		s.logger.Warn(fmt.Sprintf("[embedding] %s: no se pudieron obtener las fotos", callerName),
			zap.String("pet_id", petID.String()),
			zap.Error(err),
		)
		return 0, 0
	}

	for _, photo := range photos {
		vector, err := s.GenerateEmbeddingFromURL(ctx, photo.URL)
		if err != nil {
			s.logger.Warn(fmt.Sprintf("[embedding] %s: fallo al generar embedding para foto", callerName),
				zap.String("pet_id", petID.String()),
				zap.String("photo_id", photo.ID.String()),
				zap.Error(err),
			)
			failed++
			continue // el resto de las fotos deben procesarse igual
		}

		emb := &domain.PetEmbedding{
			PetID:     petID,
			PhotoID:   photo.ID,
			ModelVer:  embeddingModelVer,
			Embedding: pgvector.NewVector(vector),
		}

		if err := s.embeddingRepo.Upsert(ctx, emb); err != nil {
			s.logger.Warn(fmt.Sprintf("[embedding] %s: fallo al persistir embedding", callerName),
				zap.String("pet_id", petID.String()),
				zap.String("photo_id", photo.ID.String()),
				zap.Error(err),
			)
			failed++
			continue
		}
		indexed++
	}
	return indexed, failed
}

// BackfillResult summarizes a full embeddings backfill run.
type BackfillResult struct {
	PetsScanned   int `json:"pets_scanned"`
	PhotosIndexed int `json:"photos_indexed"`
	PhotosFailed  int `json:"photos_failed"`
}

// BackfillAll re-generates embeddings for every image-search-eligible pet
// (status lost or stray) and all of their photos. It exists because pre-existing
// pets were never indexed: their backfill ran under the dead HuggingFace provider
// (every call 400'd) and the events that trigger indexing (pet.lost, pet.stray,
// photo.uploaded) only fire on new transitions, never retroactively.
//
// This is a one-off, idempotent maintenance operation (Upsert overwrites by
// pet_id + photo_id), exposed via a token-gated admin endpoint. It runs
// synchronously and paginates through all eligible pets.
func (s *EmbeddingService) BackfillAll(ctx context.Context) BackfillResult {
	var result BackfillResult
	const pageSize = 100

	for page := 1; ; page++ {
		pets, _, err := s.petRepo.Search(domain.PetSearchCriteria{
			Statuses: domain.FeedVisibleStatuses, // lost + stray
			Page:     page,
			Limit:    pageSize,
		})
		if err != nil {
			s.logger.Error("[embedding] BackfillAll: fallo al enumerar mascotas",
				zap.Int("page", page),
				zap.Error(err),
			)
			break
		}
		if len(pets) == 0 {
			break
		}

		for _, pet := range pets {
			indexed, failed := s.backfillEmbeddingsForPet(ctx, pet.ID, "BackfillAll")
			result.PetsScanned++
			result.PhotosIndexed += indexed
			result.PhotosFailed += failed
		}

		if len(pets) < pageSize {
			break // last page
		}
	}

	s.logger.Info("[embedding] BackfillAll: completado",
		zap.Int("pets_scanned", result.PetsScanned),
		zap.Int("photos_indexed", result.PhotosIndexed),
		zap.Int("photos_failed", result.PhotosFailed),
	)
	return result
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
// Retorna error en caso de fallo de red o respuesta no-2xx de Jina.
// Los callers async (handlers de eventos) suprimen el error. El caller sync (SearchSimilar)
// debe surfacearlo como HTTP 503.
func (s *EmbeddingService) GenerateEmbedding(ctx context.Context, imageBytes []byte) ([]float32, error) {
	mime := http.DetectContentType(imageBytes)
	encoded := base64.StdEncoding.EncodeToString(imageBytes)
	dataURI := fmt.Sprintf("data:%s;base64,%s", mime, encoded)
	return s.callEmbedding(ctx, dataURI)
}

// GenerateEmbeddingFromURL genera un vector CLIP desde una URL pública (ej: Cloudinary).
func (s *EmbeddingService) GenerateEmbeddingFromURL(ctx context.Context, imageURL string) ([]float32, error) {
	return s.callEmbedding(ctx, imageURL)
}

// SearchSimilar genera un embedding a partir de bytes de imagen y retorna las mascotas
// perdidas más similares ordenadas por distancia coseno ascendente.
func (s *EmbeddingService) SearchSimilar(ctx context.Context, imageBytes []byte, limit int) ([]domain.ImageSearchResult, error) {
	vector, err := s.GenerateEmbedding(ctx, imageBytes)
	if err != nil {
		// Sync path: surface the underlying provider error in the logs before the
		// handler maps it to a generic 503. Without this the real cause is lost.
		s.logger.Warn("[embedding] SearchSimilar: fallo al generar embedding de la query", zap.Error(err))
		return nil, err
	}
	return s.embeddingRepo.FindSimilar(ctx, vector, limit)
}

// jinaImageInput is one element of the Jina embeddings "input" array.
// The "image" value accepts a public URL, raw base64, or a data URI.
type jinaImageInput struct {
	Image string `json:"image"`
}

type jinaEmbeddingRequest struct {
	Model      string           `json:"model"`
	Dimensions int              `json:"dimensions"`
	Input      []jinaImageInput `json:"input"`
}

type jinaEmbeddingResponse struct {
	Data []struct {
		Embedding []float32 `json:"embedding"`
	} `json:"data"`
}

// callEmbedding llama a la API de embeddings de Jina (jina-clip-v2) con el valor dado
// como imagen. Acepta tanto URLs públicas como data URIs / base64.
func (s *EmbeddingService) callEmbedding(ctx context.Context, image string) ([]float32, error) {
	body, err := json.Marshal(jinaEmbeddingRequest{
		Model:      jinaModel,
		Dimensions: jinaDimensions,
		Input:      []jinaImageInput{{Image: image}},
	})
	if err != nil {
		return nil, fmt.Errorf("embedding: marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("embedding: build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+s.apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("embedding: Jina request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("embedding: Jina returned %d: %s", resp.StatusCode, string(bodyBytes))
	}

	respBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("embedding: read response: %w", err)
	}

	var parsed jinaEmbeddingResponse
	if err := json.Unmarshal(respBytes, &parsed); err != nil {
		return nil, fmt.Errorf("embedding: parse response body: %w", err)
	}
	if len(parsed.Data) == 0 || len(parsed.Data[0].Embedding) == 0 {
		return nil, fmt.Errorf("embedding: empty embedding in Jina response")
	}
	return parsed.Data[0].Embedding, nil
}
