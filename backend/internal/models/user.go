package models

import "time"

type User struct {
	ID        string    `json:"id"`
	Email     string    `json:"email"`
	GoogleID  string    `json:"google_id"`
	Name      string    `json:"name"`
	AvatarURL string    `json:"avatar_url"`
	Bio       string    `json:"bio"`
	Location  string    `json:"location"`
	CreatedAt time.Time `json:"created_at"`
}

type UserProfile struct {
	User
	Tribes         []Tribe    `json:"tribes"`
	Events         []Event    `json:"events"`
	RecentActivity []Activity `json:"recent_activity"`
}

type NotificationSettings struct {
	UserID             string    `json:"user_id"`
	EmailNotifications bool      `json:"email_notifications"`
	PushNotifications  bool      `json:"push_notifications"`
	EventReminders     bool      `json:"event_reminders"`
	UpdatedAt          time.Time `json:"updated_at"`
}
