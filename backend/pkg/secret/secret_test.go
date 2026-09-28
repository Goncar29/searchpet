package secret_test

import (
	"strings"
	"testing"

	"lost-pets/pkg/secret"
)

func TestEqual(t *testing.T) {
	cases := []struct {
		name string
		a, b string
		want bool
	}{
		{"iguales", "s3cr3t-token", "s3cr3t-token", true},
		{"distinto contenido, mismo largo", "s3cr3t-token", "s3cr3t-tokem", false},
		{"prefijo del secreto", "s3cr3t", "s3cr3t-token", false},
		{"secreto mas un sufijo", "s3cr3t-token-extra", "s3cr3t-token", false},
		{"vacio contra secreto", "", "s3cr3t-token", false},
		{"mayusculas distintas", "S3CR3T-TOKEN", "s3cr3t-token", false},
		{"largo muy distinto", strings.Repeat("a", 4096), "a", false},
		// Equal no tiene opinion sobre el vacio: dos vacios son iguales. La
		// guarda de "no configurado" es de cada llamador (regla #18) y no se
		// delega a esta comparacion.
		{"dos vacios", "", "", true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := secret.Equal(tc.a, tc.b); got != tc.want {
				t.Fatalf("Equal(%q, %q) = %v, want %v", tc.a, tc.b, got, tc.want)
			}
		})
	}
}
