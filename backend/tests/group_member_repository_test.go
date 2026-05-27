package tests

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/repository"
	"lost-pets/tests/testdb"
)

// newTestGroup creates and persists a LocalGroup for FK requirements.
func newTestGroup(t *testing.T, groupRepo repository.LocalGroupRepository, creatorID uuid.UUID) *domain.LocalGroup {
	t.Helper()
	ctx := context.Background()
	group := &domain.LocalGroup{
		ID:        uuid.New(),
		Name:      fmt.Sprintf("Group-%s", uuid.New().String()[:8]),
		City:      fmt.Sprintf("City-%s", uuid.New().String()[:8]),
		CreatedBy: creatorID,
	}
	if err := groupRepo.Create(ctx, group); err != nil {
		t.Fatalf("newTestGroup: %v", err)
	}
	return group
}

func TestGroupMemberRepository_JoinAndIsMember(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	groupRepo := repository.NewLocalGroupRepository(gormDB)
	memberRepo := repository.NewGroupMemberRepository(gormDB)
	ctx := context.Background()

	creator := newTestUser(t, userRepo)
	member := newTestUser(t, userRepo)
	group := newTestGroup(t, groupRepo, creator.ID)

	// Before join
	isMember, err := memberRepo.IsMember(ctx, group.ID, member.ID)
	if err != nil {
		t.Fatalf("IsMember before join: %v", err)
	}
	if isMember {
		t.Error("want IsMember=false before joining")
	}

	// Join
	gm := &domain.GroupMember{ID: uuid.New(), GroupID: group.ID, UserID: member.ID}
	if err := memberRepo.Create(ctx, gm); err != nil {
		t.Fatalf("Create: %v", err)
	}

	// After join
	isMember, err = memberRepo.IsMember(ctx, group.ID, member.ID)
	if err != nil {
		t.Fatalf("IsMember after join: %v", err)
	}
	if !isMember {
		t.Error("want IsMember=true after joining")
	}
}

func TestGroupMemberRepository_LeaveAndIsMember(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	groupRepo := repository.NewLocalGroupRepository(gormDB)
	memberRepo := repository.NewGroupMemberRepository(gormDB)
	ctx := context.Background()

	creator := newTestUser(t, userRepo)
	member := newTestUser(t, userRepo)
	group := newTestGroup(t, groupRepo, creator.ID)

	// Join then leave
	gm := &domain.GroupMember{ID: uuid.New(), GroupID: group.ID, UserID: member.ID}
	if err := memberRepo.Create(ctx, gm); err != nil {
		t.Fatalf("Create: %v", err)
	}

	if err := memberRepo.Delete(ctx, group.ID, member.ID); err != nil {
		t.Fatalf("Delete: %v", err)
	}

	isMember, err := memberRepo.IsMember(ctx, group.ID, member.ID)
	if err != nil {
		t.Fatalf("IsMember after leave: %v", err)
	}
	if isMember {
		t.Error("want IsMember=false after leaving")
	}
}

func TestGroupMemberRepository_Leave_NotMember(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	groupRepo := repository.NewLocalGroupRepository(gormDB)
	memberRepo := repository.NewGroupMemberRepository(gormDB)
	ctx := context.Background()

	creator := newTestUser(t, userRepo)
	nonMember := newTestUser(t, userRepo)
	group := newTestGroup(t, groupRepo, creator.ID)

	err := memberRepo.Delete(ctx, group.ID, nonMember.ID)
	if !errors.Is(err, domain.ErrNotMember) {
		t.Errorf("want ErrNotMember when leaving a group not joined, got %v", err)
	}
}

func TestGroupMemberRepository_GetMembers(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	groupRepo := repository.NewLocalGroupRepository(gormDB)
	memberRepo := repository.NewGroupMemberRepository(gormDB)
	ctx := context.Background()

	creator := newTestUser(t, userRepo)
	group := newTestGroup(t, groupRepo, creator.ID)

	m1 := newTestUser(t, userRepo)
	m2 := newTestUser(t, userRepo)
	for _, u := range []*domain.User{m1, m2} {
		gm := &domain.GroupMember{ID: uuid.New(), GroupID: group.ID, UserID: u.ID}
		if err := memberRepo.Create(ctx, gm); err != nil {
			t.Fatalf("Create member %s: %v", u.ID, err)
		}
	}

	members, err := memberRepo.GetByGroupID(ctx, group.ID, 20, 0)
	if err != nil {
		t.Fatalf("GetByGroupID: %v", err)
	}
	if len(members) < 2 {
		t.Errorf("want at least 2 members, got %d", len(members))
	}
}
