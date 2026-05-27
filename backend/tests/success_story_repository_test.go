package tests

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/repository"
	"lost-pets/tests/testdb"
)

func TestSuccessStoryRepository_CreateAndGetByID(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	petRepo := repository.NewPetRepository(gormDB)
	storyRepo := repository.NewSuccessStoryRepository(gormDB)
	ctx := context.Background()

	owner := newTestUser(t, userRepo)
	pet := &domain.Pet{ID: uuid.New(), OwnerID: owner.ID, Name: "Story Pet", Type: "perro", Status: "found"}
	if err := petRepo.Create(pet); err != nil {
		t.Fatalf("Create pet: %v", err)
	}

	story := &domain.SuccessStory{
		ID:     uuid.New(),
		PetID:  pet.ID,
		UserID: owner.ID,
		Title:  "¡Firulais encontrado!",
		Body:   "Gracias a la comunidad.",
	}
	if err := storyRepo.Create(ctx, story); err != nil {
		t.Fatalf("Create: %v", err)
	}

	got, err := storyRepo.GetByID(ctx, story.ID)
	if err != nil {
		t.Fatalf("GetByID: %v", err)
	}
	if got.Title != story.Title {
		t.Errorf("want title %q, got %q", story.Title, got.Title)
	}
}

func TestSuccessStoryRepository_GetByID_NotFound(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	storyRepo := repository.NewSuccessStoryRepository(gormDB)
	ctx := context.Background()

	_, err := storyRepo.GetByID(ctx, uuid.New())
	if !errors.Is(err, domain.ErrStoryNotFound) {
		t.Errorf("want ErrStoryNotFound, got %v", err)
	}
}

func TestSuccessStoryRepository_GetAll_FeaturedFilter(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	petRepo := repository.NewPetRepository(gormDB)
	storyRepo := repository.NewSuccessStoryRepository(gormDB)
	ctx := context.Background()

	owner := newTestUser(t, userRepo)

	// Create two pets and their stories
	p1 := &domain.Pet{ID: uuid.New(), OwnerID: owner.ID, Name: "Pet1", Type: "perro", Status: "found"}
	p2 := &domain.Pet{ID: uuid.New(), OwnerID: owner.ID, Name: "Pet2", Type: "gato", Status: "found"}
	for _, p := range []*domain.Pet{p1, p2} {
		if err := petRepo.Create(p); err != nil {
			t.Fatalf("Create pet: %v", err)
		}
	}

	adminID := uuid.New()
	s1 := &domain.SuccessStory{ID: uuid.New(), PetID: p1.ID, UserID: owner.ID, Body: "Story 1", Featured: true, FeaturedBy: &adminID}
	s2 := &domain.SuccessStory{ID: uuid.New(), PetID: p2.ID, UserID: owner.ID, Body: "Story 2", Featured: false}
	for _, s := range []*domain.SuccessStory{s1, s2} {
		if err := storyRepo.Create(ctx, s); err != nil {
			t.Fatalf("Create story: %v", err)
		}
	}

	// All stories
	all, err := storyRepo.GetAll(ctx, nil, 20, 0)
	if err != nil {
		t.Fatalf("GetAll (nil filter): %v", err)
	}
	if len(all) < 2 {
		t.Errorf("want at least 2 stories, got %d", len(all))
	}

	// Featured only
	featured := true
	featuredStories, err := storyRepo.GetAll(ctx, &featured, 20, 0)
	if err != nil {
		t.Fatalf("GetAll (featured): %v", err)
	}
	for _, s := range featuredStories {
		if !s.Featured {
			t.Errorf("non-featured story %s appeared in featured filter", s.ID)
		}
	}
}

func TestSuccessStoryRepository_GetByPetID(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	petRepo := repository.NewPetRepository(gormDB)
	storyRepo := repository.NewSuccessStoryRepository(gormDB)
	ctx := context.Background()

	owner := newTestUser(t, userRepo)
	pet := &domain.Pet{ID: uuid.New(), OwnerID: owner.ID, Name: "PetByID", Type: "gato", Status: "found"}
	if err := petRepo.Create(pet); err != nil {
		t.Fatalf("Create pet: %v", err)
	}

	story := &domain.SuccessStory{ID: uuid.New(), PetID: pet.ID, UserID: owner.ID, Body: "Great story"}
	if err := storyRepo.Create(ctx, story); err != nil {
		t.Fatalf("Create story: %v", err)
	}

	got, err := storyRepo.GetByPetID(ctx, pet.ID)
	if err != nil {
		t.Fatalf("GetByPetID: %v", err)
	}
	if got == nil {
		t.Fatal("want story, got nil")
	}
	if got.ID != story.ID {
		t.Errorf("want story ID %s, got %s", story.ID, got.ID)
	}
}

