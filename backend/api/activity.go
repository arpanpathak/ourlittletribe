package api

import (
	"encoding/json"
	"net/http"
)

func handleGetActivities(w http.ResponseWriter, r *http.Request) {
	activities, err := RepoStore.GetRecentActivities(50)
	if err != nil {
		http.Error(w, "failed to fetch activities", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"activities": activities})
}
