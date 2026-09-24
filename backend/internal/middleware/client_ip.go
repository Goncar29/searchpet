package middleware

import (
	"time"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

// TrustedProxyCIDRs son los ÚNICOS peers TCP desde los que gin.Context.ClientIP()
// puede leer un header de IP en vez de devolver la conexión cruda.
//
// Render sirve detrás de Cloudflare, y el peer TCP que gin ve en
// c.Request.RemoteAddr es el load balancer INTERNO de Render — este rango está
// OBSERVADO en logs reales, NO documentado por Render (de ahí RequestLog más
// abajo: si Render cambia su red interna, la única forma de enterarse es leer
// remote_addr en producción, no releer una doc que nunca lo confirmó).
var TrustedProxyCIDRs = []string{"10.0.0.0/8"}

// ClientIPHeader es el ÚNICO header del que ClientIP() puede leer la IP real
// del visitante, y sólo cuando el peer está en TrustedProxyCIDRs.
//
// CF-Connecting-IP lo fija Cloudflare desde la conexión TCP que le llega a
// SU borde — el cliente no lo puede spoofear — pero Cloudflare también
// reenvía X-Forwarded-For, y a ese header cualquiera lo pisa desde el
// browser. Por eso NUNCA va X-Forwarded-For en esta lista.
const ClientIPHeader = "CF-Connecting-IP"

// ConfigureClientIP endurece gin.Context.ClientIP() contra el spoofeo de
// X-Forwarded-For (hallazgo S1 de la auditoría de seguridad 2026-09-23).
//
// EL PROBLEMA: sin llamar a SetTrustedProxies, gin confía en el
// X-Forwarded-For de CUALQUIER peer (gin.New() deja trustedProxies en
// "0.0.0.0/0"). internal/middleware/rate_limit.go arma la clave del rate
// limiter con ClientIP(), así que un atacante que manda un X-Forwarded-For
// distinto en cada request se gana un bucket nuevo cada vez — el límite de
// login (5/min) y los de envío de OTP quedan de adorno.
//
// LA SOLUCIÓN: sólo un peer en TrustedProxyCIDRs puede hacer que ClientIP()
// lea un header, y el único header que lee es ClientIPHeader
// (CF-Connecting-IP) — jamás X-Forwarded-For.
//
// ALTERNATIVAS DESCARTADAS, y por qué:
//
//   - SetTrustedProxies(nil): apaga el feature entero. ClientIP() devolvería
//     SIEMPRE el peer TCP crudo, que en Render es el load balancer interno —
//     TODOS los usuarios compartirían esa única IP y el rate limit por IP se
//     volvería un rate limit GLOBAL: un usuario legítimo bloquea a todos los
//     demás.
//   - Confiar en 10.0.0.0/8 pero seguir leyendo X-Forwarded-For: gin camina
//     esa lista de derecha a izquierda y para en el primer hop NO confiable.
//     En Render la lista llega como "cliente, hop-de-Cloudflare, LB-10.x":
//     gin saltea el 10.x y se queda con el hop de Cloudflare, que es una IP
//     pública compartida por miles de visitantes — casi el mismo balde único
//     que SetTrustedProxies(nil). Arreglarlo exigiría confiar además en los
//     rangos publicados de Cloudflare, que cambian con el tiempo.
//   - TrustedPlatform: gin.PlatformCloudflare: lee CF-Connecting-IP SIN
//     chequear el peer TCP contra ninguna lista de proxies confiables (en
//     gin/context.go el chequeo de TrustedPlatform corre ANTES que, y en vez
//     de, el chequeo de isTrustedProxy). Cualquiera que le pegue directo a
//     Render saltándose Cloudflare podría mandar su propio CF-Connecting-IP
//     y sería creído sin ningún control.
//
// SUPUESTO QUE ESTO NO PUEDE VERIFICAR: que al origen de Render sólo se llegue
// a través de Cloudflare. Un request que llegara al balanceador interno SIN
// pasar por Cloudflare vendría igual desde un peer 10.x, y su CF-Connecting-IP
// forjado sería creído. *.onrender.com resuelve a Cloudflare y Render no
// publica una IP de origen directa, así que hoy no hay camino conocido; si
// aparece uno, este fix vuelve a quedar abierto. Riesgo aceptado, anotado en
// odd/tasks/auditoria-seguridad-2026-09-23.md (S1).
//
// SetTrustedProxies devuelve error si algún CIDR es inválido; se propaga
// para que el caller decida fallar el arranque en vez de seguir con una
// config a medias (mismo criterio que los demás log.Fatal de SetupRouter).
func ConfigureClientIP(engine *gin.Engine) error {
	if err := engine.SetTrustedProxies(TrustedProxyCIDRs); err != nil {
		return err
	}
	engine.RemoteIPHeaders = []string{ClientIPHeader}
	return nil
}

// RequestLog registra cada request en JSON estructurado (zap) con el
// ClientIP() que gin resuelve (post ConfigureClientIP) Y el remote_addr
// crudo del socket TCP, uno junto al otro.
//
// remote_addr existe por un solo motivo: TrustedProxyCIDRs (10.0.0.0/8) está
// OBSERVADO en logs de producción, no documentado por Render. Sin loguearlo
// acá, un cambio futuro en la red interna de Render rompería
// ConfigureClientIP en silencio — ClientIP() volvería a devolver el peer
// crudo en vez del visitante real — y nadie lo notaría hasta investigar por
// qué el rate limit se puede volver a saltear.
// NewBaseEngine construye el *gin.Engine base que usa SetupRouter: crea el
// engine, aplica ConfigureClientIP y encadena RequestLog seguido de
// gin.Recovery(), EN ESE ORDEN.
//
// Por qué existe como función propia y no como código suelto en router.go:
// TestRequestLog_PorFueraDeRecoveryLogueaLosPanics arma su propia cadena de
// middlewares desde cero, así que reordenar router.go NO rompe ningún test —
// nada ata ese orden al router real (hallazgo de la revisión de S1, ver
// odd/tasks/auditoria-seguridad-2026-09-23.md, S1b). Con esta función,
// SetupRouter y el test de integración comparten el mismo código: reordenar
// acá rompe tanto al test como al router.
func NewBaseEngine(log *zap.Logger) (*gin.Engine, error) {
	engine := gin.New()
	if err := ConfigureClientIP(engine); err != nil {
		return nil, err
	}
	// RequestLog va POR FUERA de Recovery, como el Logger de gin.Default():
	// si fuera por dentro, un handler que paniquea desenrolla RequestLog antes
	// de que loguee y el 500 no deja línea de acceso — justo la que trae
	// client_ip y remote_addr.
	engine.Use(RequestLog(log))
	engine.Use(gin.Recovery())
	return engine, nil
}

func RequestLog(log *zap.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		path := c.Request.URL.Path

		c.Next()

		log.Info("request",
			zap.String("method", c.Request.Method),
			zap.String("path", path),
			zap.Int("status", c.Writer.Status()),
			zap.Duration("latency", time.Since(start)),
			zap.String("client_ip", c.ClientIP()),
			zap.String("remote_addr", c.Request.RemoteAddr),
		)
	}
}
