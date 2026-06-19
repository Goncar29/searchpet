// Package app wires all application dependencies and registers HTTP routes.
// Extracted from cmd/server/main.go so that integration and e2e tests can
// call SetupRouter with a test *gorm.DB without starting a real server.
package app

import (
	"context"
	"time"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
	"gorm.io/gorm"
	"lost-pets/config"
	"lost-pets/internal/event"
	"lost-pets/internal/handler"
	"lost-pets/internal/middleware"
	"lost-pets/internal/repository"
	"lost-pets/internal/service"
	ws "lost-pets/internal/websocket"
	"lost-pets/pkg/mailer"
	"lost-pets/pkg/notification"
	"lost-pets/pkg/ratelimit"
	"lost-pets/pkg/sms"
	"lost-pets/pkg/storage"
)

// SetupRouter wires all dependencies and registers all routes.
// It is called by main (production) and by e2e tests (with a test DB).
func SetupRouter(cfg *config.Config, db *gorm.DB, log *zap.Logger) *gin.Engine {
	// ========================================
	// RATE LIMIT STORE
	// ========================================
	var rateLimitStore ratelimit.Store
	if cfg.RedisURL != "" {
		rs, err := ratelimit.NewRedisStore(cfg.RedisURL)
		if err != nil {
			log.Warn("Redis unavailable, falling back to InMemoryStore", zap.Error(err))
			rateLimitStore = ratelimit.NewInMemoryStore()
		} else {
			rateLimitStore = rs
			log.Info("Rate limiter: Redis")
		}
	} else {
		rateLimitStore = ratelimit.NewInMemoryStore()
		log.Info("Rate limiter: in-memory")
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
	petUow := repository.NewUnitOfWork(db)
	photoRepo := repository.NewPhotoRepository(db)

	shelterRepo := repository.NewShelterRepository(db)
	blockedUserRepo := repository.NewBlockedUserRepository(db)
	messageRepo := repository.NewMessageRepository(db)
	shareLinkRepo := repository.NewShareLinkRepository(db)
	deviceTokenRepo := repository.NewDeviceTokenRepository(db)

	locationAlertRepo := repository.NewLocationAlertRepository(db)

	// ========================================
	// CAPA 2: Services
	// ========================================
	authService := service.NewAuthService(userRepo, cfg.JWTSecret, cloudinaryClient)
	photoService := service.NewPhotoService(photoRepo, petRepo, cloudinaryClient, bus)
	petService := service.NewPetService(petRepo, bus, photoService, reportRepo, petUow)
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

	badgeRepo := repository.NewBadgeRepository(db)
	pointsRepo := repository.NewUserPointsRepository(db)

	reviewRepo := repository.NewUserReviewRepository(db)

	// IMAGE SEARCH (pgvector + CLIP)
	embeddingRepo := repository.NewPetEmbeddingRepository(db)
	embeddingService := service.NewEmbeddingService(embeddingRepo, petRepo, photoRepo, cfg.JinaAPIKey)
	if cfg.JinaEndpoint != "" {
		embeddingService.SetEndpoint(cfg.JinaEndpoint)
	}
	embeddingService.RegisterListeners(bus)

	gamSvc := service.NewGamificationService(badgeRepo, pointsRepo, userRepo, reviewRepo)
	gamSvc.RegisterListeners(bus)

	reviewSvc := service.NewReviewService(reviewRepo, blockedUserRepo, userRepo, bus)
	reviewHandler := handler.NewReviewHandler(reviewSvc)

	verificationTokenRepo := repository.NewVerificationTokenRepository(db)
	mailerClient := mailer.NewSendGridMailer(cfg.SendGridAPIKey)
	smsSenderClient := sms.NewTwilioSender(cfg.TwilioAccountSID, cfg.TwilioAuthToken, cfg.TwilioFromNumber)
	verificationService := service.NewVerificationService(verificationTokenRepo, userRepo, mailerClient, smsSenderClient, bus)

	notificationService := service.NewNotificationService(fcmClient, deviceTokenRepo)
	notificationService.RegisterListeners(bus)

	// ========================================
	// WEBSOCKET — Hub + TicketStore
	// ========================================
	wsHub := ws.NewHub(messageService)
	go wsHub.Run()
	wsTicketStore := ws.NewTicketStore()
	go wsTicketStore.CleanupLoop()

	notificationService.SetPresence(wsHub)
	notificationService.SetPusher(wsHub)

	wsHandler := ws.NewHandler(wsHub, wsTicketStore)

	// PR4: Location Alerts
	locationAlertService := service.NewLocationAlertService(locationAlertRepo, deviceTokenRepo, bus)
	locationAlertService.RegisterListeners(bus)

	// ========================================
	// GOROUTINE: LIMPIEZA DE OTP EXPIRADOS
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
	// CAPA 1: Handlers
	// ========================================
	authHandler := handler.NewAuthHandler(authService)
	petHandler := handler.NewPetHandler(petService, embeddingService)
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
	// WEBSOCKET
	// ----------------------------------------
	router.GET("/api/ws", wsHandler.Connect)

	// ----------------------------------------
	// RUTAS PÚBLICAS
	// ----------------------------------------
	public := router.Group("/api")
	{
		authRateLimit := middleware.RateLimit(rateLimitStore, cfg.AuthRateLimitMax, 1*time.Minute)
		public.POST("/auth/register", authRateLimit, authHandler.Register)
		public.POST("/auth/login", authRateLimit, authHandler.Login)
		public.GET("/stats", statsHandler.GetStats)

		public.GET("/pets/search", petHandler.SearchPets)
		public.GET("/pets/:id", petHandler.GetPet)

		public.GET("/pets/:id/photos", photoHandler.List)

		public.GET("/reports/nearby", reportHandler.GetNearbyReports)
		public.GET("/reports/pet/:petId", reportHandler.GetReportsByPet)
		public.GET("/reports/:id", reportHandler.GetReport)

		public.GET("/share/pet/:token", shareHandler.GetByToken)
		public.POST("/share/pet/:token/contact", shareHandler.TrackContact)

		public.GET("/shelters", shelterHandler.GetAll)
		public.GET("/shelters/:id", shelterHandler.GetByID)

		public.GET("/users/:id/profile", gamHandler.GetPublicProfile)
		public.GET("/leaderboard", gamHandler.GetLeaderboard)

		public.GET("/users/:id/reviews", reviewHandler.GetReviews)

		public.GET("/groups", groupHandler.List)
		public.GET("/groups/:id", groupHandler.GetByID)
		public.GET("/groups/:id/members", groupHandler.GetMembers)
	}

	// ----------------------------------------
	// LECTURAS DE STORIES — vitrina pública con auth opcional
	// (anónimo lee igual; logueado recibe liked_by_me por viewer)
	// ----------------------------------------
	storiesPublic := router.Group("/api")
	storiesPublic.Use(middleware.OptionalAuth(cfg.JWTSecret))
	{
		storiesPublic.GET("/stories", storyHandler.List)
		storiesPublic.GET("/stories/pet/:petId", storyHandler.GetByPetID)
		storiesPublic.GET("/stories/:id", storyHandler.GetByID)
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

		protected.POST("/pets", petHandler.CreatePet)
		protected.GET("/pets/mine", petHandler.GetMyPets)
		protected.GET("/pets/reported", petHandler.GetReportedPets)
		protected.PUT("/pets/:id", petHandler.UpdatePet)
		protected.DELETE("/pets/:id", petHandler.DeletePet)
		protected.PATCH("/pets/:id/found", petHandler.MarkAsFound)
		protected.POST("/pets/:id/publish-lost", petHandler.PublishLost)

		protected.POST("/pets/search/image", petHandler.SearchByImage)

		protected.POST("/reports", reportHandler.CreateReport)

		protected.POST("/pets/:id/photos", photoHandler.Upload)
		protected.DELETE("/pets/:id/photos/:photoId", photoHandler.Delete)

		protected.POST("/messages", messageHandler.Send)
		protected.GET("/messages", messageHandler.GetConversations)
		protected.GET("/messages/:userId", messageHandler.GetConversation)
		protected.PATCH("/messages/:id/read", messageHandler.MarkAsRead)
		protected.GET("/messages/photo-url/:messageId", messageHandler.GetPhotoSignedURL)

		protected.POST("/share/generate/:petId", shareHandler.GenerateShareLink)

		protected.POST("/devices/token", deviceHandler.RegisterToken)
		protected.POST("/devices", deviceHandler.RegisterToken)
		protected.DELETE("/devices/:token", deviceHandler.DeleteToken)

		protected.POST("/alerts", locationAlertHandler.CreateAlert)
		protected.GET("/alerts", locationAlertHandler.GetAlerts)
		protected.GET("/alerts/:id", locationAlertHandler.GetAlert)
		protected.PUT("/alerts/:id", locationAlertHandler.UpdateAlert)
		protected.DELETE("/alerts/:id", locationAlertHandler.DeleteAlert)

		protected.POST("/users/:id/block", blockHandler.Block)
		protected.DELETE("/users/:id/block", blockHandler.Unblock)
		protected.GET("/users/blocked", blockHandler.GetBlocked)
		protected.GET("/users/:id/block-status", blockHandler.GetBlockStatus)

		protected.POST("/stories", storyHandler.Create)
		protected.POST("/stories/:id/like", storyHandler.Like)
		protected.DELETE("/stories/:id/like", storyHandler.Unlike)
		protected.DELETE("/stories/:id", storyHandler.Delete)

		protected.POST("/groups/:id/join", groupHandler.Join)
		protected.DELETE("/groups/:id/leave", groupHandler.Leave)

		protected.POST("/abuse-reports", abuseReportHandler.Submit)

		protected.GET("/users/me/badges", gamHandler.GetMyBadges)

		protected.POST("/users/:id/reviews", reviewHandler.CreateReview)
		protected.PUT("/users/:id/reviews", reviewHandler.UpdateReview)
		protected.DELETE("/users/:id/reviews", reviewHandler.DeleteReview)

		protected.POST("/verification/send-email", middleware.RateLimit(rateLimitStore, 5, 1*time.Minute), verificationHandler.SendEmail)
		protected.POST("/verification/send-sms", verificationHandler.SendSMS)
		protected.POST("/verification/confirm-email", verificationHandler.ConfirmEmail)
		protected.POST("/verification/confirm-sms", verificationHandler.ConfirmSMS)
		protected.GET("/verification/status", verificationHandler.GetStatus)

		protected.POST("/ws/ticket", wsHandler.IssueTicket)
	}

	// ----------------------------------------
	// RUTAS ADMIN
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

	return router
}
