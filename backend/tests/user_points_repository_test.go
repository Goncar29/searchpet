package tests

import (
	"context"
	"errors"
	"testing"

	"lost-pets/internal/domain"
	"lost-pets/internal/repository"
	"lost-pets/tests/testdb"
)

func TestUserPointsRepository_UpsertCreates(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	pointsRepo := repository.NewUserPointsRepository(gormDB)
	ctx := context.Background()

	user := newTestUser(t, userRepo)

	pts, err := pointsRepo.Upsert(ctx, user.ID, 5, "total_reports")
	if err != nil {
		t.Fatalf("Upsert: %v", err)
	}
	if pts.UserID != user.ID {
		t.Errorf("want userID %s, got %s", user.ID, pts.UserID)
	}
	if pts.Points != 5 {
		t.Errorf("want points=5, got %d", pts.Points)
	}
	if pts.TotalReports != 1 {
		t.Errorf("want total_reports=1, got %d", pts.TotalReports)
	}
}

func TestUserPointsRepository_UpsertAccumulates(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	pointsRepo := repository.NewUserPointsRepository(gormDB)
	ctx := context.Background()

	user := newTestUser(t, userRepo)

	// First upsert
	if _, err := pointsRepo.Upsert(ctx, user.ID, 5, "total_reports"); err != nil {
		t.Fatalf("Upsert 1: %v", err)
	}
	// Second upsert
	pts, err := pointsRepo.Upsert(ctx, user.ID, 100, "found_count")
	if err != nil {
		t.Fatalf("Upsert 2: %v", err)
	}
	if pts.Points != 105 {
		t.Errorf("want accumulated points=105, got %d", pts.Points)
	}
	if pts.TotalReports != 1 {
		t.Errorf("want total_reports=1, got %d", pts.TotalReports)
	}
	if pts.FoundCount != 1 {
		t.Errorf("want found_count=1, got %d", pts.FoundCount)
	}
}

func TestUserPointsRepository_GetByUserID_NotFound(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	pointsRepo := repository.NewUserPointsRepository(gormDB)
	ctx := context.Background()

	user := newTestUser(t, userRepo)

	_, err := pointsRepo.GetByUserID(ctx, user.ID)
	if !errors.Is(err, domain.ErrPointsNotFound) {
		t.Errorf("want ErrPointsNotFound for new user, got %v", err)
	}
}

func TestUserPointsRepository_GetLeaderboard(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	pointsRepo := repository.NewUserPointsRepository(gormDB)
	ctx := context.Background()

	// Create 3 users in Montevideo with different point totals
	scores := []int{50, 200, 75}
	for _, score := range scores {
		u := newTestUser(t, userRepo)
		u.City = "Montevideo"
		if err := userRepo.Update(ctx, u); err != nil {
			t.Fatalf("Update user city: %v", err)
		}
		if _, err := pointsRepo.Upsert(ctx, u.ID, score, "total_reports"); err != nil {
			t.Fatalf("Upsert points: %v", err)
		}
	}

	// Create a user in another city — must NOT appear in Montevideo leaderboard
	other := newTestUser(t, userRepo)
	other.City = "Buenos Aires"
	if err := userRepo.Update(ctx, other); err != nil {
		t.Fatalf("Update other city: %v", err)
	}
	if _, err := pointsRepo.Upsert(ctx, other.ID, 999, "total_reports"); err != nil {
		t.Fatalf("Upsert other: %v", err)
	}

	leaderboard, err := pointsRepo.FindLeaderboard(ctx, "Montevideo", 10)
	if err != nil {
		t.Fatalf("FindLeaderboard: %v", err)
	}
	if len(leaderboard) < 3 {
		t.Fatalf("want at least 3 entries, got %d", len(leaderboard))
	}

	// Must be in descending order
	for i := 1; i < len(leaderboard); i++ {
		if leaderboard[i-1].Points < leaderboard[i].Points {
			t.Errorf("leaderboard not sorted: entry %d (%d points) < entry %d (%d points)",
				i-1, leaderboard[i-1].Points, i, leaderboard[i].Points)
		}
	}

	// Top entry should have 200 points
	if leaderboard[0].Points != 200 {
		t.Errorf("want top points=200, got %d", leaderboard[0].Points)
	}
}
