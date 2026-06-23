package main

import (
	"testing"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
)

func TestSeedUsers_adminAndVariety(t *testing.T) {
	users := SeedUsers()

	if len(users) < 4 {
		t.Fatalf("expected at least 4 users, got %d", len(users))
	}

	var admin *SeedUser
	verified, unverified := 0, 0
	for i := range users {
		u := &users[i]
		if u.User.ID == adminID {
			admin = u
		}
		if u.User.IsVerified {
			verified++
		} else {
			unverified++
		}
		if u.Password == "" {
			t.Errorf("user %s has empty password", u.User.Email)
		}
	}
	if admin == nil || !admin.User.IsAdmin {
		t.Fatal("expected an admin user with IsAdmin=true")
	}
	if verified == 0 || unverified == 0 {
		t.Errorf("expected both verified and unverified users, got v=%d u=%d", verified, unverified)
	}
}

func TestSeedPets_coversAllStatusesAndEdges(t *testing.T) {
	pets := SeedPets()
	statuses := map[string]bool{}
	var hasNoDescription, hasNoPhoto, hasStrayOwnerless bool

	photos := SeedPhotos()
	petIDsWithPhoto := map[uuid.UUID]bool{}
	for _, p := range photos {
		petIDsWithPhoto[p.PetID] = true
	}

	for _, p := range pets {
		statuses[p.Status] = true
		if p.Description == "" {
			hasNoDescription = true
		}
		if !petIDsWithPhoto[p.ID] {
			hasNoPhoto = true
		}
		if p.Status == domain.PetStatusStray && p.OwnerID == nil && p.ReporterID != nil {
			hasStrayOwnerless = true
		}
	}
	for _, s := range []string{"registered", "lost", "stray", "found", "archived"} {
		if !statuses[s] {
			t.Errorf("missing pet with status %q", s)
		}
	}
	if !hasNoDescription || !hasNoPhoto || !hasStrayOwnerless {
		t.Errorf("edge coverage missing: noDesc=%v noPhoto=%v strayOwnerless=%v",
			hasNoDescription, hasNoPhoto, hasStrayOwnerless)
	}
}
