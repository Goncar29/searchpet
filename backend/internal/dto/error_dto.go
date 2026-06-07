package dto

// ErrorResponse is the standard error body returned by all API endpoints.
// Code is a machine-readable snake_case identifier for i18n mapping.
// Message is a developer-facing fallback string (the original Go error text).
type ErrorResponse struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}
