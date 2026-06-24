package tests

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
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
	pet := &domain.Pet{ID: uuid.New(), OwnerID: ptrUUID(owner.ID), Name: "Story Pet", Type: "perro", Status: domain.PetStatusFound}
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
	p1 := &domain.Pet{ID: uuid.New(), OwnerID: ptrUUID(owner.ID), Name: "Pet1", Type: "perro", Status: domain.PetStatusFound}
	p2 := &domain.Pet{ID: uuid.New(), OwnerID: ptrUUID(owner.ID), Name: "Pet2", Type: "gato", Status: domain.PetStatusFound}
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
	pet := &domain.Pet{ID: uuid.New(), OwnerID: ptrUUID(owner.ID), Name: "PetByID", Type: "gato", Status: domain.PetStatusFound}
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

// newTestStoryForLikes creates an owner, a found pet, and a success story
// with like_count=0, returning the story and the owner user.
func newTestStoryForLikes(t *testing.T, gormDB *gorm.DB, label string) (*domain.SuccessStory, *domain.User) {
	t.Helper()
	userRepo := repository.NewUserRepository(gormDB)
	petRepo := repository.NewPetRepository(gormDB)
	storyRepo := repository.NewSuccessStoryRepository(gormDB)
	ctx := context.Background()

	owner := newTestUser(t, userRepo)
	pet := &domain.Pet{ID: uuid.New(), OwnerID: ptrUUID(owner.ID), Name: label, Type: "perro", Status: domain.PetStatusFound}
	if err := petRepo.Create(pet); err != nil {
		t.Fatalf("Create pet: %v", err)
	}
	story := &domain.SuccessStory{ID: uuid.New(), PetID: pet.ID, UserID: owner.ID, Body: label}
	if err := storyRepo.Create(ctx, story); err != nil {
		t.Fatalf("Create story: %v", err)
	}
	return story, owner
}

func TestSuccessStoryRepository_AddLike_TwiceSameUser_OneRowAndCountOne(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	storyRepo := repository.NewSuccessStoryRepository(gormDB)
	ctx := context.Background()

	story, owner := newTestStoryForLikes(t, gormDB, "AddLike twice")

	added1, count1, err := storyRepo.AddLike(ctx, story.ID, owner.ID)
	if err != nil {
		t.Fatalf("AddLike (1st): %v", err)
	}
	if !added1 {
		t.Error("want added=true on first like")
	}
	if count1 != 1 {
		t.Errorf("want like_count=1 after first like, got %d", count1)
	}

	added2, count2, err := storyRepo.AddLike(ctx, story.ID, owner.ID)
	if err != nil {
		t.Fatalf("AddLike (2nd): %v", err)
	}
	if added2 {
		t.Error("want added=false on duplicate like (idempotent no-op)")
	}
	if count2 != 1 {
		t.Errorf("want like_count to stay 1 after duplicate like, got %d", count2)
	}

	got, err := storyRepo.GetByID(ctx, story.ID)
	if err != nil {
		t.Fatalf("GetByID: %v", err)
	}
	if got.LikeCount != 1 {
		t.Errorf("want persisted like_count=1, got %d", got.LikeCount)
	}
}

func TestSuccessStoryRepository_AddLike_TwoDifferentUsers_CountTwo(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	storyRepo := repository.NewSuccessStoryRepository(gormDB)
	ctx := context.Background()

	story, owner := newTestStoryForLikes(t, gormDB, "AddLike two users")
	other := newTestUser(t, userRepo)

	if _, _, err := storyRepo.AddLike(ctx, story.ID, owner.ID); err != nil {
		t.Fatalf("AddLike (owner): %v", err)
	}
	added, count, err := storyRepo.AddLike(ctx, story.ID, other.ID)
	if err != nil {
		t.Fatalf("AddLike (other): %v", err)
	}
	if !added {
		t.Error("want added=true for a different user's first like")
	}
	if count != 2 {
		t.Errorf("want like_count=2 after two distinct likes, got %d", count)
	}
}

