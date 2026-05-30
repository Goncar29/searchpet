# ============================================
# Lost Pets API - Dockerfile
# Multi-stage build para producción
# ============================================

# Stage 1: Build
FROM golang:1.25-alpine AS builder

WORKDIR /app

# Instalar dependencias del sistema
RUN apk add --no-cache git

# Copiar módulos primero (cache de dependencias)
COPY go.mod go.sum ./
RUN go mod download

# Copiar código fuente
COPY . .

# Compilar binario estático
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o main ./cmd/server

# Stage 2: Runtime (imagen mínima)
FROM alpine:3.19

WORKDIR /app

# Instalar certificados SSL
RUN apk --no-cache add ca-certificates tzdata

# Copiar binario compilado
COPY --from=builder /app/main .

# Copiar migraciones SQL (puede estar vacío — RunMigrations lo tolera)
COPY --from=builder /app/migrations ./migrations

# Copiar .env si existe
COPY --from=builder /app/.env.example .env.example

# Puerto
EXPOSE 8080

# Ejecutar
CMD ["./main"]
