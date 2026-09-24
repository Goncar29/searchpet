package middleware_test

import (
	"reflect"
	"testing"

	"lost-pets/internal/middleware"
)

// S6 (auditoria 2026-09-23): el upgrade del WebSocket usaba
// InsecureSkipVerify. Los hosts que acepta salen de la MISMA variable que CORS
// para que las dos listas no puedan divergir.
func TestWebSocketOriginPatterns(t *testing.T) {
	tests := []struct {
		name        string
		environment string
		allowed     string
		want        []string
	}{
		{
			name:        "production: one host per configured origin, scheme dropped",
			environment: "production",
			allowed:     "https://searchpet.vercel.app, http://localhost:3000",
			want:        []string{"searchpet.vercel.app", "localhost:3000"},
		},
		{
			name:        "development: any localhost port too, like CORS",
			environment: "development",
			allowed:     "https://searchpet.vercel.app",
			want:        []string{"searchpet.vercel.app", "localhost:*", "127.0.0.1:*"},
		},
		{
			name:        "production never adds the localhost wildcard",
			environment: "production",
			allowed:     "",
			want:        nil,
		},
		{
			name:        "entries without a host are skipped, not turned into a wildcard",
			environment: "production",
			allowed:     "searchpet.vercel.app,https://ok.example",
			want:        []string{"ok.example"},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := middleware.WebSocketOriginPatterns(tc.environment, tc.allowed)
			if !reflect.DeepEqual(got, tc.want) {
				t.Errorf("want %q, got %q", tc.want, got)
			}
		})
	}
}
