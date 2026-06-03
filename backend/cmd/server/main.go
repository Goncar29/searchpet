package main

import (
	"context"
	"time"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
	"lost-pets/config"
	"lost-pets/internal/event"
	"lost-pets/internal/handler"
	"lost-pets/internal/middleware"
	"lost-pets/internal/repository"
	"lost-pets/internal/service"
	ws "lost-pets/internal/websocket"
	"lost-pets/pkg/database"
	"lost-pets/pkg/logger"
	"lost-pets/pkg/mailer"
	"lost-pets/pkg/notification"
	"lost-pets/pkg/sms"
	"lost-pets/pkg/storage"
)

func main() {
	// ========================================
	// CONFIGURACIÓN
	// ========================================
	cfg := config.Load()

	// ========================================
	// LOGGER
	// ========================================
	log := logger.Init(cfg.Environment)
	defer log.Sync() //nolint:errcheck

	// ========================================
	// BASE DE DATOS
	// Connect → AutoMigrate (crea tablas base) → RunMigrations (DDL incremental)
	// ========================================
	db, err := database.Connect(cfg.DatabaseURL)
	if err != nil {
		log.Fatal("Error conectando a la base de datos", zap.Error(err))
	}

	// 1. AutoMigrate primero: crea todas las tablas base en DBs vacías
	if err := database.RunAutoMigrate(db); err != nil {
		log.Fatal("Error en AutoMigrate", zap.Error(err))
	}

	// 2. SQL migrations después: aplica DDL incremental (columnas, índices, tablas auxiliares)
	if err := database.RunMigrations(cfg.DatabaseURL, "migrations"); err != nil {
		log.Fatal("Error ejecutando migraciones SQL", zap.Error(err))
	}
	log.Info("Migraciones SQL aplicadas")

	// ========================================
	// STORAGE (Cloudinary)
	// ========================================
	cloudinaryClient, err := storage.NewCloudinaryClient(
		cfg.CloudinaryCloudName,
		cfg.CloudinaryAPIKey,
		cfg.CloudinaryAPISecret,
	)
	if err != nil {
		log.Warn("Cloudinary no configurado — uploads de fotos no disponibles", zap.Error(err))
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
		log.Warn("Firebase FCM no configurado — push notifications no disponibles", zap.Error(err))
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
	deviceTokenRepo := repository.NewDeviceTokenRepository(db)

	// PR3: Location Alerts
	locationAlertRepo := repository.NewLocationAlertRepository(db)

	// ========================================
	// CAPA 2: Services
	// ========================================
	authService := service.NewAuthService(userRepo, cfg.JWTSecret, cloudinaryClient)
	photoService := service.NewPhotoService(photoRepo, petRepo, cloudinaryClient)
	petService := service.NewPetService(petRepo, bus, photoService, reportRepo)
	reportService := service.NewReportService(reportRepo, petRepo, bus)
	messageService := service.NewMessageService(messageRepo, blockedUserRepo, bus)
	shareLinkService := service.NewShareLinkService(shareLinkRepo, petRepo, bus)
	shelterService := service.NewShelterService(shelterRepo)
	blockService := service.NewBlockService(blockedUserRepo)
	storyService := service.NewSuccessStoryService(repository.NewSuccessStoryRepository(db), petRepo)
	groupRepo := repository.NewLocalGroupRepository(db)
	groupMemberRepo := repository.NewGroupMemberRepository(db)
	groupService := service.NewGroupService(groupRepo, groupMemberRepo)
	abuseReportRepo := repository.NewAbuseReportRepository(db)
	abuseReportService := service.NewAbuseReportService(abuseReportRepo)

	// V1.4 — Gamification (Badges + Points + Leaderboard)
	badgeRepo := repository.NewBadgeRepository(db)
	pointsRepo := repository.NewUserPointsRepository(db)

	// V1.5 — User Reviews
	reviewRepo := repository.NewUserReviewRepository(db)

	gamSvc := service.NewGamificationService(badgeRepo, pointsRepo, userRepo, reviewRepo)
	gamSvc.RegisterListeners(bus)

	// V1.5 — Review Service + Handler
	reviewSvc := service.NewReviewService(reviewRepo, blockedUserRepo, userRepo, bus)
	reviewHandler := handler.NewReviewHandler(reviewSvc)

	// V1.3 — User Verification (OTP)
	verificationTokenRepo := repository.NewVerificationTokenRepository(db)
	mailerClient := mailer.NewSendGridMailer(cfg.SendGridAPIKey)
	smsSenderClient := sms.NewTwilioSender(cfg.TwilioAccountSID, cfg.TwilioAuthToken, cfg.TwilioFromNumber)
	verificationService := service.NewVerificationService(verificationTokenRepo, userRepo, mailerClient, smsSenderClient, bus)

	notificationService := service.NewNotificationService(fcmClient, deviceTokenRepo)
	notificationService.RegisterListeners(bus)

	// ========================================
	// WEBSOCKET — Hub + TicketStore
	// Hub needs MessageServicer (CountUnread + MarkConversationRead).
	// NotificationService needs PresenceChecker (IsConnected) to gate FCM.
	// ========================================
	wsHub := ws.NewHub(messageService)
	go wsHub.Run()
	wsTicketStore := ws.NewTicketStore()
	go wsTicketStore.CleanupLoop()
	defer wsHub.Close()

	// T-2-04: wire presence + pusher into NotificationService.
	// Presence: FCM is skipped when receiver is online via WS.
	// Pusher: chat_message is delivered via WS when receiver is online.
	notificationService.SetPresence(wsHub)
	notificationService.SetPusher(wsHub)

	wsHandler := ws.NewHandler(wsHub, wsTicketStore)

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
	messageHandler := handler.NewMessageHandler(messageService, cloudinaryClient)
	shareHandler := handler.NewShareHandler(shareLinkService, cfg.AppURL)
	shelterHandler := handler.NewShelterHandler(shelterService)
	deviceHandler := handler.NewDeviceHandler(deviceTokenRepo)
	locationAlertHandler := handler.NewLocationAlertHandler(locationAlertService)
	blockHandler := handler.NewBlockHandler(blockService)
	storyHandler := handler.NewSuccessStoryHandler(storyService)
	groupHandler := handler.NewGroupHandler(groupService)
	abuseReportHandler := handler.NewAbuseReportHandler(abuseReportService)
	verificationHandler := handler.NewVerificationHandler(verificationService, cfg.EnableEmailVerification)
	gamHandler := handler.NewGamificationHandler(gamSvc)

	// ========================================
	// ROUTER
	// ========================================
	if cfg.Environment == "production" {
		gin.SetMode(gin.ReleaseMode)
	}

	router := gin.Default()
	router.Use(middleware.CORS(cfg.Environment, cfg.CORSAllowedOrigins))

	// ----------------------------------------
	// HEALTH CHECK
	// ----------------------------------------
	router.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok"})
	})

	// ----------------------------------------
	// WEBSOCKET — upgrade (no auth middleware — ticket is the credential)
	// ----------------------------------------
	router.GET("/api/ws", wsHandler.Connect)

	// ----------------------------------------
	// RUTAS PÚBLICAS
	// ----------------------------------------
	public := router.Group("/api")
	{
		authRateLimit := middleware.RateLimit(5.0/60.0, 5)
		public.POST("/auth/register", authRateLimit, authHandler.Register)
		public.POST("/auth/login", authRateLimit, authHandler.Login)
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

		// V1.4 — Gamification (público)
		public.GET("/users/:id/profile", gamHandler.GetPublicProfile)
		public.GET("/leaderboard", gamHandler.GetLeaderboard)

		// V1.5 — Reviews (público — leer no requiere auth)
		public.GET("/users/:id/reviews", reviewHandler.GetReviews)

		// V1.3 — Local Groups (listar y ver detalle son públicos; join/leave requieren auth)
		public.GET("/groups", groupHandler.List)
		public.GET("/groups/:id", groupHandler.GetByID)
		public.GET("/groups/:id/members", groupHandler.GetMembers)
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

		// Fotos (subir y eliminar requieren auth — solo el dueño puede hacerlo)
		protected.POST("/pets/:id/photos", photoHandler.Upload)
		protected.DELETE("/pets/:id/photos/:photoId", photoHandler.Delete)

		// Mensajes (requieren auth)
		protected.POST("/messages", messageHandler.Send)
		protected.GET("/messages", messageHandler.GetConversations)
		protected.GET("/messages/:userId", messageHandler.GetConversation)
		protected.PATCH("/messages/:id/read", messageHandler.MarkAsRead)
		protected.GET("/messages/photo-url/:messageId", messageHandler.GetPhotoSignedURL)

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
		protected.GET("/users/:id/block-status", blockHandler.GetBlockStatus)

		// V1.3 — Success Stories
		protected.POST("/stories", storyHandler.Create)
		protected.GET("/stories", storyHandler.List)
		protected.GET("/stories/pet/:petId", storyHandler.GetByPetID)
		protected.GET("/stories/:id", storyHandler.GetByID)
		protected.POST("/stories/:id/like", storyHandler.Like)
		protected.DELETE("/stories/:id", storyHandler.Delete)

		// V1.3 — Local Groups (join/leave requieren auth; read is public — routes in public block)
		protected.POST("/groups/:id/join", groupHandler.Join)
		protected.DELETE("/groups/:id/leave", groupHandler.Leave)

		// V1.3 — Abuse Reports (submit protected; read + resolve is admin-only via admin group)
		protected.POST("/abuse-reports", abuseReportHandler.Submit)

		// V1.4 — Gamification (requiere auth)
		protected.GET("/users/me/badges", gamHandler.GetMyBadges)

		// V1.5 — Reviews (requieren auth para escribir/actualizar/eliminar)
		protected.POST("/users/:id/reviews", reviewHandler.CreateReview)
		protected.PUT("/users/:id/reviews", reviewHandler.UpdateReview)
		protected.DELETE("/users/:id/reviews", reviewHandler.DeleteReview)

		// V1.3 — User Verification (OTP)
		protected.POST("/verification/send-email", middleware.RateLimit(5.0/60.0, 5), verificationHandler.SendEmail)
		protected.POST("/verification/send-sms", verificationHandler.SendSMS)
		protected.POST("/verification/confirm-email", verificationHandler.ConfirmEmail)
		protected.POST("/verification/confirm-sms", verificationHandler.ConfirmSMS)
		protected.GET("/verification/status", verificationHandler.GetStatus)

		// WebSocket ticket (JWT required)
		protected.POST("/ws/ticket", wsHandler.IssueTicket)
	}

	// ----------------------------------------
	// RUTAS ADMIN (JWT + IsAdmin=true en BD)
	// ----------------------------------------
	admin := router.Group("/api")
	admin.Use(middleware.Auth(cfg.JWTSecret))
	admin.Use(middleware.RequireAdmin(userRepo))
	{
		admin.PATCH("/admin/stories/:id/featured", storyHandler.SetFeatured)
		admin.DELETE("/admin/stories/:id", storyHandler.Delete)
		admin.POST("/groups", groupHandler.Create)
		admin.GET("/abuse-reports", abuseReportHandler.List)
		admin.GET("/abuse-reports/:id", abuseReportHandler.GetByID)
		admin.PATCH("/admin/abuse-reports/:id/resolve", abuseReportHandler.Resolve)
		admin.PATCH("/admin/reports/:id/verify", reportHandler.VerifyReport)
		admin.POST("/admin/shelters", shelterHandler.Create)
		admin.PUT("/admin/shelters/:id", shelterHandler.Update)
	}

	// ========================================
	// GOROUTINE: LIMPIEZA DE OTP EXPIRADOS
	// Corre cada hora eliminando tokens vencidos de la BD.
	// ========================================
	go func() {
		ticker := time.NewTicker(1 * time.Hour)
		defer ticker.Stop()
		for range ticker.C {
			if deleted, err := verificationTokenRepo.DeleteExpired(context.Background()); err != nil {
				log.Error("OTP cleanup error", zap.Error(err))
			} else if deleted > 0 {
				log.Info("OTP cleanup: tokens expirados eliminados", zap.Int64("count", deleted))
			}
		}
	}()

	// ========================================
	// INICIAR SERVIDOR
	// ========================================
	log.Info("SearchPet API corriendo", zap.String("port", cfg.Port), zap.String("env", cfg.Environment))

	if err := router.Run(":" + cfg.Port); err != nil {
		log.Fatal("Error al iniciar servidor", zap.Error(err))
	}
}
