package tests

import (
	"testing"
	"time"

	"lost-pets/internal/domain"
)

// La allowlist tiene que decir que SÍ a los dos estados que se están buscando y
// que NO a los otros cinco. Las dos mitades importan: un test que sólo afirme la
// presencia pasaría con la lista invertida.
func TestLastSeenRelevantStatuses_SoloLosQueSeEstanBuscando(t *testing.T) {
	relevantes := map[string]bool{}
	for _, s := range domain.LastSeenRelevantStatuses {
		relevantes[s] = true
	}

	for _, s := range []string{domain.PetStatusLost, domain.PetStatusStray} {
		if !relevantes[s] {
			t.Errorf("%q debería estar en LastSeenRelevantStatuses", s)
		}
	}
	for _, s := range []string{
		domain.PetStatusRegistered,
		domain.PetStatusFound,
		domain.PetStatusArchived,
		domain.PetStatusAdoption,
		domain.PetStatusAdopted,
	} {
		if relevantes[s] {
			t.Errorf("%q NO debería estar: 'visto por última vez' no significa nada ahí", s)
		}
	}
}

// El fallback a CreatedAt NO es un default de conveniencia: un animal sin
// reportes SÍ fue visto — alguien lo publicó porque lo vio. Es además el único
// caso hoy ciego en la ficha, así que si el fallback no está, el cambio entero
// no sirve para el escenario que lo motivó.
func TestPetLastSeen_UsaElReporteYCaeAlAlta(t *testing.T) {
	alta := time.Date(2026, 1, 10, 12, 0, 0, 0, time.UTC)
	visto := time.Date(2026, 5, 3, 9, 30, 0, 0, time.UTC)

	conReporte := &domain.Pet{Status: domain.PetStatusStray, CreatedAt: alta, LastReportedAt: &visto}
	if got := conReporte.LastSeen(); got == nil || !got.Equal(visto) {
		t.Errorf("con reporte esperaba %v, obtuve %v", visto, got)
	}

	sinReporte := &domain.Pet{Status: domain.PetStatusStray, CreatedAt: alta}
	if got := sinReporte.LastSeen(); got == nil || !got.Equal(alta) {
		t.Errorf("sin reporte esperaba el alta %v, obtuve %v", alta, got)
	}
}

// Un estado fuera de la allowlist devuelve nil, y eso es lo que hace que el
// cliente no tenga que conocer la lista: si no viene el campo, no muestra nada.
func TestPetLastSeen_NilFueraDeLaAllowlist(t *testing.T) {
	visto := time.Date(2026, 5, 3, 9, 30, 0, 0, time.UTC)
	for _, s := range []string{
		domain.PetStatusRegistered,
		domain.PetStatusFound,
		domain.PetStatusArchived,
		domain.PetStatusAdoption,
		domain.PetStatusAdopted,
	} {
		p := &domain.Pet{Status: s, CreatedAt: visto, LastReportedAt: &visto}
		if got := p.LastSeen(); got != nil {
			t.Errorf("status %q: esperaba nil, obtuve %v", s, got)
		}
	}
}
