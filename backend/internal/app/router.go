// Package app wires all application dependencies and registers HTTP routes.
// Extracted from cmd/server/main.go so that integration and e2e tests can
// call SetupRouter with a test *gorm.DB without starting a real server.
package app

import (
	"context"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"go.uber.org/zap"
	"gorm.io/gorm"
	"lost-pets/config"
	"lost-pets/internal/event"
	"lost-pets/internal/handler"
	"lost-pets/internal/middleware"
	"lost-pets/internal/osmimport"
	"lost-pets/internal/repository"
	"lost-pets/internal/service"
	ws "lost-pets/internal/websocket"
	"lost-pets/pkg/database"
	"lost-pets/pkg/googleauth"
	"lost-pets/pkg/logger"
	"lost-pets/pkg/mailer"
	"lost-pets/pkg/notification"
	"lost-pets/pkg/ratelimit"
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

	// Expose Cloudinary as the ImageUploader interface for the photo service,
	// guarding the typed-nil trap: assigning a nil *CloudinaryClient straight into
	// an interface yields a NON-nil interface, which would defeat the service's
	// `storage == nil` guard and panic on upload. Keep it a true nil interface.
	var photoStorage service.ImageUploader
	if cloudinaryClient != nil {
		photoStorage = cloudinaryClient
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

	// One primary-key read per authenticated request. Accepted cost: it is what
	// makes a password reset actually terminate the attacker's live session.
	passwordChangedAt := func(ctx context.Context, userID uuid.UUID) (time.Time, error) {
		u, err := userRepo.GetByID(ctx, userID)
		if err != nil {
			return time.Time{}, err
		}
		if u.PasswordChangedAt == nil {
			return time.Time{}, nil
		}
		return *u.PasswordChangedAt, nil
	}

	petRepo := repository.NewPetRepository(db)
	reportRepo := repository.NewReportRepository(db)
	petUow := repository.NewUnitOfWork(db)
	statEventRepo := repository.NewStatEventRepository(db)
	photoRepo := repository.NewPhotoRepository(db)

	episodeRepo := repository.NewEpisodeRepository(db)
	episodeService := service.NewEpisodeService()

	shelterRepo := repository.NewShelterRepository(db)
	vetRepo := repository.NewVetRepository(db)
	blockedUserRepo := repository.NewBlockedUserRepository(db)
	conversationHideRepo := repository.NewConversationHideRepository(db)
	messageRepo := repository.NewMessageRepository(db)
	shareLinkRepo := repository.NewShareLinkRepository(db)
	deviceTokenRepo := repository.NewDeviceTokenRepository(db)

	locationAlertRepo := repository.NewLocationAlertRepository(db)

	// ========================================
	// CAPA 2: Services
	// ========================================
	// Foster homes are constructed before authService because UpdateProfile's
	// owner-contact-change hook needs fosterHomeService injected into authService.
	fosterHomeRepo := repository.NewFosterHomeRepository(db)
	fosterHomePhotoRepo := repository.NewFosterHomePhotoRepository(db)
	fosterHomeAuditRepo := repository.NewFosterHomeAuditRepository(db)
	fosterHomeService := service.NewFosterHomeService(fosterHomeRepo, userRepo, fosterHomeAuditRepo, bus)
	fosterHomePhotoService := service.NewFosterHomePhotoService(fosterHomeRepo, fosterHomePhotoRepo, photoStorage)
	fosterHomeHandler := handler.NewFosterHomeHandler(fosterHomeService, fosterHomePhotoService)

	// googleVerifier nil = feature deshabilitada (ver config.GoogleClientID).
	// NewVerifier RECHAZA un clientID vacío a propósito: con audience vacío,
	// idtoken.Validate se saltea el chequeo de audiencia y aceptaría cualquier
	// token de Google. El nil viene de no llamarlo, nunca de llamarlo mal.
	var googleVerifier googleauth.Verifier
	if cfg.GoogleClientID != "" {
		v, gerr := googleauth.NewVerifier(cfg.GoogleClientID)
		if gerr != nil {
			// Inalcanzable con la guarda de arriba, pero fallar acá es preferible
			// a arrancar con un verificador permisivo.
			log.Fatal("No se pudo construir el verificador de Google", zap.Error(gerr))
		}
		googleVerifier = v
	} else {
		log.Warn("GOOGLE_CLIENT_ID no configurado — el login con Google responderá 502 google_signin_unavailable")
	}
	photoService := service.NewPhotoService(photoRepo, petRepo, photoStorage, bus)
	petService := service.NewPetService(petRepo, bus, photoService, reportRepo, petUow, statEventRepo, episodeService, episodeRepo)
	reportService := service.NewReportService(reportRepo, petRepo, bus, statEventRepo, episodeService, episodeRepo, petUow)
	messageService := service.NewMessageService(messageRepo, blockedUserRepo, conversationHideRepo, bus)
	shareLinkService := service.NewShareLinkService(shareLinkRepo, petRepo, bus)
	shelterService := service.NewShelterService(shelterRepo, userRepo, bus)
	vetService := service.NewVetService(vetRepo)
	blockService := service.NewBlockService(blockedUserRepo)
	storyService := service.NewSuccessStoryService(repository.NewSuccessStoryRepository(db), petRepo)
	groupRepo := repository.NewLocalGroupRepository(db)
	groupMemberRepo := repository.NewGroupMemberRepository(db)
	groupService := service.NewGroupService(groupRepo, groupMemberRepo)

	abuseReportRepo := repository.NewAbuseReportRepository(db)
	abuseReportService := service.NewAbuseReportService(abuseReportRepo, fosterHomeRepo)
	moderationService := service.NewModerationService(userRepo)
	adminRepo := repository.NewAdminRepository(db)
	adminService := service.NewAdminService(userRepo, adminRepo)

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
	mailerClient := mailer.NewBrevoMailer(cfg.BrevoAPIKey, cfg.MailFromEmail)
	if cfg.BrevoEndpoint != "" {
		// Noop mailer (missing key/sender) doesn't implement SetEndpoint.
		if bm, ok := mailerClient.(interface{ SetEndpoint(string) }); ok {
			bm.SetEndpoint(cfg.BrevoEndpoint)
		}
	}
	verificationService := service.NewVerificationService(verificationTokenRepo, userRepo, mailerClient, bus)

	notificationService := service.NewNotificationService(fcmClient, deviceTokenRepo)
	notificationService.RegisterListeners(bus)

	// ========================================
	// WEBSOCKET — Hub + TicketStore
	// ========================================
	wsHub := ws.NewHub(messageService)
	go wsHub.Run()
	wsTicketStore := ws.NewTicketStore()
	go wsTicketStore.CleanupLoop()

	// Ambos servicios se construyen ACÁ, después del hub, y no arriba con el
	// resto: los dos invalidan sesiones estampando password_changed_at, y eso
	// corta los JWT pero NO un socket ya abierto — autentica una única vez con su
	// ticket al hacer el upgrade y nadie lo vuelve a chequear. Se les pasa una
	// función y no el Hub para que la capa de servicio siga sin conocer
	// internal/websocket. authService mantiene su dependencia de fosterHomeService,
	// construido más arriba (ver el comentario en su bloque).
	disconnectFromWS := func(userID uuid.UUID) { wsHub.DisconnectUser(userID.String()) }

	authService := service.NewAuthService(
		userRepo, cfg.JWTSecret, photoStorage, fosterHomeService, googleVerifier,
		disconnectFromWS,
	)
	passwordResetService := service.NewPasswordResetService(
		verificationTokenRepo, userRepo, mailerClient,
		disconnectFromWS,
	)

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
			// DeleteExpired conserva repository.TokenRetention de historia: el cupo
			// diario de recuperación cuenta filas de esta tabla por created_at, y el
			// borrado es DURO. Barriendo apenas vencen —los OTP duran 10 minutos—
			// cada pasada horaria vaciaba la ventana y el tope de 3/día valía 3/hora.
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
	impactHandler := handler.NewImpactHandler(db)
	monthlyImpactHandler := handler.NewMonthlyImpactHandler(db)
	messageHandler := handler.NewMessageHandler(messageService, cloudinaryClient)
	shareHandler := handler.NewShareHandler(shareLinkService, cfg.AppURL)
	shelterHandler := handler.NewShelterHandler(shelterService)
	vetHandler := handler.NewVetHandler(vetService)
	deviceHandler := handler.NewDeviceHandler(deviceTokenRepo)
	locationAlertHandler := handler.NewLocationAlertHandler(locationAlertService)
	blockHandler := handler.NewBlockHandler(blockService)
	storyHandler := handler.NewSuccessStoryHandler(storyService)
	groupHandler := handler.NewGroupHandler(groupService)
	abuseReportHandler := handler.NewAbuseReportHandler(abuseReportService)
	moderationHandler := handler.NewModerationHandler(moderationService)
	adminHandler := handler.NewAdminHandler(adminService)
	verificationHandler := handler.NewVerificationHandler(verificationService, cfg.EnableEmailVerification)
	passwordResetHandler := handler.NewPasswordResetHandler(passwordResetService)
	gamHandler := handler.NewGamificationHandler(gamSvc)
	reindexHandler := handler.NewReindexHandler(embeddingService, cfg.ReindexToken)
	vetImportHandler := handler.NewVetImportHandler(osmimport.New(
		vetRepo,
		// 60 s against a measured 10.9 s round trip: ~5.5x headroom, and far below
		// the 150 s the CLI can afford, because a browser is waiting on this one.
		//
		// That browser has its own deadline, and it has to be the LOOSER of the
		// two: the client aborting first cancels this request's context mid-write,
		// which fails the remaining upserts, blocks the sweep, and hands the
		// operator a bare request_timeout on top of a partial import. See
		// IMPORT_TIMEOUT_MS in shared/api/client.ts — lower this and that must
		// come down with it.
		&http.Client{Timeout: 60 * time.Second},
		osmimport.DefaultOverpassEndpoint,
		logger.Get(),
	))
	opsQuotaHandler := handler.NewOpsQuotaHandler(
		service.NewOpsQuotaService(verificationTokenRepo),
		cfg.OpsStatusToken,
	)

	// ========================================
	// ROUTER
	// ========================================
	if cfg.Environment == "production" {
		gin.SetMode(gin.ReleaseMode)
	}

	router := gin.Default()
	router.Use(middleware.CORS(cfg.Environment, cfg.CORSAllowedOrigins))

	// ----------------------------------------
	// HEALTH CHECK — liveness y readiness son DOS preguntas distintas
	//
	// /health no toca ninguna dependencia, y eso es la feature, no una omision:
	// si mirara la base, el monitor dejaria de distinguir "el proceso murio" de
	// "la base no contesta", que son dos fallas con respuestas opuestas.
	// TestHealthReady_HealthSigueTontoConLaBaseCaida prueba que /health sigue
	// en 200 con el pool cerrado — el error mas probable — pero no prueba la
	// ausencia total de dependencias (no cubre un /health que consulte y se
	// trague el error, ni una base colgada en vez de caida).
	// ----------------------------------------
	router.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok"})
	})

	healthHandler := handler.NewHealthHandler(database.NewReadinessChecker(db), log)
	router.GET("/health/ready", healthHandler.Ready)

	// ----------------------------------------
	// WEBSOCKET
	// ----------------------------------------
	router.GET("/api/ws", wsHandler.Connect)

	// ----------------------------------------
	// ONE-OFF MAINTENANCE — embeddings backfill
	// Token-gated (X-Reindex-Token); returns 404 unless REINDEX_TOKEN is set.
	// Run once after the Jina migration to index pre-existing lost/stray pets,
	// then unset REINDEX_TOKEN to disable it again.
	// ----------------------------------------
	router.POST("/api/admin/reindex-embeddings", reindexHandler.BackfillEmbeddings)
	router.GET("/api/ops/quota", opsQuotaHandler.Report)

	// ----------------------------------------
	// RUTAS PÚBLICAS
	// ----------------------------------------
	public := router.Group("/api")
	{
		authRateLimit := middleware.RateLimit(rateLimitStore, cfg.AuthRateLimitMax, 1*time.Minute)
		public.POST("/auth/register", authRateLimit, authHandler.Register)
		public.POST("/auth/login", authRateLimit, authHandler.Login)
		// Mismo rate limit que login/register: es una puerta de autenticación.
		public.POST("/auth/google", authRateLimit, authHandler.GoogleAuth)
		// Mismo rate limit que login/register: el límite por IP es lo que acota
		// el abuso ahora que el service se traga deliberadamente el cooldown
		// por usuario (defensa anti-enumeración).
		public.POST("/auth/password/forgot", authRateLimit, passwordResetHandler.ForgotPassword)
		public.POST("/auth/password/reset", authRateLimit, passwordResetHandler.ResetPassword)
		public.GET("/stats", statsHandler.GetStats)

		public.GET("/pets/search", petHandler.SearchPets)
		public.GET("/pets/:id", petHandler.GetPet)

		public.GET("/adoptions", petHandler.ListAdoptions)

		public.GET("/pets/:id/photos", photoHandler.List)

		public.GET("/reports/nearby", reportHandler.GetNearbyReports)
		public.GET("/reports/pet/:petId", reportHandler.GetReportsByPet)
		public.GET("/reports/:id", reportHandler.GetReport)

		public.GET("/share/pet/:token", shareHandler.GetByToken)
		public.POST("/share/pet/:token/contact", shareHandler.TrackContact)

		// Generación pública e idempotente de share link (solo lost/stray).
		// Permite que un finder deslogueado comparta y descargue el volante.
		// Rate-limited por IP: la idempotencia ya acota el spam de filas, pero
		// limitamos igual por ser superficie pública anónima.
		public.POST("/pets/:id/share-link",
			middleware.RateLimit(rateLimitStore, 20, 1*time.Minute),
			shareHandler.GeneratePublicShareLink)

		public.GET("/shelters", shelterHandler.GetAll)
		public.GET("/shelters/:id", shelterHandler.GetByID)

		public.GET("/vets/nearby", vetHandler.GetNearby)

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
	storiesPublic.Use(middleware.OptionalAuth(cfg.JWTSecret, passwordChangedAt))
	{
		storiesPublic.GET("/stories", storyHandler.List)
		storiesPublic.GET("/stories/pet/:petId", storyHandler.GetByPetID)
		storiesPublic.GET("/stories/:id", storyHandler.GetByID)
	}

	// ----------------------------------------
	// RUTAS PROTEGIDAS
	// ----------------------------------------
	protected := router.Group("/api")
	protected.Use(middleware.Auth(cfg.JWTSecret, passwordChangedAt))
	{
		protected.GET("/auth/me", authHandler.GetMe)
		protected.PUT("/auth/me", authHandler.UpdateMe)
		protected.POST("/auth/me/photo", authHandler.UploadProfilePhoto)
		protected.PATCH("/auth/me/location", authHandler.UpdateLocation)
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
		// Estática antes que :userId — Gin prioriza rutas estáticas en el mismo segmento.
		protected.GET("/messages/unread-count", messageHandler.GetUnreadCount)
		protected.GET("/messages/:userId", messageHandler.GetConversation)
		protected.PATCH("/messages/:id/read", messageHandler.MarkAsRead)
		protected.GET("/messages/photo-url/:messageId", messageHandler.GetPhotoSignedURL)

		// CONVERSATION-LEVEL ACTIONS (hide / mark unread)
		protected.DELETE("/conversations/:userId", messageHandler.HideConversation)
		protected.PATCH("/conversations/:userId/unread", messageHandler.MarkConversationUnread)

		protected.POST("/share/generate/:petId", shareHandler.GenerateShareLink)

		// SHELTER SELF-REGISTRATION (owner). Estáticas /shelters/mine conviven
		// con la pública /shelters/:id — Gin prioriza segmentos estáticos.
		protected.POST("/shelters", shelterHandler.RegisterOwn)
		protected.GET("/shelters/mine", shelterHandler.GetMine)
		protected.PUT("/shelters/mine", shelterHandler.UpdateMine)

		// FOSTER HOME SELF-REGISTRATION (owner). Unlike /shelters/:id (public),
		// GET /foster-homes/:id lives in THIS SAME group as /foster-homes/mine,
		// so the static-before-wildcard registration order matters here (same
		// pattern as /messages/unread-count vs /messages/:userId below —
		// "Estática antes que :userId — Gin prioriza rutas estáticas en el mismo
		// segmento"): the /mine routes are registered before the /:id route.
		protected.POST("/foster-homes", fosterHomeHandler.RegisterOwn)
		protected.GET("/foster-homes/mine", fosterHomeHandler.GetMine)
		protected.PUT("/foster-homes/mine", fosterHomeHandler.UpdateMine)
		protected.POST("/foster-homes/mine/photos", fosterHomeHandler.UploadPhoto)
		protected.DELETE("/foster-homes/mine/photos/:photoId", fosterHomeHandler.DeletePhoto)
		protected.GET("/foster-homes", fosterHomeHandler.List)
		protected.GET("/foster-homes/:id", fosterHomeHandler.GetByID)

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
		protected.POST("/verification/confirm-email", verificationHandler.ConfirmEmail)
		protected.GET("/verification/status", verificationHandler.GetStatus)

		protected.POST("/ws/ticket", wsHandler.IssueTicket)
	}

	// ----------------------------------------
	// RUTAS ADMIN
	// ----------------------------------------
	admin := router.Group("/api")
	admin.Use(middleware.Auth(cfg.JWTSecret, passwordChangedAt))
	admin.Use(middleware.RequireAdmin(userRepo))
	{
		admin.GET("/stats/impact", impactHandler.GetImpactStats)
		admin.GET("/stats/impact/monthly", monthlyImpactHandler.GetMonthly)
		admin.PATCH("/admin/stories/:id/featured", storyHandler.SetFeatured)
		admin.DELETE("/admin/stories/:id", storyHandler.Delete)
		admin.POST("/groups", groupHandler.Create)
		admin.GET("/abuse-reports", abuseReportHandler.List)
		admin.GET("/abuse-reports/:id", abuseReportHandler.GetByID)
		admin.PATCH("/admin/abuse-reports/:id/resolve", abuseReportHandler.Resolve)

		// FOSTER HOME MODERATION QUEUE. /foster-homes/pending is a static GET
		// registered before the /foster-homes/:id/* wildcard routes — same
		// static-before-wildcard ordering used for /messages/unread-count vs
		// /messages/:userId and for /foster-homes/mine vs /foster-homes/:id above.
		admin.GET("/foster-homes/pending", fosterHomeHandler.PendingQueue)
		admin.POST("/foster-homes/:id/approve", fosterHomeHandler.Approve)
		admin.POST("/foster-homes/:id/reject", fosterHomeHandler.Reject)
		admin.POST("/foster-homes/:id/suspend", fosterHomeHandler.Suspend)
		admin.POST("/foster-homes/:id/reinstate", fosterHomeHandler.Reinstate)
		admin.GET("/foster-homes/:id/logs", fosterHomeHandler.ModerationLogs)
		admin.GET("/foster-homes/:id/history", fosterHomeHandler.ChangeLogs)

		admin.PATCH("/admin/reports/:id/verify", reportHandler.VerifyReport)
		admin.DELETE("/admin/reports/:id", reportHandler.DeleteReport)
		admin.PATCH("/admin/users/:id/ban", moderationHandler.BanUser)
		admin.PATCH("/admin/users/:id/unban", moderationHandler.UnbanUser)
		admin.POST("/admin/users/admin-role", adminHandler.SetUserAdmin)
		admin.GET("/admin/role-changes", adminHandler.RecentRoleChanges)
		admin.POST("/admin/shelters", shelterHandler.Create)
		admin.PUT("/admin/shelters/:id", shelterHandler.Update)

		// SHELTER APPROVAL QUEUE
		admin.GET("/admin/shelters/pending", shelterHandler.PendingQueue)
		admin.POST("/admin/shelters/:id/approve", shelterHandler.Approve)
		admin.POST("/admin/shelters/:id/reject", shelterHandler.Reject)
		admin.POST("/admin/shelters/:id/links/approve", shelterHandler.ApproveLinks)
		admin.POST("/admin/shelters/:id/links/reject", shelterHandler.RejectLinks)

		admin.POST("/admin/vets/import", vetImportHandler.Import)
	}

	return router
}
