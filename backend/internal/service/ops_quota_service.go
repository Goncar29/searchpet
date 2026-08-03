package service

import (
	"context"
	"time"

	"lost-pets/internal/repository"
)

// Niveles de consumo del cupo, del mas leve al mas grave.
const (
	QuotaLevelOK       = "ok"
	QuotaLevelWarning  = "warning"
	QuotaLevelCritical = "critical"
)

// Tokens que los monitores externos buscan en el cuerpo de la respuesta. Son
// parte del contrato del endpoint, no detalle interno: renombrar uno apaga su
// monitor en silencio.
const (
	AlertQuotaWarn = "QUOTA_WARN"
	AlertQuotaCrit = "QUOTA_CRIT"
)

// LevelFor mapea consumo a nivel.
//
// El umbral de aviso se DERIVA del tope (80%) y no se declara aparte a proposito:
// una constante suelta seguiria existiendo mientras deja de significar 80% apenas
// alguien mueve un cap, y el desfasaje es mudo.
func LevelFor(used int64, capacity int) string {
	switch {
	case used >= int64(capacity):
		return QuotaLevelCritical
	case used >= int64(capacity)*4/5:
		return QuotaLevelWarning
	default:
		return QuotaLevelOK
	}
}

// AlertsFor renderiza los tokens que matchean los monitores.
//
// Critico emite LOS DOS a proposito. Emitir solo QUOTA_CRIT sacaria QUOTA_WARN del
// cuerpo, y el monitor de aviso disparia una recuperacion en el mismo instante en
// que el de critico dispara una caida. Escalar no puede leerse como recuperarse.
func AlertsFor(level string) []string {
	switch level {
	case QuotaLevelCritical:
		return []string{AlertQuotaWarn, AlertQuotaCrit}
	case QuotaLevelWarning:
		return []string{AlertQuotaWarn}
	default:
		return []string{}
	}
}

// WorstLevel devuelve el mas grave de dos niveles.
func WorstLevel(a, b string) string {
	rank := map[string]int{QuotaLevelOK: 0, QuotaLevelWarning: 1, QuotaLevelCritical: 2}
	if rank[b] > rank[a] {
		return b
	}
	return a
}

// ChannelQuota es el consumo de un canal en QuotaWindow.
type ChannelQuota struct {
	Channel string `json:"channel"`
	Used    int64  `json:"used"`
	Cap     int    `json:"cap"`
	Level   string `json:"level"`
}

// QuotaReport es el cuerpo que consume el monitoreo externo.
type QuotaReport struct {
	WindowHours float64        `json:"window_hours"`
	Status      string         `json:"status"`
	Alerts      []string       `json:"alerts"`
	Channels    []ChannelQuota `json:"channels"`
}

// OpsQuotaService reporta cuanto se gasto de la reserva diaria de cada canal.
//
// Vive en package service a proposito: emailVerificationGlobalDailyMax y
// passwordResetGlobalDailyMax ya son constantes privadas de este paquete, asi que
// las lee directo sin exportarlas ni duplicarlas.
type OpsQuotaService struct {
	tokenRepo repository.VerificationTokenRepository
}

func NewOpsQuotaService(tokenRepo repository.VerificationTokenRepository) *OpsQuotaService {
	return &OpsQuotaService{tokenRepo: tokenRepo}
}

// Report cuenta los dos canales sobre QuotaWindow y los gradua.
//
// Un error de conteo se PROPAGA, nunca se traga: reportar "ok" sobre un conteo que
// no se pudo hacer es exactamente la falla que este proyecto ya pago varias veces.
func (s *OpsQuotaService) Report(ctx context.Context) (*QuotaReport, error) {
	since := time.Now().Add(-QuotaWindow)

	emailUsed, err := s.tokenRepo.CountSince(ctx, nil, ChannelEmail, since)
	if err != nil {
		return nil, err
	}
	resetUsed, err := s.tokenRepo.CountSince(ctx, nil, ChannelPasswordReset, since)
	if err != nil {
		return nil, err
	}

	channels := []ChannelQuota{
		{
			Channel: ChannelEmail,
			Used:    emailUsed,
			Cap:     emailVerificationGlobalDailyMax,
			Level:   LevelFor(emailUsed, emailVerificationGlobalDailyMax),
		},
		{
			Channel: ChannelPasswordReset,
			Used:    resetUsed,
			Cap:     passwordResetGlobalDailyMax,
			Level:   LevelFor(resetUsed, passwordResetGlobalDailyMax),
		},
	}

	status := QuotaLevelOK
	for _, c := range channels {
		status = WorstLevel(status, c.Level)
	}

	return &QuotaReport{
		WindowHours: QuotaWindow.Hours(),
		Status:      status,
		Alerts:      AlertsFor(status),
		Channels:    channels,
	}, nil
}
