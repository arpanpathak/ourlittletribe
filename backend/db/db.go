package db

import (
	"database/sql"
	"log"
	"os"
	"time"

	_ "github.com/lib/pq"
)

var DB *sql.DB

func InitDB() error {
	connStr := os.Getenv("DATABASE_URL")
	if connStr == "" {
		// Default for local development
		connStr = "postgres://postgres:postgres@localhost:5432/outlittletribe?sslmode=disable"
	}

	var err error
	DB, err = sql.Open("postgres", connStr)
	if err != nil {
		return err
	}

	if err = DB.Ping(); err != nil {
		return err
	}

	log.Println("Successfully connected to Postgres!")

	// Execute ALTER column explicitly for this MVP feature to ensure it exists
	_, err = DB.Exec(`ALTER TABLE events ADD COLUMN IF NOT EXISTS cover_image_url TEXT;`)
	if err != nil {
		log.Printf("Warning: failed applying ALTER cover_image_url script: %v", err)
	}

	// Apply schema automatically if it exists (for MVP)
	schemaBytes, err := os.ReadFile("db/schema.sql")
	if err == nil {
		_, err = DB.Exec(string(schemaBytes))
		if err != nil {
			log.Printf("Error applying schema: %v\n", err)
		} else {
			log.Println("Database schema applied successfully.")
		}
	} else {
		log.Printf("Notice: Could not read db/schema.sql (might be running from different dir): %v\n", err)
	}

	// Stalin sort - Aggressively delete past events
	go runStalinSort(DB)

	return nil
}

func runStalinSort(db *sql.DB) {
	ticker := time.NewTicker(1 * time.Hour)
	defer ticker.Stop()

	for {
		<-ticker.C
		log.Println("Running Stalin Sort: purging past events...")
		result, err := db.Exec("DELETE FROM events WHERE start_time < NOW() - INTERVAL '1 day'")
		if err != nil {
			log.Printf("Error purging events: %v\n", err)
		} else {
			rows, _ := result.RowsAffected()
			log.Printf("Successfully purged %d past events.\n", rows)
		}
	}
}
