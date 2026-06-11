# ============================================
# SearchPet - Makefile
# ============================================

.PHONY: help dev stop backend web mobile test deploy clean

help: ## Mostrar ayuda
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

# ============================================
# DESARROLLO
# ============================================

dev: ## Levantar todo el entorno de desarrollo
	docker-compose up -d
	@echo "PostgreSQL + PostGIS corriendo en localhost:5432"
	@echo ""
	@echo "Para iniciar el backend:  make backend"
	@echo "Para iniciar la web:      make web"
	@echo "Para iniciar mobile:      make mobile"

stop: ## Detener servicios Docker
	docker-compose down

backend: ## Iniciar backend Go
	cd backend && go run ./cmd/server

web: ## Iniciar web React
	cd frontend/packages/web && pnpm dev

mobile: ## Iniciar app React Native
	cd frontend/packages/mobile && npx expo start

# ============================================
# TESTS
# ============================================

test: ## Ejecutar todos los tests
	cd backend && go test ./... -v -cover

test-backend: ## Ejecutar tests del backend
	cd backend && go test ./... -v -cover -count=1

# ============================================
# BUILD
# ============================================

build-backend: ## Compilar backend
	cd backend && CGO_ENABLED=0 GOOS=linux go build -a -o bin/server ./cmd/server

build-web: ## Build de la web
	cd frontend/packages/web && pnpm build

build-docker: ## Build Docker image
	docker build -t lost-pets-api ./backend

# ============================================
# DATABASE
# ============================================

db-up: ## Levantar solo la BD
	docker-compose up -d db

db-reset: ## Resetear la BD (borra todo)
	docker-compose down -v
	docker-compose up -d db
	@echo "Base de datos reseteada"

db-shell: ## Conectar a la BD
	docker exec -it lostpets-db psql -U postgres -d lostpets

# ============================================
# DEPLOY
# ============================================

deploy-backend: ## Deploy backend a Render (manual; el push a main ya deploya via CI)
	@test -n "$(RENDER_DEPLOY_HOOK_URL)" || \
		(echo "RENDER_DEPLOY_HOOK_URL no definido."; \
		 echo "El deploy normal es automatico: push a main dispara el job deploy-backend en CI."; \
		 exit 1)
	curl -X POST "$(RENDER_DEPLOY_HOOK_URL)"

deploy-web: build-web ## Deploy web a Vercel
	@echo "Deploy a Vercel..."
	cd frontend/packages/web && vercel --prod

# ============================================
# UTILIDADES
# ============================================

clean: ## Limpiar archivos generados
	rm -rf backend/bin
	rm -rf frontend/packages/web/dist
	docker-compose down -v

lint: ## Ejecutar linters
	cd backend && golangci-lint run
	cd frontend/packages/web && pnpm lint

setup: ## Configurar proyecto (primera vez)
	cp backend/.env.example backend/.env
	cd frontend/packages/web && pnpm install
	cd frontend/packages/mobile && pnpm install
	docker-compose up -d
	@echo ""
	@echo "Proyecto configurado. Ejecuta: make dev"
