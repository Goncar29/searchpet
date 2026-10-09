# ============================================
# Lost Pets API - Dockerfile
# Multi-stage build para producción
# ============================================

# Stage 1: Build
# Mismo patch que la directiva `go` de go.mod. La imagen oficial trae
# GOTOOLCHAIN=local: con una imagen más vieja que go.mod el build falla en vez
# de bajar el toolchain, así que los dos se suben juntos.
FROM golang:1.26.9-alpine AS builder

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
# Se fija la rama menor (no el patch) para recibir los parches de seguridad al
# reconstruir. 3.24 tiene soporte hasta 2028-06; la 3.19 que había salió de
# soporte en 2025-11.
FROM alpine:3.24

WORKDIR /app

# Instalar certificados SSL
RUN apk --no-cache add ca-certificates tzdata

# Usuario sin privilegios. El binario no escribe a disco, así que no necesita
# ser dueño de nada: los archivos copiados abajo quedan de root y en solo
# lectura para él. UID numérico para que `USER` no dependa de /etc/passwd.
RUN addgroup -S -g 10001 app && adduser -S -D -H -u 10001 -G app app

# Copiar binario compilado
COPY --from=builder /app/main .

# Copiar migraciones SQL (puede estar vacío — RunMigrations lo tolera)
COPY --from=builder /app/migrations ./migrations

# Copiar .env si existe
COPY --from=builder /app/.env.example .env.example

# Puerto (> 1024: no hace falta root para escucharlo)
EXPOSE 8080

USER 10001:10001

# Ejecutar
CMD ["./main"]
