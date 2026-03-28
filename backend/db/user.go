package db

import (
	"database/sql"
	"time"
)

type User struct {
	ID        string    `json:"id"`
	Email     string    `json:"email"`
	GoogleID  string    `json:"google_id"`
	Name      string    `json:"name"`
	AvatarURL string    `json:"avatar_url"`
	CreatedAt time.Time `json:"created_at"`
}

func FindOrCreateUser(googleID, email, name, avatarURL string) (*User, error) {
	var user User
	err := DB.QueryRow(
		`SELECT id, email, google_id, name, avatar_url, created_at FROM users WHERE google_id = $1`,
		googleID,
	).Scan(&user.ID, &user.Email, &user.GoogleID, &user.Name, &user.AvatarURL, &user.CreatedAt)

	if err == sql.ErrNoRows {
		// Create new user
		err = DB.QueryRow(
			`INSERT INTO users (email, google_id, name, avatar_url) VALUES ($1, $2, $3, $4) RETURNING id, email, google_id, name, avatar_url, created_at`,
			email, googleID, name, avatarURL,
		).Scan(&user.ID, &user.Email, &user.GoogleID, &user.Name, &user.AvatarURL, &user.CreatedAt)

		if err != nil {
			return nil, err
		}
		return &user, nil
	} else if err != nil {
		return nil, err
	}

	return &user, nil
}
