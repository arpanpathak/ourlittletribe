package api

import (
	"encoding/json"
	"net/http"

	"outlittletribe.us/backend/internal/models"
)

func handleGetNotificationSettings(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(UserIDKey).(string)

	settings, err := RepoStore.GetNotificationSettings(userID)
	if err != nil {
		http.Error(w, "failed to fetch settings", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(settings)
}

func handleUpdateNotificationSettings(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(UserIDKey).(string)

	var req models.NotificationSettings
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}
	req.UserID = userID // Ensure they can only update their own

	if err := RepoStore.UpdateNotificationSettings(&req); err != nil {
		http.Error(w, "failed to update settings", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
}
