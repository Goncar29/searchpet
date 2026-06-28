package tests

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/repository"
	"lost-pets/tests/testdb"
)

func TestAdminRepository_SetAdminWithAudit_FlipsFlagAndWritesAudit(t *testing.T) {
	db := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(db)
	adminRepo := repository.NewAdminRepository(db)

	actor := newTestUser(t, userRepo)
	target := newTestUser(t, userRepo)

	entry := &domain.AdminAuditLog{
		ActorID:     actor.ID,
		TargetID:    target.ID,
		ActorEmail:  actor.Email,
		TargetEmail: target.Email,
		Action:      "grant",
	}
	if err := adminRepo.SetAdminWithAudit(context.Background(), target.ID, true, entry); err != nil {
		t.Fatalf("SetAdminWithAudit: %v", err)
	}

	got, _ := userRepo.GetByID(context.Background(), target.ID)
	if !got.IsAdmin {
		t.Errorf("expected target IsAdmin=true after grant")
	}

	changes, err := adminRepo.ListRoleChanges(context.Background(), 10, 0)
	if err != nil {
		t.Fatalf("ListRoleChanges: %v", err)
	}
	if len(changes) != 1 || changes[0].Action != "grant" || changes[0].TargetEmail != target.Email {
		t.Errorf("expected 1 grant audit row for target, got %+v", changes)
	}
}

func TestAdminRepository_CountAdmins(t *testing.T) {
	db := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(db)
	adminRepo := repository.NewAdminRepository(db)

	u := newTestUser(t, userRepo)
	if n, _ := adminRepo.CountAdmins(context.Background()); n != 0 {
		t.Fatalf("expected 0 admins initially, got %d", n)
	}

	u.IsAdmin = true
	if err := userRepo.Update(context.Background(), u); err != nil {
		t.Fatalf("Update: %v", err)
	}
	if n, _ := adminRepo.CountAdmins(context.Background()); n != 1 {
		t.Errorf("expected 1 admin, got %d", n)
	}
}

// The authoritative anti-lockout guard lives INSIDE the transaction (FOR UPDATE),
// not just in the service. Revoking the only admin must fail atomically: no flip,
// no audit row.
func TestAdminRepository_SetAdminWithAudit_RejectsLastAdmin(t *testing.T) {
	ctx := context.Background()
	db := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(db)
	adminRepo := repository.NewAdminRepository(db)

	only := newTestUser(t, userRepo)
	only.IsAdmin = true
	if err := userRepo.Update(ctx, only); err != nil {
		t.Fatalf("Update: %v", err)
	}

	entry := &domain.AdminAuditLog{
		ActorID: only.ID, TargetID: only.ID,
		ActorEmail: only.Email, TargetEmail: only.Email, Action: domain.AdminActionRevoke,
	}
	err := adminRepo.SetAdminWithAudit(ctx, only.ID, false, entry)
	if err != domain.ErrCannotRevokeLastAdmin {
		t.Fatalf("want ErrCannotRevokeLastAdmin, got %v", err)
	}

	got, _ := userRepo.GetByID(ctx, only.ID)
	if !got.IsAdmin {
		t.Errorf("last admin must stay admin after a rejected revoke")
	}
	if changes, _ := adminRepo.ListRoleChanges(ctx, 10, 0); len(changes) != 0 {
		t.Errorf("no audit row should be written on a rejected revoke, got %+v", changes)
	}
}

// Revoking one of several admins is allowed and writes its audit row.
func TestAdminRepository_SetAdminWithAudit_RevokeWithMultipleAdmins(t *testing.T) {
	ctx := context.Background()
	db := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(db)
	adminRepo := repository.NewAdminRepository(db)

	a := newTestUser(t, userRepo)
	b := newTestUser(t, userRepo)
	for _, u := range []*domain.User{a, b} {
		u.IsAdmin = true
		if err := userRepo.Update(ctx, u); err != nil {
			t.Fatalf("Update: %v", err)
		}
	}

	entry := &domain.AdminAuditLog{
		ActorID: a.ID, TargetID: b.ID,
		ActorEmail: a.Email, TargetEmail: b.Email, Action: domain.AdminActionRevoke,
	}
	if err := adminRepo.SetAdminWithAudit(ctx, b.ID, false, entry); err != nil {
		t.Fatalf("revoke with 2 admins should succeed, got %v", err)
	}

	gotB, _ := userRepo.GetByID(ctx, b.ID)
	gotA, _ := userRepo.GetByID(ctx, a.ID)
	if gotB.IsAdmin {
		t.Errorf("target b should no longer be admin")
	}
	if !gotA.IsAdmin {
		t.Errorf("other admin a must be untouched")
	}
	if changes, _ := adminRepo.ListRoleChanges(ctx, 10, 0); len(changes) != 1 || changes[0].Action != domain.AdminActionRevoke {
		t.Errorf("expected 1 revoke audit row, got %+v", changes)
	}
}

// ListRoleChanges pages via limit+offset, and CountRoleChanges reports the total.
func TestAdminRepository_ListRoleChanges_Paginates(t *testing.T) {
	ctx := context.Background()
	db := testdb.SetupTestDB(t)
	adminRepo := repository.NewAdminRepository(db)

	for i := 0; i < 3; i++ {
		row := &domain.AdminAuditLog{
			ActorID: uuid.New(), TargetID: uuid.New(),
			ActorEmail: "a@x.test", TargetEmail: "t@x.test", Action: domain.AdminActionGrant,
		}
		if err := db.Create(row).Error; err != nil {
			t.Fatalf("seed audit row: %v", err)
		}
	}

	total, err := adminRepo.CountRoleChanges(ctx)
	if err != nil || total != 3 {
		t.Fatalf("CountRoleChanges: want 3, got %d (err %v)", total, err)
	}

	if page1, _ := adminRepo.ListRoleChanges(ctx, 2, 0); len(page1) != 2 {
		t.Errorf("page 1 (limit 2, offset 0): want 2 rows, got %d", len(page1))
	}
	if page2, _ := adminRepo.ListRoleChanges(ctx, 2, 2); len(page2) != 1 {
		t.Errorf("page 2 (limit 2, offset 2): want 1 row, got %d", len(page2))
	}
}
