package config

import (
	"log"
	"os"
	"strconv"

	"github.com/joho/godotenv"
)

type Config struct {
	Port                string
	DatabaseURL         string
	JWTSecret           string
	CloudinaryCloudName string
	CloudinaryAPIKey    string
	CloudinaryAPISecret string
	FirebaseKey         string
	AppURL              string
	Environment         string
	CORSAllowedOrigins  string

	// V1.3 — User Verification (OTP). Email migrated from SendGrid to Brevo
	// (SendGrid retired its free-forever plan; Brevo: 300 emails/day free,
	// single-sender verification works without owning a domain).
	BrevoAPIKey string
	// MailFromEmail is the verified single sender in Brevo. Empty disables
	// email sending (noop mailer) — Brevo rejects unverified senders.
	MailFromEmail string
	// BrevoEndpoint optionally overrides the default Brevo API endpoint
	// (mailer.DefaultBrevoEndpoint). Empty means "use the default" — set this
	// only if Brevo migrates its API, so it's a config change instead of a deploy.
	BrevoEndpoint            string
	TwilioAccountSID         string
	TwilioAuthToken          string
	TwilioFromNumber         string
	EnableEmailVerification  bool

	// V2.0 — Distributed Rate Limiting (Redis)
	RedisURL string

	// Auth rate limit: max requests per minute per IP for /auth/register and /auth/login.
	// Set to a higher value (e.g. 100) in E2E/test environments.
	AuthRateLimitMax int

	// V1.2 — Image Search (Jina CLIP embeddings + pgvector). Migrated off
	// HuggingFace serverless, which dropped CLIP image embeddings.
	JinaAPIKey string
	// JinaEndpoint optionally overrides the default Jina embeddings endpoint
	// (service.DefaultJinaEndpoint). Empty means "use the default" — set this
	// only if Jina migrates its API, so it's a config change instead of a deploy.
	JinaEndpoint string

	// ReindexToken gates the one-off admin embeddings backfill endpoint
	// (POST /api/admin/reindex-embeddings). Empty (the default) DISABLES the
	// endpoint entirely — it returns 404 and exposes no surface. Set it
	// temporarily to run the backfill, then unset it again.
	ReindexToken string
}

func Load() *Config {
	if err := godotenv.Load(); err != nil {
		log.Println("No .env file found, using system environment variables")
	}

	cfg := &Config{
		Port:                getEnv("PORT", "8081"),
		DatabaseURL:         getEnv("DATABASE_URL", "postgres://postgres:postgres@localhost:5432/lostpets?sslmode=disable"),
		JWTSecret:           getEnv("JWT_SECRET", ""),
		CloudinaryCloudName: getEnv("CLOUDINARY_CLOUD_NAME", ""),
		CloudinaryAPIKey:    getEnv("CLOUDINARY_API_KEY", ""),
		CloudinaryAPISecret: getEnv("CLOUDINARY_API_SECRET", ""),
		FirebaseKey:         getEnv("FIREBASE_KEY", ""),
		AppURL:              getEnv("APP_URL", "http://localhost:3000"),
		Environment:         getEnv("ENVIRONMENT", "development"),
		CORSAllowedOrigins:  getEnv("CORS_ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:8081"),

		// V1.3 — User Verification (OTP)
		BrevoAPIKey:             getEnv("BREVO_API_KEY", ""),
		MailFromEmail:           getEnv("MAIL_FROM_EMAIL", ""),
		BrevoEndpoint:           getEnv("BREVO_ENDPOINT", ""),
		TwilioAccountSID:        getEnv("TWILIO_ACCOUNT_SID", ""),
		TwilioAuthToken:         getEnv("TWILIO_AUTH_TOKEN", ""),
		TwilioFromNumber:        getEnv("TWILIO_FROM_NUMBER", ""),
		EnableEmailVerification: getEnv("ENABLE_EMAIL_VERIFICATION", "true") == "true",

		// V2.0 — Distributed Rate Limiting (Redis)
		RedisURL: getEnv("REDIS_URL", ""),

		AuthRateLimitMax: getEnvInt("RATE_LIMIT_AUTH_MAX", 5),

		// V1.2 — Image Search (Jina CLIP)
		JinaAPIKey:   getEnv("JINA_API_KEY", ""),
		JinaEndpoint: getEnv("JINA_ENDPOINT", ""),

		// One-off admin embeddings backfill (disabled unless set)
		ReindexToken: getEnv("REINDEX_TOKEN", ""),
	}

	// Fail-fast: JWT_SECRET is required in all environments.
	if cfg.JWTSecret == "" {
		log.Fatal("FATAL: JWT_SECRET environment variable is not set. Generate one with: openssl rand -hex 32")
	}

	return cfg
}

func getEnv(key, fallback string) string {
	if value, exists := os.LookupEnv(key); exists {
		return value
	}
	return fallback
}

func getEnvInt(key string, fallback int) int {
	if value, exists := os.LookupEnv(key); exists {
		if n, err := strconv.Atoi(value); err == nil {
			return n
		}
	}
	return fallback
}
