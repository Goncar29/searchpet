package websocket

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"nhooyr.io/websocket"
)

// S6 (auditoria 2026-09-23): Connect aceptaba el upgrade desde cualquier
// Origin (InsecureSkipVerify). Estos tests hacen el handshake de verdad contra
// un servidor HTTP real, porque el chequeo vive dentro de websocket.Accept.
func dialWithOrigin(t *testing.T, patterns []string, origin func(serverURL string) string) (*http.Response, error) {
	t.Helper()
	gin.SetMode(gin.TestMode)

	hub := NewHub(nil)
	go hub.Run()
	store := NewTicketStore()
	h := NewHandler(hub, store, patterns)

	r := gin.New()
	r.GET("/api/ws", h.Connect)
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	ticket := store.Issue(uuid.New().String())
	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/api/ws?ticket=" + ticket

	header := http.Header{}
	if o := origin(srv.URL); o != "" {
		header.Set("Origin", o)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	conn, resp, err := websocket.Dial(ctx, wsURL, &websocket.DialOptions{HTTPHeader: header})
	if conn != nil {
		conn.Close(websocket.StatusNormalClosure, "")
	}
	return resp, err
}

var prodPatterns = []string{"searchpet.vercel.app"}

func TestConnect_RejectsForeignOrigin(t *testing.T) {
	resp, err := dialWithOrigin(t, prodPatterns, func(string) string { return "https://evil.example" })
	if err == nil {
		t.Fatal("upgrade from a foreign Origin succeeded; want it rejected")
	}
	if resp == nil || resp.StatusCode != http.StatusForbidden {
		got := 0
		if resp != nil {
			got = resp.StatusCode
		}
		t.Errorf("want 403 for a foreign Origin, got %d (err=%v)", got, err)
	}
}

func TestConnect_AcceptsConfiguredOrigin(t *testing.T) {
	if _, err := dialWithOrigin(t, prodPatterns, func(string) string { return "https://searchpet.vercel.app" }); err != nil {
		t.Fatalf("upgrade from the configured web origin failed: %v", err)
	}
}

// Un cliente nativo que no manda Origin no es un navegador: el ataque que el
// chequeo cierra (una página ajena abriendo el socket) no aplica.
func TestConnect_AcceptsMissingOrigin(t *testing.T) {
	if _, err := dialWithOrigin(t, prodPatterns, func(string) string { return "" }); err != nil {
		t.Fatalf("upgrade without an Origin header failed: %v", err)
	}
}

// React Native en Android (WebSocketModule.getDefaultOrigin, RN 0.76) manda
// un Origin armado con el host y el puerto de la propia URL del socket. Si
// esto se rompe, el chat de mobile deja de conectar sin que falle nada en la
// web.
func TestConnect_AcceptsSameHostOrigin_ReactNativeAndroid(t *testing.T) {
	if _, err := dialWithOrigin(t, prodPatterns, func(serverURL string) string { return serverURL }); err != nil {
		t.Fatalf("upgrade with a same-host Origin (React Native Android) failed: %v", err)
	}
}
