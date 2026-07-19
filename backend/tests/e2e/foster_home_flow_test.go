//go:build e2e

package e2e_test

import (
	"encoding/json"
	"net/http"
	"testing"

	"gorm.io/gorm"
	"lost-pets/internal/domain"
)

// fosterHomeResponse mirrors the flattened JSON shape of dto.MyFosterHomeResponse
// (dto.FosterHomeResponse embedded + status/rejection_reason). The public
// directory endpoints (List/GetByID) omit status/rejection_reason — those
// fields simply decode to their zero value ("") there, which is fine since
// this test only reads them from the owner/admin-facing responses.
type fosterHomeResponse struct {
	ID              string   `json:"id"`
	OwnerUserID     string   `json:"owner_user_id"`
	City            string   `json:"city"`
	HousingType     string   `json:"housing_type"`
	AnimalTypes     []string `json:"animal_types"`
	Capacity        int      `json:"capacity"`
	Description     string   `json:"description"`
	Status          string   `json:"status"`
	RejectionReason string   `json:"rejection_reason"`
}

// fosterHomeModerationLogResponse mirrors domain.FosterHomeModerationLog, the
// raw shape returned by GET /api/foster-homes/:id/logs.
type fosterHomeModerationLogResponse struct {
	ID           string `json:"id"`
	FosterHomeID string `json:"foster_home_id"`
	ActorAdminID string `json:"actor_admin_id"`
	Action       string `json:"action"`
	Reason       string `json:"reason"`
}

// containsFosterHomeID reports whether the given foster home ID appears in a
// directory listing's data slice.
func containsFosterHomeID(data []fosterHomeResponse, id string) bool {
	for _, fh := range data {
		if fh.ID == id {
			return true
		}
	}
	return false
}

// markEmailVerified flips users.email_verified directly in the DB. Foster
// home registration requires a verified email (FosterHomeService.RegisterOwn),
// but the e2e harness runs with EnableEmailVerification: false (the real OTP
// endpoints 501 in that mode), so there is no HTTP path to reach this state —
// a direct DB write is the only option available to the test.
func markEmailVerified(t *testing.T, db *gorm.DB, email string) {
	t.Helper()
	if err := db.Model(&domain.User{}).Where("email = ?", email).Update("email_verified", true).Error; err != nil {
		t.Fatalf("mark email verified for %s: %v", email, err)
	}
}

// markAdmin flips users.is_admin directly in the DB. There is intentionally
// no self-serve HTTP endpoint to create the first admin (CLAUDE.md rule #20 —
// the only path is the audited cmd/promote-admin CLI), so tests that need an
// admin-authenticated caller must set the flag directly.
func markAdmin(t *testing.T, db *gorm.DB, email string) {
	t.Helper()
	if err := db.Model(&domain.User{}).Where("email = ?", email).Update("is_admin", true).Error; err != nil {
		t.Fatalf("mark admin for %s: %v", email, err)
	}
}

