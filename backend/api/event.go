package api

import (
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"time"

	"outlittletribe.us/backend/db"
)

type Event struct {
	ID            string    `json:"id"`
	TribeID       string    `json:"tribe_id"`
	CreatorID     string    `json:"creator_id"`
	Title         string    `json:"title"`
	Description   string    `json:"description"`
	CoverImageURL string    `json:"cover_image_url"`
	Location      string    `json:"location"`
	Lat           float64   `json:"lat"`
	Lng           float64   `json:"lng"`
	StartTime     time.Time `json:"start_time"`
	IsOfficial    bool      `json:"is_official"`
	CreatedAt     time.Time `json:"created_at"`
}

func handleCreateEvent(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(UserIDKey).(string)

	var req struct {
		TribeID       string    `json:"tribe_id"`
		Title         string    `json:"title"`
		Description   string    `json:"description"`
		CoverImageURL string    `json:"cover_image_url"`
		Location      string    `json:"location"`
		Lat           float64   `json:"lat"`
		Lng           float64   `json:"lng"`
		StartTime     time.Time `json:"start_time"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}

	var event Event
	err := db.DB.QueryRow(
		`INSERT INTO events (tribe_id, creator_id, title, description, cover_image_url, location, lat, lng, start_time) 
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) 
		RETURNING id, tribe_id, creator_id, title, description, cover_image_url, location, lat, lng, start_time, is_official, created_at`,
		req.TribeID, userID, req.Title, req.Description, req.CoverImageURL, req.Location, req.Lat, req.Lng, req.StartTime,
	).Scan(
		&event.ID, &event.TribeID, &event.CreatorID, &event.Title, &event.Description, &event.CoverImageURL,
		&event.Location, &event.Lat, &event.Lng, &event.StartTime, &event.IsOfficial, &event.CreatedAt,
	)

	if err != nil {
		http.Error(w, "failed to create event", http.StatusInternalServerError)
		return
	}

	// Implicitly upvote own event
	_, _ = db.DB.Exec(`INSERT INTO event_votes (event_id, user_id, vote) VALUES ($1, $2, 1)`, event.ID, userID)
	checkQuorum(event.ID, req.TribeID)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(event)
}

func handleListEvents(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(UserIDKey).(string)

	// Fetch official events AND drafted events for tribes the user is in
	rows, err := db.DB.Query(`
		SELECT e.id, e.tribe_id, e.creator_id, e.title, e.description, e.cover_image_url, e.location, e.lat, e.lng, e.start_time, e.is_official, e.created_at 
		FROM events e
		LEFT JOIN tribe_members tm ON e.tribe_id = tm.tribe_id AND tm.user_id = $1
		WHERE (e.is_official = TRUE) 
		   OR (e.is_official = FALSE AND tm.user_id IS NOT NULL)
		ORDER BY e.start_time ASC LIMIT 50
	`, userID)

	if err != nil {
		http.Error(w, "failed to fetch events: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	events := []Event{}
	for rows.Next() {
		var e Event
		var coverImage sql.NullString
		if err := rows.Scan(
			&e.ID, &e.TribeID, &e.CreatorID, &e.Title, &e.Description, &coverImage,
			&e.Location, &e.Lat, &e.Lng, &e.StartTime, &e.IsOfficial, &e.CreatedAt,
		); err != nil {
			log.Printf("scan error %v", err)
			continue
		}
		if coverImage.Valid {
			e.CoverImageURL = coverImage.String
		}
		events = append(events, e)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"events": events})
}

func handleGetEvent(w http.ResponseWriter, r *http.Request) {
	eventID := r.PathValue("eventId")

	var e Event
	err := db.DB.QueryRow(`
		SELECT id, tribe_id, creator_id, title, description, location, lat, lng, start_time, is_official, created_at 
		FROM events WHERE id = $1
	`, eventID).Scan(
		&e.ID, &e.TribeID, &e.CreatorID, &e.Title, &e.Description, &e.Location, &e.Lat, &e.Lng, &e.StartTime, &e.IsOfficial, &e.CreatedAt,
	)

	if err != nil {
		http.Error(w, "event not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(e)
}

func handleVoteEvent(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(UserIDKey).(string)
	eventID := r.PathValue("eventId")

	var req struct {
		Vote int `json:"vote"` // 1 or -1
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || (req.Vote != 1 && req.Vote != -1) {
		http.Error(w, "invalid vote, must be 1 or -1", http.StatusBadRequest)
		return
	}

	var tribeID string
	err := db.DB.QueryRow(`SELECT tribe_id FROM events WHERE id = $1`, eventID).Scan(&tribeID)
	if err != nil {
		http.Error(w, "event not found", http.StatusNotFound)
		return
	}

	// Upsert vote
	_, err = db.DB.Exec(`
		INSERT INTO event_votes (event_id, user_id, vote) VALUES ($1, $2, $3)
		ON CONFLICT (event_id, user_id) DO UPDATE SET vote = $3
	`, eventID, userID, req.Vote)

	if err != nil {
		http.Error(w, "failed to vote", http.StatusInternalServerError)
		return
	}

	// Check if this flipped it to official
	isOfficial := checkQuorum(eventID, tribeID)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"is_official": isOfficial})
}

// checkQuorum checks if an event has reached the voting threshold.
// Let's assume MVP quorum is simply: >= 3 positive net votes.
func checkQuorum(eventID, tribeID string) bool {
	var netVotes int
	err := db.DB.QueryRow(`SELECT COALESCE(SUM(vote), 0) FROM event_votes WHERE event_id = $1`, eventID).Scan(&netVotes)
	if err != nil {
		return false
	}

	targetVotes := 2 // MVP quorum target explicitly lowered to "Needs 1-2 approvals"

	var isOfficial bool
	_ = db.DB.QueryRow(`SELECT is_official FROM events WHERE id = $1`, eventID).Scan(&isOfficial)

	if netVotes >= targetVotes && !isOfficial {
		db.DB.Exec(`UPDATE events SET is_official = TRUE WHERE id = $1`, eventID)
		return true
	} else if netVotes < targetVotes && isOfficial {
		db.DB.Exec(`UPDATE events SET is_official = FALSE WHERE id = $1`, eventID)
		return false
	}

	return isOfficial
}
