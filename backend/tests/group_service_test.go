package tests

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
	"lost-pets/internal/service"
)

// ============================================================
// Mock: LocalGroupRepository
// ============================================================

type mockLocalGroupRepository struct {
	createFn               func(ctx context.Context, group *domain.LocalGroup) error
	getByIDFn              func(ctx context.Context, id uuid.UUID) (*domain.LocalGroup, error)
	getAllFn                func(ctx context.Context, city string, limit, offset int) ([]domain.LocalGroup, error)
	incrementMemberCountFn func(ctx context.Context, id uuid.UUID) error
	decrementMemberCountFn func(ctx context.Context, id uuid.UUID) error
}

func (m *mockLocalGroupRepository) Create(ctx context.Context, group *domain.LocalGroup) error {
	if m.createFn != nil {
		return m.createFn(ctx, group)
	}
	group.ID = uuid.New()
	return nil
}

func (m *mockLocalGroupRepository) GetByID(ctx context.Context, id uuid.UUID) (*domain.LocalGroup, error) {
	if m.getByIDFn != nil {
		return m.getByIDFn(ctx, id)
	}
	return &domain.LocalGroup{ID: id, Name: "Test Group", City: "Montevideo"}, nil
}

func (m *mockLocalGroupRepository) GetAll(ctx context.Context, city string, limit, offset int) ([]domain.LocalGroup, error) {
	if m.getAllFn != nil {
		return m.getAllFn(ctx, city, limit, offset)
	}
	return []domain.LocalGroup{}, nil
}

func (m *mockLocalGroupRepository) IncrementMemberCount(ctx context.Context, id uuid.UUID) error {
	if m.incrementMemberCountFn != nil {
		return m.incrementMemberCountFn(ctx, id)
	}
	return nil
}

func (m *mockLocalGroupRepository) DecrementMemberCount(ctx context.Context, id uuid.UUID) error {
	if m.decrementMemberCountFn != nil {
		return m.decrementMemberCountFn(ctx, id)
	}
	return nil
}

// ============================================================
// Mock: GroupMemberRepository
// ============================================================

type mockGroupMemberRepository struct {
	createFn       func(ctx context.Context, member *domain.GroupMember) error
	deleteFn       func(ctx context.Context, groupID, userID uuid.UUID) error
	isMemberFn     func(ctx context.Context, groupID, userID uuid.UUID) (bool, error)
	getByGroupIDFn func(ctx context.Context, groupID uuid.UUID, limit, offset int) ([]domain.GroupMember, error)
}

func (m *mockGroupMemberRepository) Create(ctx context.Context, member *domain.GroupMember) error {
	if m.createFn != nil {
		return m.createFn(ctx, member)
	}
	return nil
}

func (m *mockGroupMemberRepository) Delete(ctx context.Context, groupID, userID uuid.UUID) error {
	if m.deleteFn != nil {
		return m.deleteFn(ctx, groupID, userID)
	}
	return nil
}

func (m *mockGroupMemberRepository) IsMember(ctx context.Context, groupID, userID uuid.UUID) (bool, error) {
	if m.isMemberFn != nil {
		return m.isMemberFn(ctx, groupID, userID)
	}
	return false, nil
}

func (m *mockGroupMemberRepository) GetByGroupID(ctx context.Context, groupID uuid.UUID, limit, offset int) ([]domain.GroupMember, error) {
	if m.getByGroupIDFn != nil {
		return m.getByGroupIDFn(ctx, groupID, limit, offset)
	}
	return []domain.GroupMember{}, nil
}

// ============================================================
// Helper
// ============================================================

func newGroupService(groupRepo *mockLocalGroupRepository, memberRepo *mockGroupMemberRepository) service.GroupService {
	return service.NewGroupService(groupRepo, memberRepo)
}

// ============================================================
// CreateGroup tests
// ============================================================

