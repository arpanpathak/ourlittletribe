package db

import (
	"database/sql"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
)

// TestFindOrCreateUser_UserExists tests that when a user already exists in the database,
// the function successfully retrieves and returns the user without attempting to insert a new one.
func TestFindOrCreateUser_UserExists(t *testing.T) {
	// Setup the mock database
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("Failed to create mock database: %v", err)
	}
	defer db.Close()

	// Intercept the global DB variable with our mock
	originalDB := DB
	DB = db
	defer func() { DB = originalDB }()

	googleID := "g-123"
	email := "test@example.com"
	name := "Test User"
	avatarURL := "http://example.com/avatar.jpg"
	now := time.Now()

	// Expect a SELECT query looking up the user by google_id
	rows := sqlmock.NewRows([]string{"id", "email", "google_id", "name", "avatar_url", "created_at"}).
		AddRow("u-999", email, googleID, name, avatarURL, now)

	mock.ExpectQuery(`SELECT id, email, google_id, name, avatar_url, created_at FROM users WHERE google_id = \$1`).
		WithArgs(googleID).
		WillReturnRows(rows)

	// Execute business logic
	user, err := FindOrCreateUser(googleID, email, name, avatarURL)

	// Verify assertions
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	if user == nil {
		t.Fatal("Expected user object, got nil")
	}
	if user.ID != "u-999" {
		t.Errorf("Expected ID 'u-999', got %s", user.ID)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("Unfulfilled database expectations: %v", err)
	}
}

// TestFindOrCreateUser_NewUser tests the scenario where the user does not exist.
// Expects the SELECT query to fail with ErrNoRows, followed immediately by an INSERT query.
func TestFindOrCreateUser_NewUser(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("Failed to create mock base: %v", err)
	}
	defer db.Close()

	originalDB := DB
	DB = db
	defer func() { DB = originalDB }()

	googleID := "g-new"
	email := "new@example.com"
	name := "New User"
	avatarURL := "http://example.com/new.jpg"
	now := time.Now()

	// 1. SELECT returns no rows
	mock.ExpectQuery(`SELECT id, email, google_id, name, avatar_url, created_at FROM users WHERE google_id = \$1`).
		WithArgs(googleID).
		WillReturnError(sql.ErrNoRows)

	// 2. We immediately expect an INSERT with RETURNING clause
	insertRows := sqlmock.NewRows([]string{"id", "email", "google_id", "name", "avatar_url", "created_at"}).
		AddRow("u-1234", email, googleID, name, avatarURL, now)

	mock.ExpectQuery(`INSERT INTO users \(email, google_id, name, avatar_url\) VALUES \(\$1, \$2, \$3, \$4\) RETURNING id, email, google_id, name, avatar_url, created_at`).
		WithArgs(email, googleID, name, avatarURL).
		WillReturnRows(insertRows)

	user, err := FindOrCreateUser(googleID, email, name, avatarURL)

	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	if user.ID != "u-1234" {
		t.Errorf("Expected user to be created with ID 'u-1234', got %s", user.ID)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("Unfulfilled database expectations: %v", err)
	}
}

// TestFindOrCreateUser_DBFailure_Select tests if the SELECT query throws an unexpected DB error.
func TestFindOrCreateUser_DBFailure_Select(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("Failed to create mock: %v", err)
	}
	defer db.Close()

	originalDB := DB
	DB = db
	defer func() { DB = originalDB }()

	googleID := "g-error"

	mock.ExpectQuery(`SELECT id, email, google_id, name, avatar_url, created_at FROM users WHERE google_id = \$1`).
		WithArgs(googleID).
		WillReturnError(sql.ErrConnDone) // Simulating a dropped connection

	user, err := FindOrCreateUser(googleID, "", "", "")

	if err == nil {
		t.Fatal("Expected an error due to DB connection failure, got nil")
	}
	if user != nil {
		t.Errorf("Expected nil user, got %v", user)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("Unfulfilled expectations: %v", err)
	}
}

// TestFindOrCreateUser_DBFailure_Insert tests if the INSERT query throws an error after a NoRows response.
func TestFindOrCreateUser_DBFailure_Insert(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("Failed to create mock: %v", err)
	}
	defer db.Close()

	originalDB := DB
	DB = db
	defer func() { DB = originalDB }()

	googleID := "g-new-error"

	mock.ExpectQuery(`SELECT id, email, google_id, name, avatar_url, created_at FROM users WHERE google_id = \$1`).
		WithArgs(googleID).
		WillReturnError(sql.ErrNoRows)

	mock.ExpectQuery(`INSERT INTO users \(email, google_id, name, avatar_url\) VALUES \(\$1, \$2, \$3, \$4\) RETURNING id, email, google_id, name, avatar_url, created_at`).
		WillReturnError(sql.ErrTxDone)

	user, err := FindOrCreateUser(googleID, "", "", "")

	if err == nil {
		t.Fatal("Expected an error due to INSERT failure, got nil")
	}
	if user != nil {
		t.Errorf("Expected nil user, got %v", user)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("Unfulfilled expectations: %v", err)
	}
}
