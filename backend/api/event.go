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
	ID               string    `json:"id"`
	TribeID          string    `json:"tribe_id"`
	TribeName        string    `json:"tribe_name"`
	CreatorID        string    `json:"creator_id"`
	CreatorName      string    `json:"creator_name"`
	CreatorAvatarURL string    `json:"creator_avatar_url"`
	Title            string    `json:"title"`
	Description      string    `json:"description"`
	CoverImageURL    string    `json:"cover_image_url"`
	Location         string    `json:"location"`
	Lat              float64   `json:"lat"`
	Lng              float64   `json:"lng"`
	StartTime        time.Time `json:"start_time"`
	IsOfficial       bool      `json:"is_official"`
	CreatedAt        time.Time `json:"created_at"`

	// Vote details
	NetVotes int `json:"net_votes"`
	UserVote int `json:"user_vote"` // 1, -1, or 0

	// RSVP details
	GoingCount    int    `json:"going_count"`
	NotGoingCount int    `json:"not_going_count"`
	UserRsvp      string `json:"user_rsvp"` // "going", "not_going", or "none"
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

	var insertedID string
	err := db.DB.QueryRow(
		`INSERT INTO events (tribe_id, creator_id, title, description, cover_image_url, location, lat, lng, start_time) 
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) 
		RETURNING id`,
		req.TribeID, userID, req.Title, req.Description, req.CoverImageURL, req.Location, req.Lat, req.Lng, req.StartTime,
	).Scan(&insertedID)

	if err != nil {
		http.Error(w, "failed to create event", http.StatusInternalServerError)
		return
	}

	// Implicitly upvote own event
	_, _ = db.DB.Exec(`INSERT INTO event_votes (event_id, user_id, vote) VALUES ($1, $2, 1)`, insertedID, userID)
	checkQuorum(insertedID, req.TribeID)

	// Fetch full detailed event to return
	var event Event
	var coverImage sql.NullString
	var creatorAvatar sql.NullString

	err = db.DB.QueryRow(`
		SELECT 
			e.id, e.tribe_id, t.name as tribe_name, e.creator_id, u.name as creator_name, u.avatar_url as creator_avatar_url, 
			e.title, e.description, e.cover_image_url, e.location, e.lat, e.lng, e.start_time, e.is_official, e.created_at,
			COALESCE((SELECT SUM(vote) FROM event_votes WHERE event_id = e.id), 0) as net_votes,
			COALESCE((SELECT vote FROM event_votes WHERE event_id = e.id AND user_id = $1), 0) as user_vote,
			COALESCE((SELECT COUNT(*) FROM event_rsvps WHERE event_id = e.id AND status = 'going'), 0) as going_count,
			COALESCE((SELECT COUNT(*) FROM event_rsvps WHERE event_id = e.id AND status = 'not_going'), 0) as not_going_count,
			COALESCE((SELECT status FROM event_rsvps WHERE event_id = e.id AND user_id = $1), 'none') as user_rsvp
		FROM events e
		JOIN users u ON e.creator_id = u.id
		JOIN tribes t ON e.tribe_id = t.id
		WHERE e.id = $2
	`, userID, insertedID).Scan(
		&event.ID, &event.TribeID, &event.TribeName, &event.CreatorID, &event.CreatorName, &creatorAvatar,
		&event.Title, &event.Description, &coverImage, &event.Location, &event.Lat, &event.Lng, &event.StartTime, &event.IsOfficial, &event.CreatedAt,
		&event.NetVotes, &event.UserVote, &event.GoingCount, &event.NotGoingCount, &event.UserRsvp,
	)

	if err != nil {
		http.Error(w, "failed to retrieve created event detail", http.StatusInternalServerError)
		return
	}

	if coverImage.Valid {
		event.CoverImageURL = coverImage.String
	}
	if creatorAvatar.Valid {
		event.CreatorAvatarURL = creatorAvatar.String
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(event)
}

