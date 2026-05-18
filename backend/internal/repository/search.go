package repository

import (
	"outlittletribe.us/backend/internal/models"
)

// SearchGlobal performs a cross-domain ILIKE search for tribes, events, and members
func (s *Store) SearchGlobal(query string) (*models.SearchResults, error) {
	results := &models.SearchResults{
		Tribes: []models.Tribe{},
		Events: []models.Event{},
		Users:  []models.User{},
	}
	
	searchPattern := "%" + query + "%"

	// Search Tribes
	tRows, err := s.DB.Query(`SELECT id, name, description FROM tribes WHERE name ILIKE $1 OR description ILIKE $1 LIMIT 10`, searchPattern)
	if err == nil {
		defer tRows.Close()
		for tRows.Next() {
			var t models.Tribe
			if tRows.Scan(&t.ID, &t.Name, &t.Description) == nil {
				results.Tribes = append(results.Tribes, t)
			}
		}
	}

	// Search Events
	eRows, err := s.DB.Query(`SELECT id, title, description FROM events WHERE title ILIKE $1 OR description ILIKE $1 LIMIT 10`, searchPattern)
	if err == nil {
		defer eRows.Close()
		for eRows.Next() {
			var e models.Event
			if eRows.Scan(&e.ID, &e.Title, &e.Description) == nil {
				results.Events = append(results.Events, e)
			}
		}
	}

	// Search Users
	uRows, err := s.DB.Query(`SELECT id, name, avatar_url, COALESCE(bio, '') FROM users WHERE name ILIKE $1 OR bio ILIKE $1 LIMIT 10`, searchPattern)
	if err == nil {
		defer uRows.Close()
		for uRows.Next() {
			var u models.User
			if uRows.Scan(&u.ID, &u.Name, &u.AvatarURL, &u.Bio) == nil {
				results.Users = append(results.Users, u)
			}
		}
	}

	return results, nil
}
