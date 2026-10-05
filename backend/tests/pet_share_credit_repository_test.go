package tests

import (
	"context"
	"sync"
	"testing"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/repository"
	"lost-pets/tests/testdb"
)

func newSharePet(t *testing.T, petRepo repository.PetRepository, owner uuid.UUID) *domain.Pet {
	t.Helper()
	pet := &domain.Pet{ID: uuid.New(), OwnerID: ptrUUID(owner), Name: "Compartida", Type: "perro", Status: domain.PetStatusLost}
	if err := petRepo.Create(pet); err != nil {
		t.Fatalf("Create pet: %v", err)
	}
	return pet
}

func TestPetShareCreditRepository_CreditOncePerPetAndUser(t *testing.T) {
	db := testdb.SetupTestDB(t)
	repo := repository.NewPetShareCreditRepository(db)
	petRepo := repository.NewPetRepository(db)
	user := newTestUser(t, repository.NewUserRepository(db))
	pet, other := newSharePet(t, petRepo, user.ID), newSharePet(t, petRepo, user.ID)
	ctx := context.Background()

	if fresh, err := repo.CreditOnce(ctx, pet.ID, user.ID); err != nil || !fresh {
		t.Fatalf("first credit: fresh=%v err=%v, want true nil", fresh, err)
	}
	if fresh, err := repo.CreditOnce(ctx, pet.ID, user.ID); err != nil || fresh {
		t.Fatalf("same pet again: fresh=%v err=%v, want false nil", fresh, err)
	}
	if fresh, err := repo.CreditOnce(ctx, other.ID, user.ID); err != nil || !fresh {
		t.Fatalf("another pet: fresh=%v err=%v, want true nil", fresh, err)
	}
}

// Two links generated at the same time for the same pet must pay once: the
// primary key decides, not a read before the write.
func TestPetShareCreditRepository_ConcurrentCreditsPayOnce(t *testing.T) {
	db := testdb.SetupTestDB(t)
	repo := repository.NewPetShareCreditRepository(db)
	user := newTestUser(t, repository.NewUserRepository(db))
	pet := newSharePet(t, repository.NewPetRepository(db), user.ID)

	const n = 20
	var wg sync.WaitGroup
	start := make(chan struct{})
	results := make(chan bool, n)
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			fresh, err := repo.CreditOnce(context.Background(), pet.ID, user.ID)
			if err != nil {
				t.Errorf("CreditOnce: %v", err)
			}
			results <- fresh
		}()
	}
	close(start)
	wg.Wait()
	close(results)

	wins := 0
	for fresh := range results {
		if fresh {
			wins++
		}
	}
	if wins != 1 {
		t.Fatalf("concurrent credits for one (pet, user): %d paid, want exactly 1", wins)
	}
}

// Revoke frees the pair, so a later CreditOnce for it is new again.
func TestPetShareCreditRepository_RevokeFreesThePair(t *testing.T) {
	db := testdb.SetupTestDB(t)
	repo := repository.NewPetShareCreditRepository(db)
	user := newTestUser(t, repository.NewUserRepository(db))
	pet := newSharePet(t, repository.NewPetRepository(db), user.ID)
	ctx := context.Background()

	if _, err := repo.CreditOnce(ctx, pet.ID, user.ID); err != nil {
		t.Fatal(err)
	}
	if err := repo.Revoke(ctx, pet.ID, user.ID); err != nil {
		t.Fatalf("Revoke: %v", err)
	}
	if fresh, err := repo.CreditOnce(ctx, pet.ID, user.ID); err != nil || !fresh {
		t.Fatalf("after Revoke: fresh=%v err=%v, want true nil", fresh, err)
	}
}
