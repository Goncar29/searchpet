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
	"lost-pets/internal/domain"
	"lost-pets/internal/repository"
	"lost-pets/pkg/googleauth"
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

// photoUserRepo tracks whether the background job re-read the user before
// saving, and what photo URL it persisted.
type photoUserRepo struct {
	created           *domain.User
	lastSavedPhoto    string
	reReadAfterCreate bool
}

func (r *photoUserRepo) Create(_ context.Context, u *domain.User) error {
	u.ID = uuid.New()
	copy := *u
	r.created = &copy
	return nil
}

func (r *photoUserRepo) GetByID(_ context.Context, _ uuid.UUID) (*domain.User, error) {
	if r.created == nil {
		return nil, domain.ErrUserNotFound
	}
	r.reReadAfterCreate = true
	fresh := *r.created
	return &fresh, nil
}

func (r *photoUserRepo) GetByEmail(context.Context, string) (*domain.User, error) {
	return nil, domain.ErrUserNotFound
}

func (r *photoUserRepo) GetByGoogleID(context.Context, string) (*domain.User, error) {
	return nil, domain.ErrUserNotFound
}

func (r *photoUserRepo) Update(_ context.Context, u *domain.User) error {
	r.lastSavedPhoto = u.ProfilePhotoURL
	return nil
}

func (r *photoUserRepo) Delete(context.Context, uuid.UUID) error { return nil }

var _ repository.UserRepository = (*photoUserRepo)(nil)

// photoVerifier returns fixed claims pointing at the test server's avatar.
type photoVerifier struct{ picture string }

func (v *photoVerifier) Verify(context.Context, string) (*googleauth.Claims, error) {
	return &googleauth.Claims{
		Sub:           "google-sub-photo",
		Email:         "carlos@example.com",
		Name:          "Carlos",
		Picture:       v.picture,
		EmailVerified: true,
	}, nil
}

var _ googleauth.Verifier = (*photoVerifier)(nil)

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

// ============================================================
// La importación corre FUERA del camino de respuesta
// ============================================================

func TestLoginWithGoogle_PhotoImportIsOffTheResponsePath(t *testing.T) {
	body := []byte("avatar-bytes")
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write(body)
	}))
	defer srv.Close()
	allowTestHost(t, srv.URL)

	originalClient := googlePhotoClient
	client := srv.Client()
	client.CheckRedirect = originalClient.CheckRedirect
	googlePhotoClient = client
	t.Cleanup(func() { googlePhotoClient = originalClient })

	up := &stubUploader{url: "https://res.cloudinary.com/searchpet/avatar.webp"}
	repo := &photoUserRepo{}
	svc := &authService{
		userRepo:       repo,
		secretKey:      "test-secret-key-32chars-minimum!",
		storage:        up,
		googleVerifier: &photoVerifier{picture: srv.URL + "/a/photo"},
		// Inline instead of `go f()` so the assertions are deterministic.
		runAsync: func(f func()) { f() },
	}

	user, token, isNew, err := svc.LoginWithGoogle(context.Background(), "any-token")
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if !isNew || token == "" {
		t.Fatal("expected a new user with a token")
	}

	// The response object carries no photo: the import is dispatched, not awaited.
	if user.ProfilePhotoURL != "" {
		t.Errorf("the signup response must not wait for the avatar, got %q", user.ProfilePhotoURL)
	}
	// But the background work did persist it — re-reading the user, not reusing
	// the stale request copy.
	if repo.lastSavedPhoto != up.url {
		t.Errorf("expected the avatar persisted as %q, got %q", up.url, repo.lastSavedPhoto)
	}
	if !repo.reReadAfterCreate {
		t.Error("the background job must RE-READ the user; Update writes the whole row and would clobber concurrent changes")
	}
}

func TestImportGooglePhotoAsync_NoDispatchWithoutStorageOrPicture(t *testing.T) {
	dispatched := 0
	svc := &authService{storage: nil, runAsync: func(f func()) { dispatched++; f() }}
	svc.importGooglePhotoAsync(uuid.New(), "https://lh3.googleusercontent.com/a/photo")
	if dispatched != 0 {
		t.Error("no uploader configured — nothing should be dispatched")
	}

	svc = &authService{storage: &stubUploader{}, runAsync: func(f func()) { dispatched++; f() }}
	svc.importGooglePhotoAsync(uuid.New(), "")
	if dispatched != 0 {
		t.Error("no picture in the token — nothing should be dispatched")
	}
}
