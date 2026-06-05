DROP TABLE IF EXISTS pet_embeddings;

-- WARNING: dropping vector extension may affect other tables using vector type.
-- Only drop if no other tables use the vector type in this database.
DROP EXTENSION IF EXISTS vector;
