package middleware

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"lost-pets/internal/domain"
)

// stubUserRepo is a minimal UserRepository for exercising RequireAdmin.
// Only GetByID carries behavior; the rest satisfy the interface.
type stubUserRepo struct {
	user *domain.User
	err  error
}

func (s *stubUserRepo) Create(context.Context, *domain.User) error          { return nil }
func (s *stubUserRepo) GetByID(context.Context, uuid.UUID) (*domain.User, error) {
	return s.user, s.err
}
func (s *stubUserRepo) GetByEmail(context.Context, string) (*domain.User, error) { return nil, nil }
func (s *stubUserRepo) Update(context.Context, *domain.User) error               { return nil }
func (s *stubUserRepo) Delete(context.Context, uuid.UUID) error                  { return nil }

// runRequireAdmin runs RequireAdmin behind an optional userID setter and returns
// the final status, whether the protected handler ran, and the decoded body.
func runRequireAdmin(t *testing.T, repo *stubUserRepo, setUserID *uuid.UUID) (status int, nextCalled bool, body map[string]string) {
	t.Helper()
	gin.SetMode(gin.TestMode)

	w := httptest.NewRecorder()
	r := gin.New()
	if setUserID != nil {
		id := *setUserID
		r.Use(func(c *gin.Context) { c.Set("userID", id) })
	}
	r.Use(RequireAdmin(repo))
	r.GET("/api/admin/thing", func(c *gin.Context) {
		nextCalled = true
		c.Status(http.StatusOK)
	})

	req := httptest.NewRequest(http.MethodGet, "/api/admin/thing", nil)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		_ = json.Unmarshal(w.Body.Bytes(), &body)
	}
	return w.Code, nextCalled, body
}

func TestRequireAdmin_NoUserID_Returns401WithCode(t *testing.T) {
	status, nextCalled, body := runRequireAdmin(t, &stubUserRepo{}, nil)

	if status != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", status)
	}
	if nextCalled {
		t.Error("protected handler must not run when userID is absent")
	}
	if body["code"] != "unauthorized" {
		t.Errorf("expected code 'unauthorized', got %q (body=%v)", body["code"], body)
	}
	if body["message"] == "" {
		t.Error("expected a non-empty message field per the {code,message} contract")
	}
}

func TestRequireAdmin_NonAdmin_Returns403WithCode(t *testing.T) {
	id := uuid.New()
	repo := &stubUserRepo{user: &domain.User{IsAdmin: false}}

	status, nextCalled, body := runRequireAdmin(t, repo, &id)

	if status != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", status)
	}
	if nextCalled {
		t.Error("protected handler must not run for a non-admin user")
	}
	if body["code"] != "not_admin" {
		t.Errorf("expected code 'not_admin', got %q (body=%v)", body["code"], body)
	}
}

func TestRequireAdmin_RepoError_Returns403WithCode(t *testing.T) {
	id := uuid.New()
	repo := &stubUserRepo{err: domain.ErrUserNotFound}

	status, nextCalled, body := runRequireAdmin(t, repo, &id)

	if status != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", status)
	}
	if nextCalled {
		t.Error("protected handler must not run when the user lookup fails")
	}
	if body["code"] != "not_admin" {
		t.Errorf("expected code 'not_admin', got %q (body=%v)", body["code"], body)
	}
}

func TestRequireAdmin_Admin_CallsNext(t *testing.T) {
	id := uuid.New()
	repo := &stubUserRepo{user: &domain.User{IsAdmin: true}}

	status, nextCalled, _ := runRequireAdmin(t, repo, &id)

	if status != http.StatusOK {
		t.Fatalf("expected 200 for an admin user, got %d", status)
	}
	if !nextCalled {
		t.Error("protected handler must run for an admin user")
	}
}