func TestSuccessStoryRepository_RemoveLike_ForLiker_RowGoneAndCountDecremented(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	storyRepo := repository.NewSuccessStoryRepository(gormDB)
	ctx := context.Background()

	story, owner := newTestStoryForLikes(t, gormDB, "RemoveLike for liker")

	if _, _, err := storyRepo.AddLike(ctx, story.ID, owner.ID); err != nil {
		t.Fatalf("AddLike: %v", err)
	}

	removed, count, err := storyRepo.RemoveLike(ctx, story.ID, owner.ID)
	if err != nil {
		t.Fatalf("RemoveLike: %v", err)
	}
	if !removed {
		t.Error("want removed=true when the user had liked the story")
	}
	if count != 0 {
		t.Errorf("want like_count=0 after removing the only like, got %d", count)
	}

	likedSet, err := storyRepo.LikedStoryIDs(ctx, owner.ID, []uuid.UUID{story.ID})
	if err != nil {
		t.Fatalf("LikedStoryIDs: %v", err)
	}
	if likedSet[story.ID] {
		t.Error("want story not in liked set after RemoveLike")
	}
}

func TestSuccessStoryRepository_RemoveLike_WhenNotLiked_NoOp(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	storyRepo := repository.NewSuccessStoryRepository(gormDB)
	ctx := context.Background()

	story, owner := newTestStoryForLikes(t, gormDB, "RemoveLike not liked")

	removed, count, err := storyRepo.RemoveLike(ctx, story.ID, owner.ID)
	if err != nil {
		t.Fatalf("RemoveLike: %v", err)
	}
	if removed {
		t.Error("want removed=false when the user never liked the story")
	}
	if count != 0 {
		t.Errorf("want like_count to stay 0, got %d", count)
	}
}

func TestSuccessStoryRepository_RemoveLike_NeverGoesNegative(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	storyRepo := repository.NewSuccessStoryRepository(gormDB)
	ctx := context.Background()

	story, owner := newTestStoryForLikes(t, gormDB, "RemoveLike never negative")

	// Repeated RemoveLike on a story that was never liked must keep the
	// counter at 0 (recompute = COUNT(*) = 0), never going negative.
	for i := 0; i < 2; i++ {
		_, count, err := storyRepo.RemoveLike(ctx, story.ID, owner.ID)
		if err != nil {
			t.Fatalf("RemoveLike (%d): %v", i+1, err)
		}
		if count != 0 {
			t.Errorf("want like_count=0 on RemoveLike #%d, got %d", i+1, count)
		}
	}
}

func TestSuccessStoryRepository_AddLike_MissingStory_ErrStoryNotFound(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	storyRepo := repository.NewSuccessStoryRepository(gormDB)
	ctx := context.Background()

	user := newTestUser(t, userRepo)

	added, count, err := storyRepo.AddLike(ctx, uuid.New(), user.ID)
	if !errors.Is(err, domain.ErrStoryNotFound) {
		t.Errorf("want ErrStoryNotFound, got %v", err)
	}
	if added || count != 0 {
		t.Errorf("want added=false, count=0 on missing story, got added=%v count=%d", added, count)
	}
}

func TestSuccessStoryRepository_RemoveLike_SoftDeletedStory_ErrStoryNotFound(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	storyRepo := repository.NewSuccessStoryRepository(gormDB)
	ctx := context.Background()

	story, owner := newTestStoryForLikes(t, gormDB, "RemoveLike soft-deleted")

	if err := storyRepo.Delete(ctx, story.ID); err != nil {
		t.Fatalf("Delete: %v", err)
	}

	removed, count, err := storyRepo.RemoveLike(ctx, story.ID, owner.ID)
	if !errors.Is(err, domain.ErrStoryNotFound) {
		t.Errorf("want ErrStoryNotFound for soft-deleted story, got %v", err)
	}
	if removed || count != 0 {
		t.Errorf("want removed=false, count=0 on soft-deleted story, got removed=%v count=%d", removed, count)
	}
}

func TestSuccessStoryRepository_AddLike_SoftDeletedStory_ErrStoryNotFound(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	storyRepo := repository.NewSuccessStoryRepository(gormDB)
	ctx := context.Background()

	story, owner := newTestStoryForLikes(t, gormDB, "AddLike soft-deleted")

	if err := storyRepo.Delete(ctx, story.ID); err != nil {
		t.Fatalf("Delete: %v", err)
	}

	added, count, err := storyRepo.AddLike(ctx, story.ID, owner.ID)
	if !errors.Is(err, domain.ErrStoryNotFound) {
		t.Errorf("want ErrStoryNotFound for soft-deleted story, got %v", err)
	}
	if added || count != 0 {
		t.Errorf("want added=false, count=0 on soft-deleted story, got added=%v count=%d", added, count)
	}
}