func TestGroupService_CreateGroup(t *testing.T) {
	creatorID := uuid.New()
	groupID := uuid.New()

	tests := []struct {
		name       string
		groupRepo  *mockLocalGroupRepository
		memberRepo *mockGroupMemberRepository
		req        dto.CreateGroupRequest
		wantErr    error
	}{
		{
			name: "happy path — group created",
			groupRepo: &mockLocalGroupRepository{
				createFn: func(_ context.Context, g *domain.LocalGroup) error {
					g.ID = groupID
					return nil
				},
				getByIDFn: func(_ context.Context, id uuid.UUID) (*domain.LocalGroup, error) {
					return &domain.LocalGroup{ID: id, Name: "Montevideo Pets", City: "Montevideo"}, nil
				},
			},
			memberRepo: &mockGroupMemberRepository{},
			req: dto.CreateGroupRequest{
				City:        "Montevideo",
				Name:        "Montevideo Pets",
				Description: "Grupo de mascotas de Montevideo",
			},
			wantErr: nil,
		},
		{
			name: "duplicate city — returns error",
			groupRepo: &mockLocalGroupRepository{
				createFn: func(_ context.Context, g *domain.LocalGroup) error {
					return domain.ErrCityGroupExists
				},
			},
			memberRepo: &mockGroupMemberRepository{},
			req: dto.CreateGroupRequest{
				City: "Montevideo",
				Name: "Duplicate Group",
			},
			wantErr: domain.ErrCityGroupExists,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			svc := newGroupService(tc.groupRepo, tc.memberRepo)
			group, err := svc.CreateGroup(context.Background(), creatorID, tc.req)

			if tc.wantErr != nil {
				if !errors.Is(err, tc.wantErr) {
					t.Errorf("expected error %v, got %v", tc.wantErr, err)
				}
				if group != nil {
					t.Errorf("expected nil group on error, got %+v", group)
				}
				return
			}

			if err != nil {
				t.Errorf("unexpected error: %v", err)
				return
			}
			if group == nil {
				t.Error("expected group, got nil")
			}
		})
	}
}

// ============================================================
// Join tests
// ============================================================

func TestGroupService_Join(t *testing.T) {
	groupID := uuid.New()
	userID := uuid.New()

	tests := []struct {
		name       string
		groupRepo  *mockLocalGroupRepository
		memberRepo *mockGroupMemberRepository
		wantErr    error
	}{
		{
			name: "happy path — joined",
			groupRepo: &mockLocalGroupRepository{
				getByIDFn: func(_ context.Context, id uuid.UUID) (*domain.LocalGroup, error) {
					return &domain.LocalGroup{ID: id, Name: "Test"}, nil
				},
			},
			memberRepo: &mockGroupMemberRepository{
				isMemberFn: func(_ context.Context, _, _ uuid.UUID) (bool, error) {
					return false, nil
				},
				createFn: func(_ context.Context, m *domain.GroupMember) error {
					return nil
				},
			},
			wantErr: nil,
		},
		{
			name: "already member — returns ErrAlreadyMember",
			groupRepo: &mockLocalGroupRepository{
				getByIDFn: func(_ context.Context, id uuid.UUID) (*domain.LocalGroup, error) {
					return &domain.LocalGroup{ID: id, Name: "Test"}, nil
				},
			},
			memberRepo: &mockGroupMemberRepository{
				isMemberFn: func(_ context.Context, _, _ uuid.UUID) (bool, error) {
					return true, nil // already a member
				},
			},
			wantErr: domain.ErrAlreadyMember,
		},
		{
			name: "group not found — returns ErrGroupNotFound",
			groupRepo: &mockLocalGroupRepository{
				getByIDFn: func(_ context.Context, _ uuid.UUID) (*domain.LocalGroup, error) {
					return nil, domain.ErrGroupNotFound
				},
			},
			memberRepo: &mockGroupMemberRepository{},
			wantErr:    domain.ErrGroupNotFound,
		},
		{
			name: "unique constraint race — returns ErrAlreadyMember",
			groupRepo: &mockLocalGroupRepository{
				getByIDFn: func(_ context.Context, id uuid.UUID) (*domain.LocalGroup, error) {
					return &domain.LocalGroup{ID: id, Name: "Test"}, nil
				},
			},
			memberRepo: &mockGroupMemberRepository{
				isMemberFn: func(_ context.Context, _, _ uuid.UUID) (bool, error) {
					return false, nil
				},
				createFn: func(_ context.Context, m *domain.GroupMember) error {
					// Simulate race condition unique constraint
					return errors.New("duplicate key value violates unique constraint")
				},
			},
			wantErr: domain.ErrAlreadyMember,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			svc := newGroupService(tc.groupRepo, tc.memberRepo)
			err := svc.Join(context.Background(), groupID, userID)

			if tc.wantErr != nil {
				if !errors.Is(err, tc.wantErr) {
					t.Errorf("expected error %v, got %v", tc.wantErr, err)
				}
				return
			}

			if err != nil {
				t.Errorf("unexpected error: %v", err)
			}
		})
	}
}

// ============================================================
// Leave tests
// ============================================================

