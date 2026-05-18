package models

import "time"

type Event struct {
	ID            string    `json:"id"`
	TribeID       string    `json:"tribe_id"`
	TribeName     string    `json:"tribe_name,omitempty"`
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
	RSVPCount     int       `json:"rsvp_count"`
	UserRSVP      string    `json:"user_rsvp,omitempty"` // 'going', 'not_going', or empty
}
