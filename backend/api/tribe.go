package api

import (
	"encoding/json"
	"net/http"
	"time"

	"outlittletribe.us/backend/db"
)

type Tribe struct {
	ID          string          `json:"id"`
	CreatorID   string          `json:"creator_id"`
	Name        string          `json:"name"`
	Description string          `json:"description"`
	CreatedAt   time.Time       `json:"created_at"`
	IsMember    bool            `json:"is_member"`         // Added for frontend context
	MemberCount int             `json:"member_count"`      // Track number of joined members
	Members     json.RawMessage `json:"members,omitempty"` // json_agg of joined members
}

func handleCreateTribe(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(UserIDKey).(string)

	var req struct {
		Name        string `json:"name"`
		Description string `json:"description"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}

	var tribe Tribe
	err := db.DB.QueryRow(
		`INSERT INTO tribes (creator_id, name, description) VALUES ($1, $2, $3) RETURNING id, creator_id, name, description, created_at`,
		userID, req.Name, req.Description,
	).Scan(&tribe.ID, &tribe.CreatorID, &tribe.Name, &tribe.Description, &tribe.CreatedAt)

	if err != nil {
		http.Error(w, "failed to create tribe", http.StatusInternalServerError)
		return
	}

	// Creator automatically joins the tribe
	_, _ = db.DB.Exec(`INSERT INTO tribe_members (tribe_id, user_id) VALUES ($1, $2)`, tribe.ID, userID)

	// Log Activity
	_ = RepoStore.LogActivity(userID, "CREATED_TRIBE", tribe.ID, "TRIBE", map[string]string{"name": tribe.Name})

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(tribe)
}

func handleListTribes(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(UserIDKey).(string)

	rows, err := db.DB.Query(`
		SELECT t.id, t.creator_id, t.name, t.description, t.created_at, 
		       (tm_current.user_id IS NOT NULL) as is_member,
			   (SELECT COUNT(*) FROM tribe_members WHERE tribe_id = t.id) as member_count,
			   COALESCE(
					(
						SELECT json_agg(json_build_object('id', u.id, 'name', u.name, 'avatar_url', u.avatar_url))
						FROM tribe_members tm_join
						JOIN users u ON tm_join.user_id = u.id
						WHERE tm_join.tribe_id = t.id
					),
					'[]'::json
			   ) as members
		FROM tribes t
		LEFT JOIN tribe_members tm_current ON t.id = tm_current.tribe_id AND tm_current.user_id = $1
		ORDER BY t.created_at DESC LIMIT 50
	`, userID)

	if err != nil {
		http.Error(w, "failed to fetch tribes", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	tribes := []Tribe{}
	for rows.Next() {
		var t Tribe
		var membersJSON []byte
		if err := rows.Scan(&t.ID, &t.CreatorID, &t.Name, &t.Description, &t.CreatedAt, &t.IsMember, &t.MemberCount, &membersJSON); err != nil {
			continue
		}
		t.Members = membersJSON
		tribes = append(tribes, t)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"tribes": tribes})
}

func handleGetTribe(w http.ResponseWriter, r *http.Request) {
	tribeID := r.PathValue("tribeId")

	var t Tribe
	err := db.DB.QueryRow(`
		SELECT id, creator_id, name, description, created_at,
		       (SELECT COUNT(*) FROM tribe_members WHERE tribe_id = $1) as member_count
		FROM tribes WHERE id = $1
	`, tribeID).Scan(&t.ID, &t.CreatorID, &t.Name, &t.Description, &t.CreatedAt, &t.MemberCount)

	if err != nil {
		http.Error(w, "tribe not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(t)
}

func handleJoinTribe(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(UserIDKey).(string)
	tribeID := r.PathValue("tribeId")

	_, err := db.DB.Exec(`INSERT INTO tribe_members (tribe_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, tribeID, userID)
	if err != nil {
		http.Error(w, "failed to join tribe", http.StatusInternalServerError)
		return
	}

	// Log Activity
	_ = RepoStore.LogActivity(userID, "JOINED_TRIBE", tribeID, "TRIBE", nil)

	w.WriteHeader(http.StatusOK)
}

func handleLeaveTribe(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(UserIDKey).(string)
	tribeID := r.PathValue("tribeId")

	_, err := db.DB.Exec(`DELETE FROM tribe_members WHERE tribe_id = $1 AND user_id = $2`, tribeID, userID)
	if err != nil {
		http.Error(w, "failed to leave tribe", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
}