func TestSuccessStoryRepository_LikedStoryIDs_OnlyLikedByUser(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	storyRepo := repository.NewSuccessStoryRepository(gormDB)
	ctx := context.Background()

	story1, owner := newTestStoryForLikes(t, gormDB, "LikedStoryIDs story1")
	story2, _ := newTestStoryForLikes(t, gormDB, "LikedStoryIDs story2")

	if _, _, err := storyRepo.AddLike(ctx, story1.ID, owner.ID); err != nil {
		t.Fatalf("AddLike: %v", err)
	}

	likedSet, err := storyRepo.LikedStoryIDs(ctx, owner.ID, []uuid.UUID{story1.ID, story2.ID})
	if err != nil {
		t.Fatalf("LikedStoryIDs: %v", err)
	}
	if !likedSet[story1.ID] {
		t.Error("want story1 in liked set")
	}
	if likedSet[story2.ID] {
		t.Error("want story2 NOT in liked set")
	}
}

func TestSuccessStoryRepository_LikedStoryIDs_EmptyInput(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	storyRepo := repository.NewSuccessStoryRepository(gormDB)
	ctx := context.Background()

	user := newTestUser(t, userRepo)

	likedSet, err := storyRepo.LikedStoryIDs(ctx, user.ID, []uuid.UUID{})
	if err != nil {
		t.Fatalf("LikedStoryIDs: %v", err)
	}
	if len(likedSet) != 0 {
		t.Errorf("want empty map for empty input, got %+v", likedSet)
	}
}

func TestSuccessStoryRepository_Delete(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	petRepo := repository.NewPetRepository(gormDB)
	storyRepo := repository.NewSuccessStoryRepository(gormDB)
	ctx := context.Background()

	owner := newTestUser(t, userRepo)
	pet := &domain.Pet{ID: uuid.New(), OwnerID: ptrUUID(owner.ID), Name: "Del Story Pet", Type: "perro", Status: domain.PetStatusFound}
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
	pet := &domain.Pet{ID: uuid.New(), OwnerID: ptrUUID(owner.ID), Name: "Featured Pet", Type: "perro", Status: domain.PetStatusFound}
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

func TestSuccessStoryRepository_GetByID_PreloadsPhotosOrdered(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	petRepo := repository.NewPetRepository(gormDB)
	photoRepo := repository.NewPhotoRepository(gormDB)
	storyRepo := repository.NewSuccessStoryRepository(gormDB)
	ctx := context.Background()

	owner := newTestUser(t, userRepo)
	pet := &domain.Pet{ID: uuid.New(), OwnerID: ptrUUID(owner.ID), Name: "PhotoPet", Type: "perro", Status: domain.PetStatusFound}
	if err := petRepo.Create(pet); err != nil {
		t.Fatalf("Create pet: %v", err)
	}

	// Earliest photo is NOT primary; latest IS primary — proves we pick by
	// created_at order, ignoring the is_primary flag.
	base := time.Now().Add(-2 * time.Hour)
	early := &domain.Photo{ID: uuid.New(), PetID: pet.ID, URL: "https://cdn/early.jpg", UploadedBy: owner.ID, IsPrimary: false, CreatedAt: base}
	late := &domain.Photo{ID: uuid.New(), PetID: pet.ID, URL: "https://cdn/late.jpg", UploadedBy: owner.ID, IsPrimary: true, CreatedAt: base.Add(time.Hour)}
	for _, p := range []*domain.Photo{late, early} { // insert out of order on purpose
		if err := photoRepo.Create(p); err != nil {
			t.Fatalf("Create photo: %v", err)
		}
	}

	story := &domain.SuccessStory{ID: uuid.New(), PetID: pet.ID, UserID: owner.ID, Body: "Reunited"}
	if err := storyRepo.Create(ctx, story); err != nil {
		t.Fatalf("Create story: %v", err)
	}

	got, err := storyRepo.GetByID(ctx, story.ID)
	if err != nil {
		t.Fatalf("GetByID: %v", err)
	}
	if len(got.Pet.Photos) == 0 {
		t.Fatal("want pet photos preloaded, got none")
	}
	if got.Pet.Photos[0].URL != "https://cdn/early.jpg" {
		t.Errorf("want first photo early.jpg (canonical order), got %q", got.Pet.Photos[0].URL)
	}
}
