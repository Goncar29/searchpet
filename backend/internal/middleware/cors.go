package middleware

import (
	"net/url"
	"strings"

	"github.com/gin-gonic/gin"
)

// ExposedResponseHeaders lista los headers de respuesta que el frontend LEE.
//
// Un header de respuesta NO es parte del contrato de la API hasta que aparece
// acá. La lista blanca de CORS deja pasar sólo siete headers al JavaScript
// (Cache-Control, Content-Language, Content-Length, Content-Type, Expires,
// Last-Modified, Pragma); cualquier otro viaja en la respuesta pero el browser
// se lo esconde al script, y `response.headers.get(...)` devuelve null sin un
// solo error en consola.
//
// Producción es Vercel (web) → Render (API), o sea SIEMPRE cross-origin: acá no
// hay caso feliz same-origin que tape el olvido.
//
// Si agregás un header que el frontend necesita leer, sumalo a esta lista. El
// test que lo protege es TestCORS_ExponeLosHeadersQueElFrontendLee — y no
// alcanza con que el handler setee el header: eso ya era cierto cuando
// Retry-After era invisible para el navegador.
var ExposedResponseHeaders = []string{
	// Total de paginación (X-Total-Count) — lo lee el cliente compartido.
	"X-Total-Count",
	// Segundos de espera de los 429 de OTP: cooldown y tope diario. Sin esto el
	// contador de reenvío de la web nunca arranca con el número del servidor.
	"Retry-After",
}

// CORS configures cross-origin resource sharing for the API.
// allowedOrigins is a comma-separated list of allowed origins
// (e.g. "http://localhost:3000,https://lostpets.app").
// In development mode ("development"), all localhost origins are also allowed.
func CORS(environment string, allowedOrigins string) gin.HandlerFunc {
	origins := parseOrigins(allowedOrigins)

	return func(c *gin.Context) {
		origin := c.Request.Header.Get("Origin")

		allowed := ""
		if isAllowed(origin, origins) {
			allowed = origin
		} else if environment == "development" && isLocalhost(origin) {
			allowed = origin
		}

		if allowed != "" {
			c.Header("Access-Control-Allow-Origin", allowed)
			c.Header("Vary", "Origin")
		}
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Origin, Content-Type, Authorization")
		c.Header("Access-Control-Expose-Headers", strings.Join(ExposedResponseHeaders, ", "))

		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}

		c.Next()
	}
}

func parseOrigins(s string) []string {
	var result []string
	for _, o := range strings.Split(s, ",") {
		o = strings.TrimSpace(o)
		if o != "" {
			result = append(result, o)
		}
	}
	return result
}

func isAllowed(origin string, allowed []string) bool {
	for _, a := range allowed {
		if a == origin {
			return true
		}
	}
	return false
}

// WebSocketOriginPatterns devuelve los hosts desde los que el upgrade del
// WebSocket acepta conexiones (websocket.AcceptOptions.OriginPatterns).
//
// Sale de la MISMA variable que CORS (CORS_ALLOWED_ORIGINS) y con el mismo
// parseo: dos listas de orígenes permitidos terminan divergiendo, y la que se
// queda atrás rompe el chat en runtime sin que falle ningún build. En
// development suma cualquier puerto de localhost, igual que isLocalhost.
//
// La librería compara sólo el HOST, sin esquema, así que el esquema se
// descarta. Una entrada sin host (por ejemplo "searchpet.vercel.app" sin
// "https://") se ignora: nunca se convierte en comodín.
//
// No hace falta listar el host de la propia API: websocket.Accept ya acepta un
// Origin del mismo host, que es lo que manda React Native en Android.
func WebSocketOriginPatterns(environment string, allowedOrigins string) []string {
	var hosts []string
	for _, o := range parseOrigins(allowedOrigins) {
		u, err := url.Parse(o)
		if err != nil || u.Host == "" {
			continue
		}
		hosts = append(hosts, u.Host)
	}
	if environment == "development" {
		hosts = append(hosts, "localhost:*", "127.0.0.1:*")
	}
	return hosts
}

func isLocalhost(origin string) bool {
	return strings.HasPrefix(origin, "http://localhost:") ||
		strings.HasPrefix(origin, "http://127.0.0.1:")
}
