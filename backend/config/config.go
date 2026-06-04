package config

import (
	"log"
	"os"

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

	// V1.3 — User Verification (OTP)
	SendGridAPIKey           string
	TwilioAccountSID         string
	TwilioAuthToken          string
	TwilioFromNumber         string
	EnableEmailVerification  bool

	// V2.0 — Distributed Rate Limiting (Redis)
	RedisURL string
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
		SendGridAPIKey:          getEnv("SENDGRID_API_KEY", ""),
		TwilioAccountSID:        getEnv("TWILIO_ACCOUNT_SID", ""),
		TwilioAuthToken:         getEnv("TWILIO_AUTH_TOKEN", ""),
		TwilioFromNumber:        getEnv("TWILIO_FROM_NUMBER", ""),
		EnableEmailVerification: getEnv("ENABLE_EMAIL_VERIFICATION", "true") == "true",

		// V2.0 — Distributed Rate Limiting (Redis)
		RedisURL: getEnv("REDIS_URL", ""),
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
