package models

import (
	"encoding/json"
	"time"
)

type Activity struct {
	ID         string          `json:"id"`
	UserID     string          `json:"user_id"`
	ActionType string          `json:"action_type"`
	TargetID   string          `json:"target_id,omitempty"`
	TargetType string          `json:"target_type,omitempty"`
	Details    json.RawMessage `json:"details,omitempty"`
	CreatedAt  time.Time       `json:"created_at"`
}