func TestGroupService_Leave(t *testing.T) {
	groupID := uuid.New()
	userID := uuid.New()

	tests := []struct {
		name       string
		groupRepo  *mockLocalGroupRepository
		memberRepo *mockGroupMemberRepository
		wantErr    error
	}{
		{
			name: "happy path — left group",
			groupRepo: &mockLocalGroupRepository{
				getByIDFn: func(_ context.Context, id uuid.UUID) (*domain.LocalGroup, error) {
					return &domain.LocalGroup{ID: id, Name: "Test"}, nil
				},
			},
			memberRepo: &mockGroupMemberRepository{
				deleteFn: func(_ context.Context, _, _ uuid.UUID) error {
					return nil
				},
			},
			wantErr: nil,
		},
		{
			name: "not a member — returns ErrNotMember",
			groupRepo: &mockLocalGroupRepository{
				getByIDFn: func(_ context.Context, id uuid.UUID) (*domain.LocalGroup, error) {
					return &domain.LocalGroup{ID: id, Name: "Test"}, nil
				},
			},
			memberRepo: &mockGroupMemberRepository{
				deleteFn: func(_ context.Context, _, _ uuid.UUID) error {
					return domain.ErrNotMember
				},
			},
			wantErr: domain.ErrNotMember,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			svc := newGroupService(tc.groupRepo, tc.memberRepo)
			err := svc.Leave(context.Background(), groupID, userID)

			if tc.wantErr != nil {
				if !errors.Is(err, tc.wantErr) {
					t.Errorf("expected error %v, got %v", tc.wantErr, err)
				}
				return
			}

			if err != nil {
				t.Errorf("unexpected error: %v", err)
			}
		})
	}
}

// ============================================================
// GetByCity (via List) tests
// ============================================================

func TestGroupService_GetByCity(t *testing.T) {
	tests := []struct {
		name       string
		city       string
		groupRepo  *mockLocalGroupRepository
		wantCount  int
		wantErr    error
	}{
		{
			name: "returns groups for city",
			city: "Montevideo",
			groupRepo: &mockLocalGroupRepository{
				getAllFn: func(_ context.Context, city string, _, _ int) ([]domain.LocalGroup, error) {
					if city == "Montevideo" {
						return []domain.LocalGroup{
							{ID: uuid.New(), City: "Montevideo", Name: "Grupo MV"},
						}, nil
					}
					return []domain.LocalGroup{}, nil
				},
			},
			wantCount: 1,
			wantErr:   nil,
		},
		{
			name: "no groups for city",
			city: "Tokio",
			groupRepo: &mockLocalGroupRepository{
				getAllFn: func(_ context.Context, _ string, _, _ int) ([]domain.LocalGroup, error) {
					return []domain.LocalGroup{}, nil
				},
			},
			wantCount: 0,
			wantErr:   nil,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			svc := newGroupService(tc.groupRepo, &mockGroupMemberRepository{})
			groups, err := svc.List(context.Background(), tc.city, 20, 0)

			if tc.wantErr != nil {
				if !errors.Is(err, tc.wantErr) {
					t.Errorf("expected error %v, got %v", tc.wantErr, err)
				}
				return
			}

			if err != nil {
				t.Errorf("unexpected error: %v", err)
				return
			}

			if len(groups) != tc.wantCount {
				t.Errorf("expected %d groups, got %d", tc.wantCount, len(groups))
			}
		})
	}
}

// ============================================================
// GetMembers tests
// ============================================================

func TestGroupService_GetMembers(t *testing.T) {
	groupID := uuid.New()
	userID := uuid.New()

	members := []domain.GroupMember{
		{ID: uuid.New(), GroupID: groupID, UserID: userID},
	}

	tests := []struct {
		name       string
		groupRepo  *mockLocalGroupRepository
		memberRepo *mockGroupMemberRepository
		wantCount  int
		wantErr    error
	}{
		{
			name: "returns member list",
			groupRepo: &mockLocalGroupRepository{
				getByIDFn: func(_ context.Context, id uuid.UUID) (*domain.LocalGroup, error) {
					return &domain.LocalGroup{ID: id, Name: "Test"}, nil
				},
			},
			memberRepo: &mockGroupMemberRepository{
				getByGroupIDFn: func(_ context.Context, _ uuid.UUID, _, _ int) ([]domain.GroupMember, error) {
					return members, nil
				},
			},
			wantCount: 1,
			wantErr:   nil,
		},
		{
			name: "group not found — returns ErrGroupNotFound",
			groupRepo: &mockLocalGroupRepository{
				getByIDFn: func(_ context.Context, _ uuid.UUID) (*domain.LocalGroup, error) {
					return nil, domain.ErrGroupNotFound
				},
			},
			memberRepo: &mockGroupMemberRepository{},
			wantCount:  0,
			wantErr:    domain.ErrGroupNotFound,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			svc := newGroupService(tc.groupRepo, tc.memberRepo)
			result, err := svc.GetMembers(context.Background(), groupID, 20, 0)

			if tc.wantErr != nil {
				if !errors.Is(err, tc.wantErr) {
					t.Errorf("expected error %v, got %v", tc.wantErr, err)
				}
				return
			}

			if err != nil {
				t.Errorf("unexpected error: %v", err)
				return
			}

			if len(result) != tc.wantCount {
				t.Errorf("expected %d members, got %d", tc.wantCount, len(result))
			}
		})
	}
}
