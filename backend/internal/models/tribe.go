package models

import (
	"encoding/json"
	"time"
)

type Tribe struct {
	ID          string          `json:"id"`
	CreatorID   string          `json:"creator_id"`
	Name        string          `json:"name"`
	Description string          `json:"description"`
	CreatedAt   time.Time       `json:"created_at"`
	IsMember    bool            `json:"is_member"`
	MemberCount int             `json:"member_count"`
	Members     json.RawMessage `json:"members,omitempty"`
}
