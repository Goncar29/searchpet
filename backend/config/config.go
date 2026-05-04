package config

import (
	"log"
	"os"

	"github.com/joho/godotenv"
)

type Config struct {
	Port          string
	DatabaseURL   string
	JWTSecret     string
	CloudinaryURL string
	FirebaseKey   string
	AppURL        string
	Environment   string
}

func Load() *Config {
	if err := godotenv.Load(); err != nil {
		log.Println("No .env file found, using system environment variables")
	}

	return &Config{
		Port:          getEnv("PORT", "8080"),
		DatabaseURL:   getEnv("DATABASE_URL", "postgres://postgres:postgres@localhost:5432/lostpets?sslmode=disable"),
		JWTSecret:     getEnv("JWT_SECRET", "super-secret-key-change-in-production"),
		CloudinaryURL: getEnv("CLOUDINARY_URL", ""),
		FirebaseKey:   getEnv("FIREBASE_KEY", ""),
		AppURL:        getEnv("APP_URL", "http://localhost:8080"),
		Environment:   getEnv("ENVIRONMENT", "development"),
	}
}

func getEnv(key, fallback string) string {
	if value, exists := os.LookupEnv(key); exists {
		return value
	}
	return fallback
}
