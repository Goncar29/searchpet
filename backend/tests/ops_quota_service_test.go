package tests

import (
	"context"
	"errors"
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

// TestAlertsFor_CriticoEmiteLosDos protege el bug sutil: si critico emitiera solo
// QUOTA_CRIT, el cuerpo perderia QUOTA_WARN y el monitor de aviso mandaria un
// "recuperado" en el mismo instante en que el otro manda "caido".
func TestAlertsFor_CriticoEmiteLosDos(t *testing.T) {
	casos := []struct {
		nivel  string
		quiero []string
	}{
		{service.QuotaLevelOK, []string{}},
		{service.QuotaLevelWarning, []string{service.AlertQuotaWarn}},
		{service.QuotaLevelCritical, []string{service.AlertQuotaWarn, service.AlertQuotaCrit}},
	}

	for _, c := range casos {
		t.Run(c.nivel, func(t *testing.T) {
			got := service.AlertsFor(c.nivel)
			if len(got) != len(c.quiero) {
				t.Fatalf("AlertsFor(%q) = %v, quiero %v", c.nivel, got, c.quiero)
			}
			for i := range c.quiero {
				if got[i] != c.quiero[i] {
					t.Fatalf("AlertsFor(%q)[%d] = %q, quiero %q", c.nivel, i, got[i], c.quiero[i])
				}
			}
		})
	}
}

// TestAlertsFor_OkNoEsNil garantiza que el JSON serialice [] y no null.
func TestAlertsFor_OkNoEsNil(t *testing.T) {
	if service.AlertsFor(service.QuotaLevelOK) == nil {
		t.Fatal("AlertsFor(ok) devolvio nil, quiero un slice vacio")
	}
}

// TestWorstLevel: el status global es el del canal mas comprometido, no un promedio.
func TestWorstLevel(t *testing.T) {
	casos := []struct{ a, b, quiero string }{
		{service.QuotaLevelOK, service.QuotaLevelOK, service.QuotaLevelOK},
		{service.QuotaLevelOK, service.QuotaLevelWarning, service.QuotaLevelWarning},
		{service.QuotaLevelWarning, service.QuotaLevelOK, service.QuotaLevelWarning},
		{service.QuotaLevelWarning, service.QuotaLevelCritical, service.QuotaLevelCritical},
		{service.QuotaLevelCritical, service.QuotaLevelWarning, service.QuotaLevelCritical},
	}
	for _, c := range casos {
		if got := service.WorstLevel(c.a, c.b); got != c.quiero {
			t.Fatalf("WorstLevel(%q,%q) = %q, quiero %q", c.a, c.b, got, c.quiero)
		}
	}
}

// TestReport_ArmaLosDosCanales verifica el cuerpo completo con consumo real.
// mockTokenRepo.CountSince devuelve countGlobal cuando userID es nil, que es
// exactamente como el servicio cuenta el canal entero.
func TestReport_ArmaLosDosCanales(t *testing.T) {
	repo := &mockTokenRepo{countGlobal: 203}
	svc := service.NewOpsQuotaService(repo)

	rep, err := svc.Report(context.Background())
	if err != nil {
		t.Fatalf("Report devolvio error: %v", err)
	}
	if len(rep.Channels) != 2 {
		t.Fatalf("quiero 2 canales, hay %d", len(rep.Channels))
	}
	if rep.Channels[0].Channel != service.ChannelEmail || rep.Channels[0].Cap != 250 {
		t.Fatalf("canal 0 = %+v, quiero email con cap 250", rep.Channels[0])
	}
	if rep.Channels[1].Channel != service.ChannelPasswordReset || rep.Channels[1].Cap != 50 {
		t.Fatalf("canal 1 = %+v, quiero password_reset con cap 50", rep.Channels[1])
	}
	// 203 sobre 250 es aviso; 203 sobre 50 es critico. El peor manda.
	if rep.Status != service.QuotaLevelCritical {
		t.Fatalf("status = %q, quiero critical", rep.Status)
	}
	if rep.WindowHours != 24 {
		t.Fatalf("window_hours = %v, quiero 24", rep.WindowHours)
	}
}

// TestReport_ErrorDeConteoNoSeTraga es el test mas importante del archivo. Un
// conteo que fallo no puede volverse un "ok": es una senal de exito emitida
// cuando el chequeo no ocurrio.
func TestReport_ErrorDeConteoNoSeTraga(t *testing.T) {
	repo := &mockTokenRepo{countErr: errors.New("boom")}
	svc := service.NewOpsQuotaService(repo)

	rep, err := svc.Report(context.Background())
	if err == nil {
		t.Fatal("Report devolvio nil error con el conteo roto")
	}
	if rep != nil {
		t.Fatalf("Report devolvio un reporte (%+v) con el conteo roto", rep)
	}
}
