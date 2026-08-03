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
