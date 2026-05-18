package api

import (
	"encoding/json"
	"net/http"

	"outlittletribe.us/backend/internal/models"
)

func handleGlobalSearch(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query().Get("q")
	if query == "" {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(models.SearchResults{})
		return
	}

	results, err := RepoStore.SearchGlobal(query)
	if err != nil {
		http.Error(w, "search failed", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(results)
}
