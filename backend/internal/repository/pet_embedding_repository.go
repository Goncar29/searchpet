package repository

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/pgvector/pgvector-go"
	"gorm.io/gorm"
	"lost-pets/internal/domain"
)

// postgresPetEmbeddingRepository implements PetEmbeddingRepository using PostgreSQL + pgvector.
// All SQL uses raw queries because the <=> cosine distance operator is not supported
// by the GORM query builder (same pattern as ReportRepository.FindNearby with PostGIS).
type postgresPetEmbeddingRepository struct {
	db *gorm.DB
}

// NewPetEmbeddingRepository creates a new instance of PetEmbeddingRepository.
func NewPetEmbeddingRepository(db *gorm.DB) PetEmbeddingRepository {
	return &postgresPetEmbeddingRepository{db: db}
}

// Upsert inserts or updates the embedding row keyed by photo_id.
// ON CONFLICT (photo_id) updates the embedding and model_ver in place.
func (r *postgresPetEmbeddingRepository) Upsert(ctx context.Context, emb *domain.PetEmbedding) error {
	sql := `
INSERT INTO pet_embeddings (id, pet_id, photo_id, embedding, model_ver, created_at)
VALUES (gen_random_uuid(), ?, ?, ?, ?, NOW())
ON CONFLICT (photo_id) DO UPDATE
    SET embedding  = EXCLUDED.embedding,
        model_ver  = EXCLUDED.model_ver,
        created_at = NOW()`

	return r.db.WithContext(ctx).Exec(sql,
		emb.PetID,
		emb.PhotoID,
		pgvector.NewVector(emb.Embedding.Slice()),
		emb.ModelVer,
	).Error
}

// FindSimilar returns up to limit lost or stray pets ranked by cosine similarity to queryVec.
// Results are deduplicated by pet_id — only the embedding with the smallest cosine
// distance per pet is considered. The outer query then sorts by similarity DESC
// (1 - distance, so higher = more similar).
//
// SQL strategy: DISTINCT ON subquery (best-match-per-pet) wrapped in an outer query
// that sorts globally by similarity and applies LIMIT.
func (r *postgresPetEmbeddingRepository) FindSimilar(ctx context.Context, queryVec []float32, limit int) ([]domain.ImageSearchResult, error) {
	if limit <= 0 {
		limit = 10
	}

	vec := pgvector.NewVector(queryVec)

	sql := `
SELECT
    inner_q.pet_id,
    inner_q.pet_name,
    inner_q.pet_type,
    inner_q.status,
    inner_q.primary_url,
    1 - inner_q.distance AS similarity,
    inner_q.owner_id
FROM (
    SELECT DISTINCT ON (p.id)
        p.id          AS pet_id,
        p.name        AS pet_name,
        p.type        AS pet_type,
        p.status,
        COALESCE(ph.url, '')  AS primary_url,
        pe.embedding <=> ?    AS distance,
        p.owner_id
    FROM pet_embeddings pe
    JOIN pets p ON p.id = pe.pet_id
    LEFT JOIN photos ph ON ph.pet_id = p.id AND ph.is_primary = true
    WHERE p.status IN ('lost', 'stray')
    ORDER BY p.id, pe.embedding <=> ? ASC
) inner_q
ORDER BY inner_q.distance ASC
LIMIT ?`

	rows, err := r.db.WithContext(ctx).Raw(sql, vec, vec, limit).Rows()
	if err != nil {
		return nil, fmt.Errorf("pet_embedding_repository.FindSimilar: %w", err)
	}
	defer rows.Close()

	var results []domain.ImageSearchResult
	for rows.Next() {
		var res domain.ImageSearchResult
		if err := rows.Scan(
			&res.PetID,
			&res.PetName,
			&res.PetType,
			&res.Status,
			&res.PrimaryURL,
			&res.Similarity,
			&res.OwnerID,
		); err != nil {
			return nil, fmt.Errorf("pet_embedding_repository.FindSimilar scan: %w", err)
		}
		results = append(results, res)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("pet_embedding_repository.FindSimilar rows: %w", err)
	}

	return results, nil
}

// DeleteByPetID removes all embedding rows for the given pet.
// Called by EmbeddingService when a pet.found event fires.
func (r *postgresPetEmbeddingRepository) DeleteByPetID(ctx context.Context, petID uuid.UUID) error {
	return r.db.WithContext(ctx).
		Exec("DELETE FROM pet_embeddings WHERE pet_id = ?", petID).
		Error
}
