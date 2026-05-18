package models

type SearchResults struct {
	Tribes []Tribe `json:"tribes"`
	Events []Event `json:"events"`
	Users  []User  `json:"users"`
}
