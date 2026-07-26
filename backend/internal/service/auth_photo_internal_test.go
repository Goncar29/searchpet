package service

// Tests internos de importGooglePhoto. Viven en el paquete `service` (no en
// `service_test`) porque necesitan reapuntar googlePhotoHost a un servidor
// local: el allowlist exige .googleusercontent.com y un httptest escucha en
// 127.0.0.1, así que desde afuera el camino feliz sería inalcanzable.

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/google/uuid"
)

type stubUploader struct {
	received []byte
	url      string
	err      error
	calls    int
}

func (s *stubUploader) UploadImage(_ context.Context, file io.Reader, _, _ string) (string, string, error) {
	s.calls++
	if s.err != nil {
		return "", "", s.err
	}
	b, err := io.ReadAll(file)
	if err != nil {
		return "", "", err
	}
	s.received = b
	return s.url, "public-id", nil
}

func (s *stubUploader) Delete(context.Context, string) error { return nil }

// allowTestHost points the allowlist at the httptest server's host for the
// duration of one test, then restores it.
func allowTestHost(t *testing.T, serverURL string) {
	t.Helper()
	u, err := url.Parse(serverURL)
	if err != nil {
		t.Fatalf("bad test server URL %q: %v", serverURL, err)
	}
	// Hostname() drops the port — isGooglePhotoURL compares against the hostname
	// only, so the allowlist value must not carry one either.
	original := googlePhotoHost
	googlePhotoHost = u.Hostname()
	t.Cleanup(func() { googlePhotoHost = original })
}

func newPhotoSvc(up ImageUploader) *authService {
	return &authService{storage: up}
}

func TestImportGooglePhoto_HappyPath(t *testing.T) {
	body := []byte("fake-jpeg-bytes")
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write(body)
	}))
	defer srv.Close()
	allowTestHost(t, srv.URL)

	up := &stubUploader{url: "https://res.cloudinary.com/searchpet/avatar.webp"}
	svc := newPhotoSvc(up)
	// The httptest client trusts the server's self-signed cert.
	original := googlePhotoClient
	googlePhotoClient = srv.Client()
	googlePhotoClient.CheckRedirect = original.CheckRedirect
	t.Cleanup(func() { googlePhotoClient = original })

	got := svc.importGooglePhoto(context.Background(), uuid.New(), srv.URL+"/a/photo")

	if got != up.url {
		t.Errorf("expected the Cloudinary URL %q, got %q", up.url, got)
	}
	if string(up.received) != string(body) {
		t.Errorf("uploader received %q, expected the downloaded bytes %q", up.received, body)
	}
}

func TestImportGooglePhoto_RejectsRedirectOffAllowlist(t *testing.T) {
	// The redirect target must be a genuinely DIFFERENT hostname. A second
	// httptest server would not do: those all listen on 127.0.0.1, which is the
	// very host allowTestHost allowlists, so the hop would legitimately pass.
	// CheckRedirect runs before the request is issued, so this host need not exist.
	const evilURL = "https://evil.example.com/pwned"

	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, evilURL, http.StatusFound)
	}))
	defer srv.Close()
	allowTestHost(t, srv.URL) // only the FIRST host is allowlisted

	up := &stubUploader{url: "https://res.cloudinary.com/x.webp"}
	svc := newPhotoSvc(up)
	original := googlePhotoClient
	client := srv.Client()
	client.CheckRedirect = original.CheckRedirect
	googlePhotoClient = client
	t.Cleanup(func() { googlePhotoClient = original })

	got := svc.importGooglePhoto(context.Background(), uuid.New(), srv.URL+"/a/photo")

	if got != "" {
		t.Errorf("SECURITY: a redirect off the allowlist must be refused, got %q", got)
	}
	if up.calls != 0 {
		t.Error("SECURITY: nothing fetched from a non-allowlisted redirect target may reach the uploader")
	}
}

func TestImportGooglePhoto_TruncatesOversizedBody(t *testing.T) {
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write(make([]byte, googlePhotoMaxBytes+4096))
	}))
	defer srv.Close()
	allowTestHost(t, srv.URL)

	up := &stubUploader{url: "https://res.cloudinary.com/x.webp"}
	svc := newPhotoSvc(up)
	original := googlePhotoClient
	client := srv.Client()
	client.CheckRedirect = original.CheckRedirect
	googlePhotoClient = client
	t.Cleanup(func() { googlePhotoClient = original })

	svc.importGooglePhoto(context.Background(), uuid.New(), srv.URL+"/a/photo")

	if len(up.received) != googlePhotoMaxBytes {
		t.Errorf("expected the body capped at %d bytes, uploader got %d", googlePhotoMaxBytes, len(up.received))
	}
}

func TestImportGooglePhoto_SkipsNon200(t *testing.T) {
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()
	allowTestHost(t, srv.URL)

	up := &stubUploader{url: "https://res.cloudinary.com/x.webp"}
	svc := newPhotoSvc(up)
	original := googlePhotoClient
	client := srv.Client()
	client.CheckRedirect = original.CheckRedirect
	googlePhotoClient = client
	t.Cleanup(func() { googlePhotoClient = original })

	if got := svc.importGooglePhoto(context.Background(), uuid.New(), srv.URL+"/a/photo"); got != "" {
		t.Errorf("expected no URL for a 404 response, got %q", got)
	}
	if up.calls != 0 {
		t.Error("a non-200 response must not reach the uploader")
	}
}

func TestImportGooglePhoto_UploaderFailureReturnsEmpty(t *testing.T) {
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("bytes"))
	}))
	defer srv.Close()
	allowTestHost(t, srv.URL)

	up := &stubUploader{err: errors.New("cloudinary down")}
	svc := newPhotoSvc(up)
	original := googlePhotoClient
	client := srv.Client()
	client.CheckRedirect = original.CheckRedirect
	googlePhotoClient = client
	t.Cleanup(func() { googlePhotoClient = original })

	if got := svc.importGooglePhoto(context.Background(), uuid.New(), srv.URL+"/a/photo"); got != "" {
		t.Errorf("a failed upload must return empty, got %q", got)
	}
}

func TestImportGooglePhoto_NoUploaderIsNoop(t *testing.T) {
	svc := newPhotoSvc(nil)
	if got := svc.importGooglePhoto(context.Background(), uuid.New(), "https://lh3.googleusercontent.com/a/photo"); got != "" {
		t.Errorf("expected empty when no uploader is configured, got %q", got)
	}
}
