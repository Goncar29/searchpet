package tests

import (
	"testing"

	"lost-pets/internal/service"
)

// TestLevelFor_Bordes fija los bordes de los dos topes reales. El umbral de aviso
// es cap*4/5 con division entera: 250 -> 200 y 50 -> 40 caen exactos, y este test
// es lo unico que lo garantiza si alguien mueve un cap.
func TestLevelFor_Bordes(t *testing.T) {
	casos := []struct {
		nombre string
		used   int64
		cap    int
		quiero string
	}{
		{"email 199 sigue ok", 199, 250, service.QuotaLevelOK},
		{"email 200 es aviso", 200, 250, service.QuotaLevelWarning},
		{"email 249 sigue aviso", 249, 250, service.QuotaLevelWarning},
		{"email 250 es critico", 250, 250, service.QuotaLevelCritical},
		{"email 251 sigue critico", 251, 250, service.QuotaLevelCritical},
		{"reset 39 sigue ok", 39, 50, service.QuotaLevelOK},
		{"reset 40 es aviso", 40, 50, service.QuotaLevelWarning},
		{"reset 49 sigue aviso", 49, 50, service.QuotaLevelWarning},
		{"reset 50 es critico", 50, 50, service.QuotaLevelCritical},
		{"cero es ok", 0, 250, service.QuotaLevelOK},
	}

	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			if got := service.LevelFor(c.used, c.cap); got != c.quiero {
				t.Fatalf("LevelFor(%d, %d) = %q, quiero %q", c.used, c.cap, got, c.quiero)
			}
		})
	}
}
