package service

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
