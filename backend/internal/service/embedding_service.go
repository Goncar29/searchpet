package service

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image"
	"image/jpeg"
	_ "image/png" // register PNG decoder for image.Decode
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/pgvector/pgvector-go"
	"go.uber.org/zap"
	xdraw "golang.org/x/image/draw"
	_ "golang.org/x/image/webp" // register WebP decoder (Android share-sheet format)
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
	jinaModel         = "jina-clip-v2"
	jinaDimensions    = 512
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
//
// Los tres eventos de INDEXADO (photo.uploaded, pet.lost, pet.stray) se
// suscriben SINCRÓNICAMENTE (SubscribeSync): corren inline dentro del request
// que los publica. Esto es deliberado — en el free tier de Render el instance se
// suspende tras el response y mata las goroutines fire-and-forget, dejando el
// embedding sin generar (sin INSERT y sin log). Corriendo dentro del request, el
// trabajo termina mientras el instance sigue vivo. Cada handler es best-effort:
// loguea el fallo y nunca rompe la operación que lo dispara.
//
// pet.found (borrado de embeddings) queda ASÍNCRONO: si falla, lo único que pasa
// es que una mascota encontrada sigue apareciendo en la búsqueda hasta el próximo
// reindex — benigno, no justifica bloquear el request.
func (s *EmbeddingService) RegisterListeners(bus *event.EventBus) {
	bus.SubscribeSync("photo.uploaded", func(payload interface{}) {
		ev, ok := payload.(event.PhotoUploadedEvent)
		if !ok {
			s.logger.Warn("[embedding] payload inesperado en photo.uploaded")
			return
		}
		s.HandlePhotoUploaded(ev)
	})

	bus.SubscribeSync("pet.lost", func(payload interface{}) {
		ev, ok := payload.(event.PetLostEvent)
		if !ok {
			s.logger.Warn("[embedding] payload inesperado en pet.lost")
			return
		}
		s.HandlePetLost(ev)
	})

	bus.SubscribeSync("pet.stray", func(payload interface{}) {
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
	data, mime := downscaleForEmbedding(imageBytes)
	encoded := base64.StdEncoding.EncodeToString(data)
	dataURI := fmt.Sprintf("data:%s;base64,%s", mime, encoded)
	return s.callEmbedding(ctx, dataURI)
}

// maxEmbeddingImageDim caps the longest side of an image before it is sent to
// Jina. CLIP runs at low resolution (jina-clip-v2's native size), so a full
// multi-megapixel phone photo wastes an enormous number of image tokens — enough
// that two searches within a minute trip Jina's free-tier per-minute token cap
// (429 RATE_TOKEN_LIMIT_EXCEEDED). Capping the longest side keeps each request
// cheap without hurting match quality.
const maxEmbeddingImageDim = 512

// maxEmbeddingPixels caps the total pixels we are willing to decode. image.Decode
// allocates W*H*4 bytes up front from the header-declared dimensions BEFORE
// decompressing pixel data, so a tiny but malicious file declaring e.g.
// 20000x20000 would OOM the process (Render free tier is 512 MB). ~32 MP covers
// every realistic phone photo while bounding the allocation to ~128 MB.
const maxEmbeddingPixels = 32 * 1024 * 1024

// exceedsPixelCap reports whether an image of these declared dimensions is too
// large to safely decode (or has invalid dimensions).
func exceedsPixelCap(w, h int) bool {
	if w <= 0 || h <= 0 {
		return true
	}
	return int64(w)*int64(h) > maxEmbeddingPixels
}

// downscaleForEmbedding decodes the image and, when its longest side exceeds
// maxEmbeddingImageDim, scales it down (preserving aspect ratio) and re-encodes
// it as JPEG. It returns the bytes to send and their MIME type. On any decode or
// encode failure — or when the declared size is too large to decode safely — it
// falls back to the original bytes so resizing never becomes a new failure mode.
func downscaleForEmbedding(imageBytes []byte) (data []byte, mime string) {
	// Read only the header first; reject decompression-bomb dimensions before any
	// large pixel-buffer allocation.
	cfg, _, err := image.DecodeConfig(bytes.NewReader(imageBytes))
	if err != nil || exceedsPixelCap(cfg.Width, cfg.Height) {
		return imageBytes, http.DetectContentType(imageBytes)
	}

	src, _, err := image.Decode(bytes.NewReader(imageBytes))
	if err != nil {
		return imageBytes, http.DetectContentType(imageBytes)
	}

	b := src.Bounds()
	w, h := b.Dx(), b.Dy()
	longest := w
	if h > longest {
		longest = h
	}
	if longest <= maxEmbeddingImageDim {
		return imageBytes, http.DetectContentType(imageBytes)
	}

	// Integer math keeps the scaled dimensions exact and aspect-preserving.
	// Clamp to >= 1 so an extreme aspect ratio (> 512:1) can't round a side to 0
	// and produce a degenerate, unusable image.
	nw := w * maxEmbeddingImageDim / longest
	nh := h * maxEmbeddingImageDim / longest
	if nw < 1 {
		nw = 1
	}
	if nh < 1 {
		nh = 1
	}

	dst := image.NewRGBA(image.Rect(0, 0, nw, nh))
	// Fill white first: JPEG has no alpha, so transparent source regions would
	// otherwise be encoded as black. Compositing over white preserves them.
	xdraw.Draw(dst, dst.Bounds(), image.White, image.Point{}, xdraw.Src)
	xdraw.CatmullRom.Scale(dst, dst.Bounds(), src, b, xdraw.Over, nil)

	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, dst, &jpeg.Options{Quality: 85}); err != nil {
		return imageBytes, http.DetectContentType(imageBytes)
	}
	return buf.Bytes(), "image/jpeg"
}

// GenerateEmbeddingFromURL genera un vector CLIP desde una URL pública (ej: Cloudinary).
// La URL se pasa por cloudinaryDownscaleURL para que Jina reciba una imagen acotada
// a 512px en vez del original full-res (ver cloudinaryDownscaleURL).
func (s *EmbeddingService) GenerateEmbeddingFromURL(ctx context.Context, imageURL string) ([]float32, error) {
	return s.callEmbedding(ctx, cloudinaryDownscaleURL(imageURL))
}

// cloudinaryTransform downscales the indexed image to a 512px-bounded, quality-
// optimized image. The search path already downscales the uploaded query bytes
// to 512px; this keeps the INDEX path symmetric AND small.
const cloudinaryTransform = "c_limit,w_512,h_512,q_auto"

// cloudinaryUploadSegment marks where Cloudinary delivery transformations go in a
// delivery URL: .../image/upload/<transforms>/v123/path.
const cloudinaryUploadSegment = "/image/upload/"

// cloudinaryDownscaleURL inserts a downscale transformation into a Cloudinary
// delivery URL so the image Jina fetches is small. The index path sends a URL
// straight to Jina, which would otherwise fetch the full-resolution original —
// token-heavy enough that a burst (e.g. publishing several photos in a minute,
// now that indexing runs synchronously) can trip Jina's free-tier per-minute
// token cap (429 RATE_TOKEN_LIMIT_EXCEEDED). Cloudinary applies the resize on its
// side (cached), so our backend adds no fetch or CPU.
//
// It only rewrites URLs of the exact shape PhotoService produces
// (.../image/upload/v<digits>/...): a version segment guarantees no transformation
// is present yet, so we never double-transform or corrupt a hand-built URL. Any
// other URL (non-Cloudinary, or already transformed) is returned unchanged.
func cloudinaryDownscaleURL(imageURL string) string {
	idx := strings.Index(imageURL, cloudinaryUploadSegment)
	if idx == -1 {
		return imageURL
	}
	insertAt := idx + len(cloudinaryUploadSegment)
	rest := imageURL[insertAt:]
	if !isCloudinaryVersionSegment(rest) {
		return imageURL
	}
	return imageURL[:insertAt] + cloudinaryTransform + "/" + rest
}

// isCloudinaryVersionSegment reports whether rest starts with a Cloudinary
// version segment: "v" + one or more digits + "/".
func isCloudinaryVersionSegment(rest string) bool {
	if len(rest) < 2 || rest[0] != 'v' {
		return false
	}
	i := 1
	for i < len(rest) && rest[i] >= '0' && rest[i] <= '9' {
		i++
	}
	return i > 1 && i < len(rest) && rest[i] == '/'
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
