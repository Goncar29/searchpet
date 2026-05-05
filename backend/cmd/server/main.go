package main

import (
	"log"

	"github.com/gin-gonic/gin"
	"lost-pets/config"
	"lost-pets/internal/handler"
	"lost-pets/internal/middleware"
	"lost-pets/internal/repository"
	"lost-pets/internal/service"
	"lost-pets/pkg/database"
)

func main() {
	// ========================================
	// CONFIGURACIÓN
	// ========================================
	cfg := config.Load()

	// ========================================
	// BASE DE DATOS
	// ========================================
	db, err := database.Connect(cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("Error conectando a la base de datos: %v", err)
	}

	// ========================================
	// CAPA 3: Repositories
	// ========================================
	userRepo := repository.NewUserRepository(db)
	petRepo := repository.NewPetRepository(db)
	reportRepo := repository.NewReportRepository(db)

	// ========================================
	// CAPA 2: Services
	// ========================================
	authService := service.NewAuthService(userRepo, cfg.JWTSecret)
	petService := service.NewPetService(petRepo)
	reportService := service.NewReportService(reportRepo)

	// ========================================
	// CAPA 1: Handlers
	// ========================================
	authHandler := handler.NewAuthHandler(authService)
	petHandler := handler.NewPetHandler(petService)
	reportHandler := handler.NewReportHandler(reportService)
	statsHandler := handler.NewStatsHandler(db)

	// ========================================
	// ROUTER
	// ========================================
	if cfg.Environment == "production" {
		gin.SetMode(gin.ReleaseMode)
	}

	router := gin.Default()
	router.Use(middleware.CORS())

	// ----------------------------------------
	// RUTAS PÚBLICAS
	// ----------------------------------------
	public := router.Group("/api")
	{
		public.POST("/auth/register", authHandler.Register)
		public.POST("/auth/login", authHandler.Login)
		public.GET("/stats", statsHandler.GetStats)

		// Pets públicos — cualquiera puede ver
		public.GET("/pets/:id", petHandler.GetPet)

		// Reports públicos — cualquiera puede ver
		public.GET("/reports/nearby", reportHandler.GetNearbyReports)
		public.GET("/reports/pet/:petId", reportHandler.GetReportsByPet)
		public.GET("/reports/:id", reportHandler.GetReport)
	}

	// ----------------------------------------
	// RUTAS PROTEGIDAS
	// ----------------------------------------
	protected := router.Group("/api")
	protected.Use(middleware.Auth(cfg.JWTSecret))
	{
		protected.GET("/auth/me", authHandler.GetMe)

		// Pets (requieren auth)
		protected.POST("/pets", petHandler.CreatePet)
		protected.GET("/pets/mine", petHandler.GetMyPets)
		protected.PUT("/pets/:id", petHandler.UpdatePet)
		protected.DELETE("/pets/:id", petHandler.DeletePet)

		// Reports (solo crear requiere auth)
		protected.POST("/reports", reportHandler.CreateReport)
	}

	// ========================================
	// INICIAR SERVIDOR
	// ========================================
	log.Printf("SearchPet API corriendo en :%s [%s]", cfg.Port, cfg.Environment)

	if err := router.Run(":" + cfg.Port); err != nil {
		log.Fatalf("Error al iniciar servidor: %v", err)
	}
}
