package main

import (
	"log"

	"github.com/gin-gonic/gin"
	"lost-pets/config"
	"lost-pets/internal/event"
	"lost-pets/internal/handler"
	"lost-pets/internal/middleware"
	"lost-pets/internal/repository"
	"lost-pets/internal/service"
	"lost-pets/pkg/database"
	"lost-pets/pkg/notification"
	"lost-pets/pkg/storage"
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
	// STORAGE (Cloudinary)
	// ========================================
	cloudinaryClient, err := storage.NewCloudinaryClient(
		cfg.CloudinaryCloudName,
		cfg.CloudinaryAPIKey,
		cfg.CloudinaryAPISecret,
	)
	if err != nil {
		log.Printf("Advertencia: Cloudinary no configurado (%v) — uploads de fotos no disponibles", err)
		cloudinaryClient = nil
	}

	// ========================================
	// EVENT BUS
	// ========================================
	bus := event.NewEventBus()

	// ========================================
	// NOTIFICATIONS (Firebase FCM)
	// ========================================
	// NewFirebaseClient siempre retorna un NotificationClient válido:
	// — FirebaseClient real si FIREBASE_CREDENTIALS_JSON está configurado
	// — noopNotificationClient si no está configurado (degradación graceful)
	fcmClient, err := notification.NewFirebaseClient(cfg.FirebaseKey)
	if err != nil {
		log.Printf("Advertencia: Firebase FCM no configurado (%v) — push notifications no disponibles", err)
	}

	// ========================================
	// CAPA 3: Repositories
	// ========================================
	userRepo := repository.NewUserRepository(db)
	petRepo := repository.NewPetRepository(db)
	reportRepo := repository.NewReportRepository(db)
	photoRepo := repository.NewPhotoRepository(db)

	// Nuevos repositories (Priority 1+2)
	shelterRepo := repository.NewShelterRepository(db)
	blockedUserRepo := repository.NewBlockedUserRepository(db)
	messageRepo := repository.NewMessageRepository(db)
	shareLinkRepo := repository.NewShareLinkRepository(db)
	_ = repository.NewFavoriteRepository(db)
	deviceTokenRepo := repository.NewDeviceTokenRepository(db)

	// PR3: Location Alerts
	locationAlertRepo := repository.NewLocationAlertRepository(db)

	// ========================================
	// CAPA 2: Services
	// ========================================
	authService := service.NewAuthService(userRepo, cfg.JWTSecret, cloudinaryClient)
	petService := service.NewPetService(petRepo, bus)
	reportService := service.NewReportService(reportRepo, petRepo, bus)
	photoService := service.NewPhotoService(photoRepo, petRepo, cloudinaryClient)
	messageService := service.NewMessageService(messageRepo, blockedUserRepo, bus)
	shareLinkService := service.NewShareLinkService(shareLinkRepo, petRepo)
	shelterService := service.NewShelterService(shelterRepo)
	blockService := service.NewBlockService(blockedUserRepo)
	storyService := service.NewSuccessStoryService(repository.NewSuccessStoryRepository(db))
	groupRepo := repository.NewLocalGroupRepository(db)
	groupMemberRepo := repository.NewGroupMemberRepository(db)
	groupService := service.NewGroupService(groupRepo, groupMemberRepo)
	abuseReportRepo := repository.NewAbuseReportRepository(db)
	abuseReportService := service.NewAbuseReportService(abuseReportRepo)

	notificationService := service.NewNotificationService(fcmClient, deviceTokenRepo)
	notificationService.RegisterListeners(bus)

	// PR4: Location Alerts con matching PostGIS + FCM push
	locationAlertService := service.NewLocationAlertService(locationAlertRepo, deviceTokenRepo, bus)
	locationAlertService.RegisterListeners(bus)

	// ========================================
	// CAPA 1: Handlers
	// ========================================
	authHandler := handler.NewAuthHandler(authService)
	petHandler := handler.NewPetHandler(petService)
	reportHandler := handler.NewReportHandler(reportService, userRepo)
	photoHandler := handler.NewPhotoHandler(photoService)
	statsHandler := handler.NewStatsHandler(db)
	messageHandler := handler.NewMessageHandler(messageService)
	shareHandler := handler.NewShareHandler(shareLinkService, cfg.AppURL)
	shelterHandler := handler.NewShelterHandler(shelterService)
	deviceHandler := handler.NewDeviceHandler(deviceTokenRepo)
	locationAlertHandler := handler.NewLocationAlertHandler(locationAlertService)
	blockHandler := handler.NewBlockHandler(blockService)
	storyHandler := handler.NewSuccessStoryHandler(storyService)
	groupHandler := handler.NewGroupHandler(groupService)
	abuseReportHandler := handler.NewAbuseReportHandler(abuseReportService)

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
		public.GET("/pets/search", petHandler.SearchPets)
		public.GET("/pets/:id", petHandler.GetPet)

		// Fotos públicas — cualquiera puede listar fotos de una mascota
		public.GET("/pets/:id/photos", photoHandler.List)

		// Reports públicos — cualquiera puede ver
		public.GET("/reports/nearby", reportHandler.GetNearbyReports)
		public.GET("/reports/pet/:petId", reportHandler.GetReportsByPet)
		public.GET("/reports/:id", reportHandler.GetReport)

		// Share links públicos — para landing pages en redes sociales
		public.GET("/share/pet/:token", shareHandler.GetByToken)
		public.POST("/share/pet/:token/contact", shareHandler.TrackContact)

		// Refugios — directorio público
		public.GET("/shelters", shelterHandler.GetAll)
		public.GET("/shelters/:id", shelterHandler.GetByID)
	}

	// ----------------------------------------
	// RUTAS PROTEGIDAS
	// ----------------------------------------
	protected := router.Group("/api")
	protected.Use(middleware.Auth(cfg.JWTSecret))
	{
		protected.GET("/auth/me", authHandler.GetMe)
		protected.PUT("/auth/me", authHandler.UpdateMe)
		protected.POST("/auth/me/photo", authHandler.UploadProfilePhoto)
		protected.PUT("/users/me/preferences", authHandler.UpdatePreferences)

		// Pets (requieren auth)
		protected.POST("/pets", petHandler.CreatePet)
		protected.GET("/pets/mine", petHandler.GetMyPets)
		protected.PUT("/pets/:id", petHandler.UpdatePet)
		protected.DELETE("/pets/:id", petHandler.DeletePet)
		protected.PATCH("/pets/:id/found", petHandler.MarkAsFound)

		// Reports (solo crear requiere auth)
		protected.POST("/reports", reportHandler.CreateReport)

		// Fotos (subir requiere auth — solo el dueño puede subir)
		protected.POST("/pets/:id/photos", photoHandler.Upload)

		// Mensajes (requieren auth)
		protected.POST("/messages", messageHandler.Send)
		protected.GET("/messages", messageHandler.GetConversations)
		protected.GET("/messages/:userId", messageHandler.GetConversation)
		protected.PATCH("/messages/:id/read", messageHandler.MarkAsRead)

		// Share links protegidos — generar requiere ser el dueño
		protected.POST("/share/generate/:petId", shareHandler.GenerateShareLink)

		// Devices — registrar/eliminar token FCM (requiere auth)
		protected.POST("/devices/token", deviceHandler.RegisterToken)
		// FR4.2: alias POST /api/devices acepta el mismo body que /devices/token
		protected.POST("/devices", deviceHandler.RegisterToken)
		// FR4.2: DELETE /api/devices/:token — eliminar token al hacer logout
		protected.DELETE("/devices/:token", deviceHandler.DeleteToken)

		// Alertas de ubicación (requieren auth)
		protected.POST("/alerts", locationAlertHandler.CreateAlert)
		protected.GET("/alerts", locationAlertHandler.GetAlerts)
		protected.GET("/alerts/:id", locationAlertHandler.GetAlert)
		protected.PUT("/alerts/:id", locationAlertHandler.UpdateAlert)
		protected.DELETE("/alerts/:id", locationAlertHandler.DeleteAlert)

		// V1.3 — User Blocking
		protected.POST("/users/:id/block", blockHandler.Block)
		protected.DELETE("/users/:id/block", blockHandler.Unblock)
		protected.GET("/users/blocked", blockHandler.GetBlocked)

		// V1.3 — Success Stories
		protected.POST("/stories", storyHandler.Create)
		protected.GET("/stories", storyHandler.List)
		protected.GET("/stories/:id", storyHandler.GetByID)
		protected.POST("/stories/:id/like", storyHandler.Like)
		protected.DELETE("/stories/:id", storyHandler.Delete)

		// V1.3 — Local Groups (read + join/leave for all; create is admin-only via admin group)
		protected.GET("/groups", groupHandler.List)
		protected.GET("/groups/:id", groupHandler.GetByID)
		protected.POST("/groups/:id/join", groupHandler.Join)
		protected.DELETE("/groups/:id/leave", groupHandler.Leave)

		// V1.3 — Abuse Reports (submit protected; read + resolve is admin-only via admin group)
		protected.POST("/abuse-reports", abuseReportHandler.Submit)
	}

	// ----------------------------------------
	// RUTAS ADMIN (JWT + IsAdmin=true en BD)
	// ----------------------------------------
	admin := router.Group("/api")
	admin.Use(middleware.Auth(cfg.JWTSecret))
	admin.Use(middleware.RequireAdmin(userRepo))
	{
		admin.PATCH("/admin/stories/:id/featured", storyHandler.SetFeatured)
		admin.POST("/groups", groupHandler.Create)
		admin.GET("/abuse-reports", abuseReportHandler.List)
		admin.GET("/abuse-reports/:id", abuseReportHandler.GetByID)
		admin.PATCH("/admin/abuse-reports/:id/resolve", abuseReportHandler.Resolve)
		admin.PATCH("/admin/reports/:id/verify", reportHandler.VerifyReport)
	}

	// ========================================
	// INICIAR SERVIDOR
	// ========================================
	log.Printf("SearchPet API corriendo en :%s [%s]", cfg.Port, cfg.Environment)

	if err := router.Run(":" + cfg.Port); err != nil {
		log.Fatalf("Error al iniciar servidor: %v", err)
	}
}
