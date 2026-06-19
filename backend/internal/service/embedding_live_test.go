package service_test

import (
	"context"
	"os"
	"testing"

	"lost-pets/internal/service"
)

// TestEmbeddingService_Live_Jina exercises the REAL production code path against
// the live Jina embeddings API. It is skipped unless JINA_API_KEY is set, so it
// never runs in CI. Run locally with:
//
//	JINA_API_KEY=jina_... go test ./internal/service/ -run Live -v
//
// Proves end-to-end that callEmbedding builds a request Jina accepts and parses
// the response into a 512-dim vector.
func TestEmbeddingService_Live_Jina(t *testing.T) {
	key := os.Getenv("JINA_API_KEY")
	if key == "" {
		t.Skip("JINA_API_KEY not set — skipping live Jina integration test")
	}

	svc := service.NewEmbeddingService(nil, nil, nil, key)

	const imageURL = "https://images.unsplash.com/photo-1543466835-00a7907e9de1?w=400"
	vector, err := svc.GenerateEmbeddingFromURL(context.Background(), imageURL)
	if err != nil {
		t.Fatalf("live Jina call failed: %v", err)
	}
	if len(vector) != 512 {
		t.Fatalf("expected 512-dim vector from jina-clip-v2, got %d", len(vector))
	}
	t.Logf("live Jina OK: got 512-dim vector, first3=%v", vector[:3])
}
