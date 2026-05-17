# ⚙️ OutLittleTribe Backend API

Welcome to the backend engine of OutLittleTribe. This is a high-performance, strictly typed REST API built entirely in **Go** utilizing the standard `net/http` library.

## 🏗 Architecture (MVC)

The codebase strictly isolates concerns into layers to ensure high testability and clean, domain-driven design:

- **`api/` (Controllers & Middleware):** Handles inbound HTTP requests, JSON parsing, routing, and robust middleware pipelines (CORS, Rate Limiting, Security Headers, JWT Auth validation).
- **`db/` (Data Access Layer):** Pure database repositories. Isolates all raw SQL interactions with the PostgreSQL database.
- **`main.go`:** The entry point. Bootstraps the application, connects to the database, initializes the router, and starts the server.

---

## 🔒 Security & Auth

Authentication is handled via **Google OAuth 2.0** combined with stateless **JWT Tokens**:
1. The user hits `GET /v1/auth/google/login`.
2. They are redirected to Google for authentication.
3. Google sends them back to `GET /v1/auth/google/callback`.
4. The Go server exchanges the token, finds/creates the user in the database, and issues an `HttpOnly`, `SameSite=Lax` secure JWT Cookie to the browser.
5. All protected endpoints validate this JWT cookie via the `AuthMiddleware`.

---

## 🚀 Running Locally for Development

### Prerequisites
- [Go 1.22+](https://go.dev/)
- A running PostgreSQL instance (or use the root `docker-compose.yml`)

### Environment Variables
You can configure the backend locally by creating a `.env` file or exporting these variables:

```bash
export DATABASE_URL="postgres://postgres:password@localhost:5432/ourlittletribe?sslmode=disable"
export GOOGLE_CLIENT_ID="your-client-id"
export GOOGLE_CLIENT_SECRET="your-client-secret"
export GOOGLE_CALLBACK_URL="http://localhost:8080/v1/auth/google/callback"
export FRONTEND_URL="http://localhost:5173"
export JWT_SECRET="your-local-dev-secret"
```

### Start the Server
```bash
go mod tidy
go run main.go
```
The server will start natively on `http://localhost:8080`.

---

## 🧪 Testing

We utilize Go's built-in testing framework. You can run unit and integration tests across the repository via:
```bash
go test ./... -v
```
*(Ensure you have a test database running and reachable before executing data layer tests!)*
