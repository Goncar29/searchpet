DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS vector;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'pgvector not available (%), skipping embedding table', SQLERRM;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    CREATE TABLE IF NOT EXISTS pet_embeddings (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        pet_id     UUID NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
        photo_id   UUID NOT NULL UNIQUE REFERENCES photos(id) ON DELETE CASCADE,
        embedding  vector(512) NOT NULL,
        model_ver  VARCHAR(50) NOT NULL DEFAULT 'clip-vit-base-patch32',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_pet_embeddings_pet_id ON pet_embeddings(pet_id);

    CREATE INDEX IF NOT EXISTS idx_pet_embeddings_hnsw ON pet_embeddings
        USING hnsw (embedding vector_cosine_ops)
        WITH (m = 16, ef_construction = 64);
  END IF;
END;
$$;
