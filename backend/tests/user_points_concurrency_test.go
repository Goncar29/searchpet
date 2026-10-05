package tests

import (
	"context"
	"sync"
	"testing"

	"lost-pets/internal/domain"
	"lost-pets/internal/repository"
	"lost-pets/tests/testdb"
)

// Two events for a user with no user_points row yet used to race: both saw no
// row, both INSERTed, and the loser hit idx_user_points_user_id (23505), losing
// that whole increment. Needs real Postgres: mocks have no unique index (rule #34).
//
// The window is narrow, so each round uses a fresh user (a new race on the
// first insert) and the test runs several rounds to make the old code fail
// consistently.
func TestUserPointsRepository_UpsertConcurrentNewUser(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	pointsRepo := repository.NewUserPointsRepository(gormDB)
	ctx := context.Background()

	const (
		rounds = 15
		n      = 20
	)
	for round := 0; round < rounds; round++ {
		user := newTestUser(t, userRepo)

		start := make(chan struct{})
		errs := make(chan error, n)
		var wg sync.WaitGroup
		for i := 0; i < n; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				<-start
				_, err := pointsRepo.Upsert(ctx, user.ID, 5, "total_reports")
				errs <- err
			}()
		}
		close(start)
		wg.Wait()
		close(errs)
		for err := range errs {
			if err != nil {
				t.Errorf("round %d: concurrent Upsert failed: %v", round, err)
			}
		}

		var rows []domain.UserPoints
		if err := gormDB.Where("user_id = ?", user.ID).Find(&rows).Error; err != nil {
			t.Fatalf("round %d: load rows: %v", round, err)
		}
		if len(rows) != 1 {
			t.Fatalf("round %d: want exactly 1 row, got %d", round, len(rows))
		}
		if rows[0].Points != 5*n {
			t.Errorf("round %d: want points=%d, got %d", round, 5*n, rows[0].Points)
		}
		if rows[0].TotalReports != n {
			t.Errorf("round %d: want total_reports=%d, got %d", round, n, rows[0].TotalReports)
		}
	}
}
