// Package service_test — downscale tests for EmbeddingService.
// Large images are resized before being sent to Jina so a single search stays
// well under the free-tier token-per-minute rate limit (RATE_TOKEN_LIMIT_EXCEEDED).
package service_test

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"lost-pets/internal/service"
)

// makeJPEG builds a solid JPEG of the given dimensions for downscale tests.
func makeJPEG(t *testing.T, w, h int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.Set(x, y, color.RGBA{uint8(x % 256), uint8(y % 256), 100, 255})
		}
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, nil); err != nil {
		t.Fatalf("encode test jpeg: %v", err)
	}
	return buf.Bytes()
}

// decodeJinaImageDims pulls the data-URI image out of a captured Jina request
// body and returns its pixel dimensions.
func decodeJinaImageDims(t *testing.T, body []byte) (int, int) {
	t.Helper()
	var req struct {
		Input []struct {
			Image string `json:"image"`
		} `json:"input"`
	}
	if err := json.Unmarshal(body, &req); err != nil {
		t.Fatalf("decode request body: %v", err)
	}
	if len(req.Input) != 1 {
		t.Fatalf("expected 1 input, got %d", len(req.Input))
	}
	raw := req.Input[0].Image
	if i := strings.Index(raw, ","); i >= 0 {
		raw = raw[i+1:] // strip the "data:<mime>;base64," prefix
	}
	dec, err := base64.StdEncoding.DecodeString(raw)
	if err != nil {
		t.Fatalf("base64 decode: %v", err)
	}
	cfg, _, err := image.DecodeConfig(bytes.NewReader(dec))
	if err != nil {
		t.Fatalf("decode image config: %v", err)
	}
	return cfg.Width, cfg.Height
}

// capturingJinaServer returns an httptest server that records the dimensions of
// the image sent in the request and replies with a valid 512-dim embedding.
func capturingJinaServer(t *testing.T, gotW, gotH *int) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		*gotW, *gotH = decodeJinaImageDims(t, body)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"data": []map[string]any{{"embedding": make512Floats()}},
		})
	}))
}

// A multi-megapixel upload (4:3) must be downscaled so its longest side is at
// most maxEmbeddingImageDim, preserving aspect ratio, before reaching Jina.
func TestEmbeddingService_GenerateEmbedding_DownscalesLargeImage(t *testing.T) {
	var gotW, gotH int
	srv := capturingJinaServer(t, &gotW, &gotH)
	defer srv.Close()

	svc := service.NewEmbeddingService(&mockEmbeddingRepo{}, &mockPetRepoForEmbedding{}, &mockPhotoRepoForEmbedding{}, "test-api-key")
	svc.SetHTTPClientAndEndpoint(srv.Client(), srv.URL)

	large := makeJPEG(t, 2000, 1500)
	if _, err := svc.GenerateEmbedding(context.Background(), large); err != nil {
		t.Fatalf("GenerateEmbedding: %v", err)
	}

	if gotW != 512 || gotH != 384 {
		t.Errorf("image sent to Jina = %dx%d, want 512x384 (downscaled, aspect preserved)", gotW, gotH)
	}
}

// An image already within the cap must pass through untouched (no upscaling).
func TestEmbeddingService_GenerateEmbedding_SmallImagePassesThrough(t *testing.T) {
	var gotW, gotH int
	srv := capturingJinaServer(t, &gotW, &gotH)
	defer srv.Close()

	svc := service.NewEmbeddingService(&mockEmbeddingRepo{}, &mockPetRepoForEmbedding{}, &mockPhotoRepoForEmbedding{}, "test-api-key")
	svc.SetHTTPClientAndEndpoint(srv.Client(), srv.URL)

	small := makeJPEG(t, 300, 200)
	if _, err := svc.GenerateEmbedding(context.Background(), small); err != nil {
		t.Fatalf("GenerateEmbedding: %v", err)
	}

	if gotW != 300 || gotH != 200 {
		t.Errorf("small image sent to Jina = %dx%d, want 300x200 (unchanged)", gotW, gotH)
	}
}

// decodeJinaImage decodes the full data-URI image out of a captured Jina request.
func decodeJinaImage(t *testing.T, body []byte) image.Image {
	t.Helper()
	var req struct {
		Input []struct {
			Image string `json:"image"`
		} `json:"input"`
	}
	if err := json.Unmarshal(body, &req); err != nil {
		t.Fatalf("decode request body: %v", err)
	}
	if len(req.Input) != 1 {
		t.Fatalf("expected 1 input, got %d", len(req.Input))
	}
	raw := req.Input[0].Image
	if i := strings.Index(raw, ","); i >= 0 {
		raw = raw[i+1:]
	}
	dec, err := base64.StdEncoding.DecodeString(raw)
	if err != nil {
		t.Fatalf("base64 decode: %v", err)
	}
	img, _, err := image.Decode(bytes.NewReader(dec))
	if err != nil {
		t.Fatalf("decode sent image: %v", err)
	}
	return img
}

