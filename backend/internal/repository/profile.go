package repository

import (
	"outlittletribe.us/backend/internal/models"
)

// GetUserProfile retrieves the user's basic details, joined tribes, and rsvped events
func (s *Store) GetUserProfile(userID string) (*models.UserProfile, error) {
	var profile models.UserProfile

	// Get basic user info
	err := s.DB.QueryRow(`
		SELECT id, email, google_id, name, avatar_url, COALESCE(bio, ''), COALESCE(location, ''), created_at 
		FROM users WHERE id = $1
	`, userID).Scan(&profile.ID, &profile.Email, &profile.GoogleID, &profile.Name, &profile.AvatarURL, &profile.Bio, &profile.Location, &profile.CreatedAt)
	if err != nil {
		return nil, err
	}

	// Get tribes user joined
	rows, err := s.DB.Query(`
		SELECT t.id, t.name, t.description, t.created_at 
		FROM tribes t
		JOIN tribe_members tm ON t.id = tm.tribe_id
		WHERE tm.user_id = $1
	`, userID)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var t models.Tribe
			if err := rows.Scan(&t.ID, &t.Name, &t.Description, &t.CreatedAt); err == nil {
				profile.Tribes = append(profile.Tribes, t)
			}
		}
	}

	// Get events user RSVP'd going
	eventRows, err := s.DB.Query(`
		SELECT e.id, e.title, e.description, e.location, e.start_time 
		FROM events e
		JOIN event_rsvps er ON e.id = er.event_id
		WHERE er.user_id = $1 AND er.status = 'going'
	`, userID)
	if err == nil {
		defer eventRows.Close()
		for eventRows.Next() {
			var e models.Event
			if err := eventRows.Scan(&e.ID, &e.Title, &e.Description, &e.Location, &e.StartTime); err == nil {
				profile.Events = append(profile.Events, e)
			}
		}
	}

	return &profile, nil
}

// UpdateUserProfile updates a user's bio and location details in the database
func (s *Store) UpdateUserProfile(userID, bio, location string) error {
	_, err := s.DB.Exec(`UPDATE users SET bio = $1, location = $2 WHERE id = $3`, bio, location, userID)
	return err
}