func TestSuccessStoryRepository_Like(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	petRepo := repository.NewPetRepository(gormDB)
	storyRepo := repository.NewSuccessStoryRepository(gormDB)
	ctx := context.Background()

	owner := newTestUser(t, userRepo)
	pet := &domain.Pet{ID: uuid.New(), OwnerID: owner.ID, Name: "Like Pet", Type: "perro", Status: "found"}
	if err := petRepo.Create(pet); err != nil {
		t.Fatalf("Create pet: %v", err)
	}
	story := &domain.SuccessStory{ID: uuid.New(), PetID: pet.ID, UserID: owner.ID, Body: "Like test"}
	if err := storyRepo.Create(ctx, story); err != nil {
		t.Fatalf("Create story: %v", err)
	}

	for i := 0; i < 3; i++ {
		if err := storyRepo.IncrementLikes(ctx, story.ID); err != nil {
			t.Fatalf("IncrementLikes (%d): %v", i+1, err)
		}
	}

	got, err := storyRepo.GetByID(ctx, story.ID)
	if err != nil {
		t.Fatalf("GetByID after likes: %v", err)
	}
	if got.LikeCount != 3 {
		t.Errorf("want LikeCount=3, got %d", got.LikeCount)
	}
}

func TestSuccessStoryRepository_Delete(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	petRepo := repository.NewPetRepository(gormDB)
	storyRepo := repository.NewSuccessStoryRepository(gormDB)
	ctx := context.Background()

	owner := newTestUser(t, userRepo)
	pet := &domain.Pet{ID: uuid.New(), OwnerID: owner.ID, Name: "Del Story Pet", Type: "perro", Status: "found"}
	if err := petRepo.Create(pet); err != nil {
		t.Fatalf("Create pet: %v", err)
	}
	story := &domain.SuccessStory{ID: uuid.New(), PetID: pet.ID, UserID: owner.ID, Body: "Delete me"}
	if err := storyRepo.Create(ctx, story); err != nil {
		t.Fatalf("Create story: %v", err)
	}

	if err := storyRepo.Delete(ctx, story.ID); err != nil {
		t.Fatalf("Delete: %v", err)
	}

	_, err := storyRepo.GetByID(ctx, story.ID)
	if !errors.Is(err, domain.ErrStoryNotFound) {
		t.Errorf("want ErrStoryNotFound after delete, got %v", err)
	}
}

func TestSuccessStoryRepository_SetFeatured(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	petRepo := repository.NewPetRepository(gormDB)
	storyRepo := repository.NewSuccessStoryRepository(gormDB)
	ctx := context.Background()

	owner := newTestUser(t, userRepo)
	pet := &domain.Pet{ID: uuid.New(), OwnerID: owner.ID, Name: "Featured Pet", Type: "perro", Status: "found"}
	if err := petRepo.Create(pet); err != nil {
		t.Fatalf("Create pet: %v", err)
	}
	story := &domain.SuccessStory{ID: uuid.New(), PetID: pet.ID, UserID: owner.ID, Body: "Featured story"}
	if err := storyRepo.Create(ctx, story); err != nil {
		t.Fatalf("Create story: %v", err)
	}

	adminID := uuid.New()
	if err := storyRepo.SetFeatured(ctx, story.ID, true, adminID); err != nil {
		t.Fatalf("SetFeatured(true): %v", err)
	}

	got, err := storyRepo.GetByID(ctx, story.ID)
	if err != nil {
		t.Fatalf("GetByID after SetFeatured: %v", err)
	}
	if !got.Featured {
		t.Error("want Featured=true after SetFeatured(true)")
	}
	if got.FeaturedBy == nil || *got.FeaturedBy != adminID {
		t.Errorf("want FeaturedBy=%s, got %v", adminID, got.FeaturedBy)
	}

	// Unfeature
	if err := storyRepo.SetFeatured(ctx, story.ID, false, adminID); err != nil {
		t.Fatalf("SetFeatured(false): %v", err)
	}

	got2, err := storyRepo.GetByID(ctx, story.ID)
	if err != nil {
		t.Fatalf("GetByID after unfeature: %v", err)
	}
	if got2.Featured {
		t.Error("want Featured=false after SetFeatured(false)")
	}
}