// TestFosterHomeFlow_RegisterApproveSuspend is the end-to-end guard for the
// foster-homes moderation lifecycle: a newly registered foster home is
// invisible in the public directory until an admin approves it, becomes
// visible once approved, and disappears again (record retained, not deleted)
// once an admin suspends it — with every moderation action leaving an
// auditable log entry.
func TestFosterHomeFlow_RegisterApproveSuspend(t *testing.T) {
	baseURL, db, cleanup := startTestServerWithDB(t)
	defer cleanup()

	// ── 1. Create + email-verify the owner ────────────────────────────
	ownerToken, ownerEmail := registerAndLogin(t, baseURL)
	markEmailVerified(t, db, ownerEmail)

	// Separate admin user — RequireAdmin re-checks users.is_admin from the DB
	// on every request, so this can be granted after login.
	adminToken, adminEmail := registerAndLogin(t, baseURL)
	markAdmin(t, db, adminEmail)

	// ── 2. POST /api/foster-homes — pending ────────────────────────────
	createBody := map[string]interface{}{
		"city":         "Montevideo",
		"housing_type": "house",
		"animal_types": []string{"dog"},
		"capacity":     1,
		"description":  "Fondo con patio grande, ideal para perros en tránsito.",
	}
	createResp := adoptionAuthedRequest(t, http.MethodPost, baseURL+"/api/foster-homes", ownerToken, createBody)
	defer createResp.Body.Close()
	if createResp.StatusCode != http.StatusCreated {
		t.Fatalf("register foster home: want 201, got %d", createResp.StatusCode)
	}
	var created fosterHomeResponse
	if err := json.NewDecoder(createResp.Body).Decode(&created); err != nil {
		t.Fatalf("register foster home: decode failed: %v", err)
	}
	if created.ID == "" {
		t.Fatal("register foster home: returned empty ID")
	}
	if created.Status != domain.FosterHomeStatusPending {
		t.Errorf("register foster home: status = %q, want %q", created.Status, domain.FosterHomeStatusPending)
	}

	// ── 3. GET /api/foster-homes — pending home NOT in directory ──────
	listBeforeResp := adoptionAuthedRequest(t, http.MethodGet, baseURL+"/api/foster-homes", ownerToken, nil)
	defer listBeforeResp.Body.Close()
	if listBeforeResp.StatusCode != http.StatusOK {
		t.Fatalf("list foster homes (pending): want 200, got %d", listBeforeResp.StatusCode)
	}
	var listBefore []fosterHomeResponse
	if err := json.NewDecoder(listBeforeResp.Body).Decode(&listBefore); err != nil {
		t.Fatalf("list foster homes (pending): decode failed: %v", err)
	}
	if containsFosterHomeID(listBefore, created.ID) {
		t.Errorf("list foster homes (pending): pending home %s should NOT appear, got %+v", created.ID, listBefore)
	}

	// ── 4. Admin approve ────────────────────────────────────────────────
	approveResp := adoptionAuthedRequest(t, http.MethodPost, baseURL+"/api/foster-homes/"+created.ID+"/approve", adminToken, nil)
	defer approveResp.Body.Close()
	if approveResp.StatusCode != http.StatusOK {
		t.Fatalf("approve foster home: want 200, got %d", approveResp.StatusCode)
	}
	var approved fosterHomeResponse
	if err := json.NewDecoder(approveResp.Body).Decode(&approved); err != nil {
		t.Fatalf("approve foster home: decode failed: %v", err)
	}
	if approved.Status != domain.FosterHomeStatusApproved {
		t.Errorf("approve foster home: status = %q, want %q", approved.Status, domain.FosterHomeStatusApproved)
	}

	// ── 5. GET /api/foster-homes — now visible; GET /:id — 200 ─────────
	listAfterResp := adoptionAuthedRequest(t, http.MethodGet, baseURL+"/api/foster-homes", ownerToken, nil)
	defer listAfterResp.Body.Close()
	if listAfterResp.StatusCode != http.StatusOK {
		t.Fatalf("list foster homes (approved): want 200, got %d", listAfterResp.StatusCode)
	}
	var listAfter []fosterHomeResponse
	if err := json.NewDecoder(listAfterResp.Body).Decode(&listAfter); err != nil {
		t.Fatalf("list foster homes (approved): decode failed: %v", err)
	}
	if !containsFosterHomeID(listAfter, created.ID) {
		t.Errorf("list foster homes (approved): expected home %s in listing, got %+v", created.ID, listAfter)
	}

	getByIDResp := adoptionAuthedRequest(t, http.MethodGet, baseURL+"/api/foster-homes/"+created.ID, ownerToken, nil)
	defer getByIDResp.Body.Close()
	if getByIDResp.StatusCode != http.StatusOK {
		t.Fatalf("get foster home by id (approved): want 200, got %d", getByIDResp.StatusCode)
	}

	// ── 6. Admin suspend ─────────────────────────────────────────────────
	suspendResp := adoptionAuthedRequest(t, http.MethodPost, baseURL+"/api/foster-homes/"+created.ID+"/suspend", adminToken,
		map[string]interface{}{"reason": "fraud"})
	defer suspendResp.Body.Close()
	if suspendResp.StatusCode != http.StatusOK {
		t.Fatalf("suspend foster home: want 200, got %d", suspendResp.StatusCode)
	}
	var suspended fosterHomeResponse
	if err := json.NewDecoder(suspendResp.Body).Decode(&suspended); err != nil {
		t.Fatalf("suspend foster home: decode failed: %v", err)
	}
	if suspended.Status != domain.FosterHomeStatusSuspended {
		t.Errorf("suspend foster home: status = %q, want %q", suspended.Status, domain.FosterHomeStatusSuspended)
	}

	// ── 7. GET /:id — 404 (removed from directory, record retained) ────
	getAfterSuspendResp := adoptionAuthedRequest(t, http.MethodGet, baseURL+"/api/foster-homes/"+created.ID, ownerToken, nil)
	defer getAfterSuspendResp.Body.Close()
	if getAfterSuspendResp.StatusCode != http.StatusNotFound {
		t.Fatalf("get foster home by id (suspended): want 404, got %d", getAfterSuspendResp.StatusCode)
	}

	// ── 8. GET /:id/logs — moderation log contains action=suspend ──────
	logsResp := adoptionAuthedRequest(t, http.MethodGet, baseURL+"/api/foster-homes/"+created.ID+"/logs", adminToken, nil)
	defer logsResp.Body.Close()
	if logsResp.StatusCode != http.StatusOK {
		t.Fatalf("moderation logs: want 200, got %d", logsResp.StatusCode)
	}
	var logs []fosterHomeModerationLogResponse
	if err := json.NewDecoder(logsResp.Body).Decode(&logs); err != nil {
		t.Fatalf("moderation logs: decode failed: %v", err)
	}
	foundSuspendLog := false
	for _, l := range logs {
		if l.Action == domain.FosterHomeActionSuspend {
			foundSuspendLog = true
			break
		}
	}
	if !foundSuspendLog {
		t.Errorf("moderation logs: expected a %q action entry, got %+v", domain.FosterHomeActionSuspend, logs)
	}
}
