# PostGIS 15 + pgvector for local development.
# The base postgis image is Debian-based with the PGDG apt repo configured,
# so the prebuilt pgvector package for PG15 can be installed directly.
FROM postgis/postgis:15-3.4

RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-15-pgvector \
    && rm -rf /var/lib/apt/lists/*
