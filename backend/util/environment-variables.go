package util

import "os"

func GetEnv(key string) string {
	return os.Getenv(key)
}

// OAuth 2.0 Constants
const (
	GOOGLE_CLIENT_ID     = "GOOGLE_CLIENT_ID"
	GOOGLE_CLIENT_SECRET = "GOOGLE_CLIENT_SECRET"
	GOOGLE_CALLBACK_URL  = "GOOGLE_CALLBACK_URL"
	JWT_SECRET           = "JWT_SECRET"
	FRONTEND_URL         = "FRONTEND_URL"
)