// capturingImageJinaServer records the full decoded image sent to Jina.
func capturingImageJinaServer(t *testing.T, got *image.Image) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		*got = decodeJinaImage(t, body)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"data": []map[string]any{{"embedding": make512Floats()}},
		})
	}))
}

// A WebP upload (a real-and-growing mobile share-sheet format the API accepts)
// must be downscaled too — not pass through full-res because its decoder is
// missing.
func TestEmbeddingService_GenerateEmbedding_DownscalesWebP(t *testing.T) {
	webpBytes, err := os.ReadFile("testdata/large.webp")
	if err != nil {
		t.Fatalf("read webp fixture: %v", err)
	}

	var gotW, gotH int
	srv := capturingJinaServer(t, &gotW, &gotH)
	defer srv.Close()

	svc := service.NewEmbeddingService(&mockEmbeddingRepo{}, &mockPetRepoForEmbedding{}, &mockPhotoRepoForEmbedding{}, "test-api-key")
	svc.SetHTTPClientAndEndpoint(srv.Client(), srv.URL)

	if _, err := svc.GenerateEmbedding(context.Background(), webpBytes); err != nil {
		t.Fatalf("GenerateEmbedding: %v", err)
	}

	// 1000x800 webp → longest side capped at 512.
	if gotW != 512 || gotH != 409 {
		t.Errorf("webp sent to Jina = %dx%d, want 512x409 (downscaled)", gotW, gotH)
	}
}

// A PNG with transparency must not turn black when re-encoded as JPEG (which has
// no alpha): transparent regions should composite onto white, not stay (0,0,0,0).
func TestEmbeddingService_GenerateEmbedding_PngTransparencyNotBlackened(t *testing.T) {
	// 600x600 fully transparent PNG (triggers the >512 downscale branch).
	img := image.NewRGBA(image.Rect(0, 0, 600, 600))
	for i := range img.Pix {
		img.Pix[i] = 0 // transparent black at every pixel
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatalf("encode transparent png: %v", err)
	}

	var got image.Image
	srv := capturingImageJinaServer(t, &got)
	defer srv.Close()

	svc := service.NewEmbeddingService(&mockEmbeddingRepo{}, &mockPetRepoForEmbedding{}, &mockPhotoRepoForEmbedding{}, "test-api-key")
	svc.SetHTTPClientAndEndpoint(srv.Client(), srv.URL)

	if _, err := svc.GenerateEmbedding(context.Background(), buf.Bytes()); err != nil {
		t.Fatalf("GenerateEmbedding: %v", err)
	}

	b := got.Bounds()
	r, g, bl, _ := got.At(b.Dx()/2, b.Dy()/2).RGBA()
	// RGBA() returns 16-bit; near-white means all channels high. Black would be ~0.
	if r>>8 < 240 || g>>8 < 240 || bl>>8 < 240 {
		t.Errorf("transparent region rendered as r=%d g=%d b=%d (8-bit), want near-white (transparency must not become black)", r>>8, g>>8, bl>>8)
	}
}

// An extreme aspect ratio (>512:1) must not produce a degenerate 0-pixel image:
// integer-math scaling rounds the short side toward zero, so it must be clamped.
func TestEmbeddingService_GenerateEmbedding_ExtremeAspectRatioStaysValid(t *testing.T) {
	thin := makeJPEG(t, 2000, 3) // 2000*512/2000=512 wide, 3*512/2000=0 tall before clamp

	var got image.Image
	srv := capturingImageJinaServer(t, &got)
	defer srv.Close()

	svc := service.NewEmbeddingService(&mockEmbeddingRepo{}, &mockPetRepoForEmbedding{}, &mockPhotoRepoForEmbedding{}, "test-api-key")
	svc.SetHTTPClientAndEndpoint(srv.Client(), srv.URL)

	if _, err := svc.GenerateEmbedding(context.Background(), thin); err != nil {
		t.Fatalf("GenerateEmbedding: %v", err)
	}

	b := got.Bounds()
	if b.Dx() < 1 || b.Dy() < 1 {
		t.Errorf("sent image is %dx%d, want both dimensions >= 1 (no degenerate image)", b.Dx(), b.Dy())
	}
}
