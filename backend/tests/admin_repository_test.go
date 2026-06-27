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

	changes, err := adminRepo.ListRoleChanges(context.Background(), 10)
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
	_ = uuid.Nil
}