func handleListEvents(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(UserIDKey).(string)

	rows, err := db.DB.Query(`
		SELECT 
			e.id, e.tribe_id, t.name as tribe_name, e.creator_id, u.name as creator_name, u.avatar_url as creator_avatar_url, 
			e.title, e.description, e.cover_image_url, e.location, e.lat, e.lng, e.start_time, e.is_official, e.created_at,
			COALESCE((SELECT SUM(vote) FROM event_votes WHERE event_id = e.id), 0) as net_votes,
			COALESCE((SELECT vote FROM event_votes WHERE event_id = e.id AND user_id = $1), 0) as user_vote,
			COALESCE((SELECT COUNT(*) FROM event_rsvps WHERE event_id = e.id AND status = 'going'), 0) as going_count,
			COALESCE((SELECT COUNT(*) FROM event_rsvps WHERE event_id = e.id AND status = 'not_going'), 0) as not_going_count,
			COALESCE((SELECT status FROM event_rsvps WHERE event_id = e.id AND user_id = $1), 'none') as user_rsvp
		FROM events e
		JOIN users u ON e.creator_id = u.id
		JOIN tribes t ON e.tribe_id = t.id
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
		var creatorAvatar sql.NullString
		if err := rows.Scan(
			&e.ID, &e.TribeID, &e.TribeName, &e.CreatorID, &e.CreatorName, &creatorAvatar,
			&e.Title, &e.Description, &coverImage, &e.Location, &e.Lat, &e.Lng, &e.StartTime, &e.IsOfficial, &e.CreatedAt,
			&e.NetVotes, &e.UserVote, &e.GoingCount, &e.NotGoingCount, &e.UserRsvp,
		); err != nil {
			log.Printf("scan error %v", err)
			continue
		}
		if coverImage.Valid {
			e.CoverImageURL = coverImage.String
		}
		if creatorAvatar.Valid {
			e.CreatorAvatarURL = creatorAvatar.String
		}
		events = append(events, e)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"events": events})
}

func handleGetEvent(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(UserIDKey).(string)
	eventID := r.PathValue("eventId")

	var e Event
	var coverImage sql.NullString
	var creatorAvatar sql.NullString

	err := db.DB.QueryRow(`
		SELECT 
			e.id, e.tribe_id, t.name as tribe_name, e.creator_id, u.name as creator_name, u.avatar_url as creator_avatar_url, 
			e.title, e.description, e.cover_image_url, e.location, e.lat, e.lng, e.start_time, e.is_official, e.created_at,
			COALESCE((SELECT SUM(vote) FROM event_votes WHERE event_id = e.id), 0) as net_votes,
			COALESCE((SELECT vote FROM event_votes WHERE event_id = e.id AND user_id = $1), 0) as user_vote,
			COALESCE((SELECT COUNT(*) FROM event_rsvps WHERE event_id = e.id AND status = 'going'), 0) as going_count,
			COALESCE((SELECT COUNT(*) FROM event_rsvps WHERE event_id = e.id AND status = 'not_going'), 0) as not_going_count,
			COALESCE((SELECT status FROM event_rsvps WHERE event_id = e.id AND user_id = $1), 'none') as user_rsvp
		FROM events e
		JOIN users u ON e.creator_id = u.id
		JOIN tribes t ON e.tribe_id = t.id
		WHERE e.id = $2
	`, userID, eventID).Scan(
		&e.ID, &e.TribeID, &e.TribeName, &e.CreatorID, &e.CreatorName, &creatorAvatar,
		&e.Title, &e.Description, &coverImage, &e.Location, &e.Lat, &e.Lng, &e.StartTime, &e.IsOfficial, &e.CreatedAt,
		&e.NetVotes, &e.UserVote, &e.GoingCount, &e.NotGoingCount, &e.UserRsvp,
	)

	if err != nil {
		http.Error(w, "event not found", http.StatusNotFound)
		return
	}

	if coverImage.Valid {
		e.CoverImageURL = coverImage.String
	}
	if creatorAvatar.Valid {
		e.CreatorAvatarURL = creatorAvatar.String
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

func handleRsvpEvent(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(UserIDKey).(string)
	eventID := r.PathValue("eventId")

	var req struct {
		Status string `json:"status"` // "going", "not_going", or "none"
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}

	if req.Status != "going" && req.Status != "not_going" && req.Status != "none" {
		http.Error(w, "invalid status, must be 'going', 'not_going', or 'none'", http.StatusBadRequest)
		return
	}

	var err error
	if req.Status == "none" {
		_, err = db.DB.Exec(`DELETE FROM event_rsvps WHERE event_id = $1 AND user_id = $2`, eventID, userID)
	} else {
		_, err = db.DB.Exec(`
			INSERT INTO event_rsvps (event_id, user_id, status) VALUES ($1, $2, $3)
			ON CONFLICT (event_id, user_id) DO UPDATE SET status = $3
		`, eventID, userID, req.Status)
	}

	if err != nil {
		http.Error(w, "failed to update RSVP", http.StatusInternalServerError)
		return
	}

	// Fetch new counts
	var goingCount int
	var notGoingCount int
	_ = db.DB.QueryRow(`SELECT COUNT(*) FROM event_rsvps WHERE event_id = $1 AND status = 'going'`, eventID).Scan(&goingCount)
	_ = db.DB.QueryRow(`SELECT COUNT(*) FROM event_rsvps WHERE event_id = $1 AND status = 'not_going'`, eventID).Scan(&notGoingCount)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":          req.Status,
		"going_count":     goingCount,
		"not_going_count": notGoingCount,
	})
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
