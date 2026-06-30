package tests

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/repository"
	"lost-pets/tests/testdb"
)

func TestStatEventRepository_RecordAndCount(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	repo := repository.NewStatEventRepository(gormDB)
	ctx := context.Background()

	petA := uuid.New()
	petB := uuid.New()

	// Same pet found twice -> distinct = 1; searches counted per row.
	if err := repo.Record(ctx, domain.StatEventPetFound, &petA); err != nil {
		t.Fatalf("record found A #1: %v", err)
	}
	if err := repo.Record(ctx, domain.StatEventPetFound, &petA); err != nil {
		t.Fatalf("record found A #2: %v", err)
	}
	if err := repo.Record(ctx, domain.StatEventPetFound, &petB); err != nil {
		t.Fatalf("record found B: %v", err)
	}
	if err := repo.Record(ctx, domain.StatEventSearchStarted, &petA); err != nil {
		t.Fatalf("record search A: %v", err)
	}

	reunited, err := repo.CountDistinctPets(ctx, domain.StatEventPetFound)
	if err != nil {
		t.Fatalf("count distinct: %v", err)
	}
	if reunited != 2 {
		t.Errorf("pets_reunited: want 2 distinct, got %d", reunited)
	}

	searches, err := repo.CountByType(ctx, domain.StatEventSearchStarted)
	if err != nil {
		t.Fatalf("count by type: %v", err)
	}
	if searches != 1 {
		t.Errorf("searches_started: want 1, got %d", searches)
	}
}
