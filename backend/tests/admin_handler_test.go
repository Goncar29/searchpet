package tests

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/handler"
	"lost-pets/internal/service"
)

type mockAdminService struct {
	setFn  func(ctx context.Context, actorID uuid.UUID, email string, grant bool) (service.AdminRoleResult, error)
	listFn func(ctx context.Context, page, limit int) ([]domain.AdminAuditLog, int64, error)
}

func (m *mockAdminService) SetUserAdmin(ctx context.Context, actorID uuid.UUID, email string, grant bool) (service.AdminRoleResult, error) {
	return m.setFn(ctx, actorID, email, grant)
}
func (m *mockAdminService) RecentRoleChanges(ctx context.Context, page, limit int) ([]domain.AdminAuditLog, int64, error) {
	return m.listFn(ctx, page, limit)
}

var _ service.AdminService = (*mockAdminService)(nil)

// adminRouter wires the handler with a fake auth middleware that injects actorID
// into the gin context the way the real Auth middleware does.
func adminRouter(svc service.AdminService, actorID uuid.UUID) *gin.Engine {
	gin.SetMode(gin.TestMode)
	h := handler.NewAdminHandler(svc)
	r := gin.New()
	r.Use(func(c *gin.Context) { c.Set("userID", actorID) })
	r.POST("/api/admin/users/admin-role", h.SetUserAdmin)
	r.GET("/api/admin/role-changes", h.RecentRoleChanges)
	return r
}

func postRole(r *gin.Engine, body string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/admin/users/admin-role", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	return w
}

func TestAdminHandler_Grant_Success(t *testing.T) {
	actor := uuid.New()
	var gotActor uuid.UUID
	var gotGrant bool
	svc := &mockAdminService{setFn: func(_ context.Context, a uuid.UUID, _ string, grant bool) (service.AdminRoleResult, error) {
		gotActor, gotGrant = a, grant
		return service.AdminRoleResult{TargetID: uuid.New(), TargetEmail: "t@x.test", TargetName: "T", IsAdmin: true, NoChange: false}, nil
	}}
	w := postRole(adminRouter(svc, actor), `{"email":"t@x.test","grant":true}`)

	if w.Code != http.StatusOK {
		t.Fatalf("want 200, got %d (%s)", w.Code, w.Body.String())
	}
	if gotActor != actor {
		t.Errorf("actorID not threaded from context: want %s got %s", actor, gotActor)
	}
	if !gotGrant {
		t.Errorf("grant flag not passed through")
	}
	body := w.Body.String()
	if !strings.Contains(body, `"is_admin":true`) || !strings.Contains(body, `"no_change":false`) {
		t.Errorf("unexpected response body: %s", body)
	}
}

