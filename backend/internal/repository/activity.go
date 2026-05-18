package repository

import (
	"encoding/json"

	"outlittletribe.us/backend/internal/models"
)

// LogActivity logs a user activity action to the database
func (s *Store) LogActivity(userID, actionType, targetID, targetType string, details interface{}) error {
	var detailsJSON []byte
	if details != nil {
		detailsJSON, _ = json.Marshal(details)
	}
	
	_, err := s.DB.Exec(`
		INSERT INTO activities (user_id, action_type, target_id, target_type, details)
		VALUES ($1, $2, $3, $4, $5)
	`, userID, actionType, targetID, targetType, detailsJSON)
	return err
}

// GetRecentActivities retrieves the most recent activity logs up to a limit
func (s *Store) GetRecentActivities(limit int) ([]models.Activity, error) {
	rows, err := s.DB.Query(`
		SELECT id, user_id, action_type, target_id, target_type, details, created_at
		FROM activities
		ORDER BY created_at DESC LIMIT $1
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var activities []models.Activity
	for rows.Next() {
		var a models.Activity
		var detailsJSON []byte
		if err := rows.Scan(&a.ID, &a.UserID, &a.ActionType, &a.TargetID, &a.TargetType, &detailsJSON, &a.CreatedAt); err == nil {
			a.Details = detailsJSON
			activities = append(activities, a)
		}
	}
	return activities, nil
}
