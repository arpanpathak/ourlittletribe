package main

import (
	"log"
	"net/http"
	"os"

	"outlittletribe.us/backend/api"
	"outlittletribe.us/backend/db"
)

func main() {
	if err := db.InitDB(); err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}

	mux := http.NewServeMux()

	// Register API routes
	api.RegisterRoutes(mux)

	// Apply global middleware (Security, Rate Limit, CORS, Internal Logging)
	handler := api.LoggingMiddleware(
		api.RateLimitMiddleware(
			api.SecurityHeadersMiddleware(
				api.CorsMiddleware(mux),
			),
		),
	)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("Starting Our Little Tribe backend on port %s", port)
	if err := http.ListenAndServe(":"+port, handler); err != nil {
		log.Fatal(err)
	}
}