func TestAdminHandler_NoChange(t *testing.T) {
	svc := &mockAdminService{setFn: func(_ context.Context, _ uuid.UUID, _ string, _ bool) (service.AdminRoleResult, error) {
		return service.AdminRoleResult{TargetEmail: "t@x.test", IsAdmin: true, NoChange: true}, nil
	}}
	w := postRole(adminRouter(svc, uuid.New()), `{"email":"t@x.test","grant":true}`)
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"no_change":true`) {
		t.Fatalf("want 200 no_change:true, got %d (%s)", w.Code, w.Body.String())
	}
}

func TestAdminHandler_SelfRevoke_400(t *testing.T) {
	svc := &mockAdminService{setFn: func(_ context.Context, _ uuid.UUID, _ string, _ bool) (service.AdminRoleResult, error) {
		return service.AdminRoleResult{}, domain.ErrCannotRevokeSelf
	}}
	w := postRole(adminRouter(svc, uuid.New()), `{"email":"t@x.test","grant":false}`)
	if w.Code != http.StatusBadRequest || !strings.Contains(w.Body.String(), "cannot_revoke_self") {
		t.Fatalf("want 400 cannot_revoke_self, got %d (%s)", w.Code, w.Body.String())
	}
}

func TestAdminHandler_LastAdmin_400(t *testing.T) {
	svc := &mockAdminService{setFn: func(_ context.Context, _ uuid.UUID, _ string, _ bool) (service.AdminRoleResult, error) {
		return service.AdminRoleResult{}, domain.ErrCannotRevokeLastAdmin
	}}
	w := postRole(adminRouter(svc, uuid.New()), `{"email":"t@x.test","grant":false}`)
	if w.Code != http.StatusBadRequest || !strings.Contains(w.Body.String(), "cannot_revoke_last_admin") {
		t.Fatalf("want 400 cannot_revoke_last_admin, got %d (%s)", w.Code, w.Body.String())
	}
}

func TestAdminHandler_UnknownEmail_404(t *testing.T) {
	svc := &mockAdminService{setFn: func(_ context.Context, _ uuid.UUID, _ string, _ bool) (service.AdminRoleResult, error) {
		return service.AdminRoleResult{}, domain.ErrUserNotFound
	}}
	w := postRole(adminRouter(svc, uuid.New()), `{"email":"nobody@x.test","grant":true}`)
	if w.Code != http.StatusNotFound || !strings.Contains(w.Body.String(), "user_not_found") {
		t.Fatalf("want 404 user_not_found, got %d (%s)", w.Code, w.Body.String())
	}
}

func TestAdminHandler_MissingGrantField_400(t *testing.T) {
	// grant is *bool with binding:"required"; omitting it must be rejected, not
	// silently coerced to false (which would mean "revoke").
	svc := &mockAdminService{setFn: func(_ context.Context, _ uuid.UUID, _ string, _ bool) (service.AdminRoleResult, error) {
		t.Fatal("service must not be called when grant is missing")
		return service.AdminRoleResult{}, nil
	}}
	w := postRole(adminRouter(svc, uuid.New()), `{"email":"t@x.test"}`)
	if w.Code != http.StatusBadRequest || !strings.Contains(w.Body.String(), "invalid_input") {
		t.Fatalf("want 400 invalid_input, got %d (%s)", w.Code, w.Body.String())
	}
}

func TestAdminHandler_InvalidEmail_400(t *testing.T) {
	svc := &mockAdminService{setFn: func(_ context.Context, _ uuid.UUID, _ string, _ bool) (service.AdminRoleResult, error) {
		t.Fatal("service must not be called when email is invalid")
		return service.AdminRoleResult{}, nil
	}}
	w := postRole(adminRouter(svc, uuid.New()), `{"email":"not-an-email","grant":true}`)
	if w.Code != http.StatusBadRequest || !strings.Contains(w.Body.String(), "invalid_input") {
		t.Fatalf("want 400 invalid_input, got %d (%s)", w.Code, w.Body.String())
	}
}

func TestAdminHandler_InternalError_500(t *testing.T) {
	svc := &mockAdminService{setFn: func(_ context.Context, _ uuid.UUID, _ string, _ bool) (service.AdminRoleResult, error) {
		return service.AdminRoleResult{}, context.DeadlineExceeded
	}}
	w := postRole(adminRouter(svc, uuid.New()), `{"email":"t@x.test","grant":true}`)
	if w.Code != http.StatusInternalServerError {
		t.Fatalf("want 500, got %d (%s)", w.Code, w.Body.String())
	}
}

func TestAdminHandler_RoleChanges_Success(t *testing.T) {
	var gotPage, gotLimit int
	svc := &mockAdminService{listFn: func(_ context.Context, page, limit int) ([]domain.AdminAuditLog, int64, error) {
		gotPage, gotLimit = page, limit
		return []domain.AdminAuditLog{{ID: uuid.New(), ActorEmail: "a@x.test", TargetEmail: "t@x.test", Action: domain.AdminActionGrant}}, 7, nil
	}}
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/admin/role-changes?page=2&limit=5", nil)
	adminRouter(svc, uuid.New()).ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", w.Code)
	}
	if gotPage != 2 || gotLimit != 5 {
		t.Errorf("page/limit query not threaded: got page=%d limit=%d", gotPage, gotLimit)
	}
	body := w.Body.String()
	if !strings.Contains(body, `"action":"grant"`) || !strings.Contains(body, `"id":`) {
		t.Errorf("unexpected role-changes body: %s", body)
	}
	if !strings.Contains(body, `"total":7`) || !strings.Contains(body, `"page":2`) || !strings.Contains(body, `"data":`) {
		t.Errorf("expected paginated envelope, got: %s", body)
	}
}

func TestAdminHandler_RoleChanges_Error_500(t *testing.T) {
	svc := &mockAdminService{listFn: func(_ context.Context, _, _ int) ([]domain.AdminAuditLog, int64, error) {
		return nil, 0, context.DeadlineExceeded
	}}
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/admin/role-changes", nil)
	adminRouter(svc, uuid.New()).ServeHTTP(w, req)
	if w.Code != http.StatusInternalServerError {
		t.Fatalf("want 500, got %d (%s)", w.Code, w.Body.String())
	}
}
