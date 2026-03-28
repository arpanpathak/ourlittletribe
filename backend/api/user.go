package api

import (
	"encoding/json"
	"net/http"

	"outlittletribe.us/backend/db"
)

func handleGetMe(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(UserIDKey).(string)

	var user db.User
	err := db.DB.QueryRow(
		`SELECT id, email, google_id, name, avatar_url, created_at FROM users WHERE id = $1`,
		userID,
	).Scan(&user.ID, &user.Email, &user.GoogleID, &user.Name, &user.AvatarURL, &user.CreatedAt)

	if err != nil {
		http.Error(w, "user not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(user)
}

func handleUpdateUser(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(UserIDKey).(string)
	targetUserID := r.PathValue("userId")

	if userID != targetUserID {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	var req struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}

	_, err := db.DB.Exec(`UPDATE users SET name = $1 WHERE id = $2`, req.Name, userID)
	if err != nil {
		http.Error(w, "failed to update user", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
}
