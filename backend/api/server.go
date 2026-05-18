package api

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/prometheus/client_golang/prometheus/promhttp"
	"outlittletribe.us/backend/db"
	"outlittletribe.us/backend/internal/repository"
)

func RegisterRoutes(mux *http.ServeMux) {
	// Initialize Shared Repository Store
	RepoStore = repository.NewStore(db.DB)

	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	})

	mux.Handle("GET /metrics", promhttp.Handler())

	// Auth
	mux.HandleFunc("GET /v1/auth/google/login", handleGoogleLogin)
	mux.HandleFunc("GET /v1/auth/google/callback", handleGoogleCallback)
	mux.HandleFunc("POST /v1/auth/logout", handleLogout)

	// Users (Protected)
	mux.HandleFunc("GET /v1/users/me", AuthMiddleware(handleGetMe))
	mux.HandleFunc("PATCH /v1/users/{userId}", AuthMiddleware(handleUpdateUser))

	// Tribes (Protected)
	mux.HandleFunc("POST /v1/tribes", AuthMiddleware(handleCreateTribe))
	mux.HandleFunc("GET /v1/tribes", AuthMiddleware(handleListTribes))
	mux.HandleFunc("GET /v1/tribes/{pathId}", AuthMiddleware(func(w http.ResponseWriter, r *http.Request) {
		pathId := r.PathValue("pathId")
		// if GET /v1/tribes/123
		r.SetPathValue("tribeId", pathId)
		handleGetTribe(w, r)
	}))

	mux.HandleFunc("POST /v1/tribes/{pathId}", AuthMiddleware(func(w http.ResponseWriter, r *http.Request) {
		pathId := r.PathValue("pathId")
		if strings.HasSuffix(pathId, ":join") {
			tribeId := strings.TrimSuffix(pathId, ":join")
			r.SetPathValue("tribeId", tribeId)
			handleJoinTribe(w, r)
			return
		}
		if strings.HasSuffix(pathId, ":leave") {
			tribeId := strings.TrimSuffix(pathId, ":leave")
			r.SetPathValue("tribeId", tribeId)
			handleLeaveTribe(w, r)
			return
		}
		http.NotFound(w, r)
	}))

	// Events (Protected)
	mux.HandleFunc("POST /v1/events", AuthMiddleware(handleCreateEvent))
	mux.HandleFunc("GET /v1/events", AuthMiddleware(handleListEvents))
	mux.HandleFunc("GET /v1/events/{pathId}", AuthMiddleware(func(w http.ResponseWriter, r *http.Request) {
		pathId := r.PathValue("pathId")
		r.SetPathValue("eventId", pathId)
		handleGetEvent(w, r)
	}))

	mux.HandleFunc("POST /v1/events/{pathId}", AuthMiddleware(func(w http.ResponseWriter, r *http.Request) {
		pathId := r.PathValue("pathId")
		if strings.HasSuffix(pathId, ":vote") {
			eventId := strings.TrimSuffix(pathId, ":vote")
			r.SetPathValue("eventId", eventId)
			handleVoteEvent(w, r)
			return
		}
		if strings.HasSuffix(pathId, ":rsvp") {
			eventId := strings.TrimSuffix(pathId, ":rsvp")
			r.SetPathValue("eventId", eventId)
			handleRsvpEvent(w, r)
			return
		}
		http.NotFound(w, r)
	}))

	// New Features (Protected)
	mux.HandleFunc("GET /v1/search", AuthMiddleware(handleGlobalSearch))
	mux.HandleFunc("GET /v1/activities", AuthMiddleware(handleGetActivities))

	// Profiles
	mux.HandleFunc("GET /v1/profile", AuthMiddleware(handleGetProfile))
	mux.HandleFunc("PATCH /v1/profile", AuthMiddleware(handleUpdateProfile))

	// Notification Settings
	mux.HandleFunc("GET /v1/settings/notifications", AuthMiddleware(handleGetNotificationSettings))
	mux.HandleFunc("PATCH /v1/settings/notifications", AuthMiddleware(handleUpdateNotificationSettings))
}
