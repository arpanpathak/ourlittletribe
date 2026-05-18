package constants

const (
	// Google OAuth Constants
	GoogleUserInfoURL  = "https://www.googleapis.com/oauth2/v2/userinfo"
	GoogleScopeEmail   = "https://www.googleapis.com/auth/userinfo.email"
	GoogleScopeProfile = "https://www.googleapis.com/auth/userinfo.profile"
	GoogleAccountsCSP  = "https://accounts.google.com"

	// Local Development Fallbacks
	DefaultCallbackURL = "http://localhost:8080/v1/auth/google/callback"
	DefaultFrontendURL = "http://localhost:5173"

	// HTTP Headers
	HeaderXContentTypeOptions           = "X-Content-Type-Options"
	HeaderXFrameOptions                 = "X-Frame-Options"
	HeaderXXSSProtection                = "X-XSS-Protection"
	HeaderXForwardedFor                 = "X-Forwarded-For"
	HeaderAccessControlAllowOrigin      = "Access-Control-Allow-Origin"
	HeaderAccessControlAllowMethods     = "Access-Control-Allow-Methods"
	HeaderAccessControlAllowHeaders     = "Access-Control-Allow-Headers"
	HeaderAccessControlAllowCredentials = "Access-Control-Allow-Credentials"
)
