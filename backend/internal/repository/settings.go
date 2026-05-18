package repository

import (
	"database/sql"

	"outlittletribe.us/backend/internal/models"
)

// GetNotificationSettings retrieves notification settings or returns default if not set
func (s *Store) GetNotificationSettings(userID string) (*models.NotificationSettings, error) {
	var settings models.NotificationSettings
	err := s.DB.QueryRow(`
		SELECT user_id, email_notifications, push_notifications, event_reminders, updated_at
		FROM notification_settings WHERE user_id = $1
	`, userID).Scan(&settings.UserID, &settings.EmailNotifications, &settings.PushNotifications, &settings.EventReminders, &settings.UpdatedAt)
	
	if err == sql.ErrNoRows {
		// Default settings
		return &models.NotificationSettings{
			UserID:             userID,
			EmailNotifications: true,
			PushNotifications:  true,
			EventReminders:     true,
		}, nil
	}
	return &settings, err
}

// UpdateNotificationSettings upserts the user's notification preferences
func (s *Store) UpdateNotificationSettings(settings *models.NotificationSettings) error {
	_, err := s.DB.Exec(`
		INSERT INTO notification_settings (user_id, email_notifications, push_notifications, event_reminders)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (user_id) DO UPDATE SET 
			email_notifications = EXCLUDED.email_notifications,
			push_notifications = EXCLUDED.push_notifications,
			event_reminders = EXCLUDED.event_reminders,
			updated_at = CURRENT_TIMESTAMP
	`, settings.UserID, settings.EmailNotifications, settings.PushNotifications, settings.EventReminders)
	return err
}
