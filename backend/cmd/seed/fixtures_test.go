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

func TestSeedFosterHomes_varietyDistinctOwnersAndValid(t *testing.T) {
	homes := SeedFosterHomes()
	if len(homes) < 6 {
		t.Fatalf("expected >=6 foster homes, got %d", len(homes))
	}

	knownUsers := map[uuid.UUID]bool{}
	for _, su := range SeedUsers() {
		knownUsers[su.User.ID] = true
	}

	owners := map[uuid.UUID]bool{}
	statuses := map[string]bool{}
	animals := map[string]bool{}
	for _, h := range homes {
		// OwnerUserID is uniquely indexed — each home needs a distinct, real owner.
		if owners[h.OwnerUserID] {
			t.Errorf("duplicate foster-home owner %s (violates unique index)", h.OwnerUserID)
		}
		owners[h.OwnerUserID] = true
		if !knownUsers[h.OwnerUserID] {
			t.Errorf("foster home %s owner %s not created by SeedUsers (FK violation)", h.ID, h.OwnerUserID)
		}
		statuses[h.Status] = true
		for _, a := range h.AnimalTypes {
			animals[a] = true
		}
		if h.City == "" || h.HousingType == "" || h.Description == "" {
			t.Errorf("foster home %s has an empty required field", h.ID)
		}
		if h.Capacity < 1 {
			t.Errorf("foster home %s has capacity < 1", h.ID)
		}
		if len(h.AnimalTypes) == 0 {
			t.Errorf("foster home %s has no animal types", h.ID)
		}
		// Must stay within the length limit enforced by the DTO validator.
		if len([]rune(h.Description)) > 500 {
			t.Errorf("foster home %s description exceeds 500 chars", h.ID)
		}
	}

	if !statuses[domain.FosterHomeStatusApproved] || !statuses[domain.FosterHomeStatusPending] {
		t.Errorf("expected both approved and pending homes (for directory + admin queue), got %v", statuses)
	}
	for _, a := range []string{"dog", "cat", "other"} {
		if !animals[a] {
			t.Errorf("expected animal type %q across seeded homes", a)
		}
	}

	// Every seeded photo must reference a seeded home.
	homeIDs := map[uuid.UUID]bool{}
	for _, h := range homes {
		homeIDs[h.ID] = true
	}
	for _, p := range SeedFosterHomePhotos() {
		if !homeIDs[p.FosterHomeID] {
			t.Errorf("foster photo %s references unknown home %s", p.ID, p.FosterHomeID)
		}
	}
}

func TestSeedReports_coordsAndDescriptionMix(t *testing.T) {
	reports := SeedReports()
	if len(reports) < 3 {
		t.Fatalf("expected >=3 reports, got %d", len(reports))
	}
	var withDesc, withoutDesc bool
	for _, r := range reports {
		if r.Latitude == 0 || r.Longitude == 0 {
			t.Errorf("report %s has zero coordinates", r.ID)
		}
		if r.LocationDescription == "" {
			withoutDesc = true
		} else {
			withDesc = true
		}
	}
	if !withDesc || !withoutDesc {
		t.Errorf("expected reports with and without description (with=%v without=%v)", withDesc, withoutDesc)
	}
}

func TestSeedCommunity_allKindsPresent(t *testing.T) {
	c := SeedCommunity()
	if len(c.Blocks) == 0 || len(c.Abuse) == 0 || len(c.Groups) == 0 ||
		len(c.Members) == 0 || len(c.Stories) == 0 || len(c.Points) == 0 || len(c.Badges) == 0 {
		t.Fatalf("community fixtures incomplete: %+v counts", c)
	}
	// The blocked pair must reference the two known users.
	if c.Blocks[0].BlockerID != userAID || c.Blocks[0].BlockedID != userBID {
		t.Errorf("expected block A->B, got %v->%v", c.Blocks[0].BlockerID, c.Blocks[0].BlockedID)
	}
}

// TestSeedCommunity_storyLikeCountMatchesSeededLikes guards the invariant that a
// story's LikeCount equals the number of StoryLike rows the seed creates for it.
// A mismatch (a magic LikeCount with no backing rows) reproduces the bug where a
// seeded story showed 3 likes but dropped to 1 on the first real like, because
// the Like endpoint recounts real rows (see migration 000011).
func TestSeedCommunity_storyLikeCountMatchesSeededLikes(t *testing.T) {
	c := SeedCommunity()

	likesByStory := map[uuid.UUID]int{}
	for _, l := range c.Likes {
		likesByStory[l.StoryID]++
	}

	for _, s := range c.Stories {
		if s.LikeCount != likesByStory[s.ID] {
			t.Errorf("story %s has LikeCount=%d but %d StoryLike rows seeded — breaks the like_count==rows invariant",
				s.ID, s.LikeCount, likesByStory[s.ID])
		}
	}

	// Every seeded like must point at a seeded story and a user that SeedUsers
	// actually creates — otherwise the seed would fail with an FK violation at
	// runtime even though the fixture looks valid.
	storyIDs := map[uuid.UUID]bool{}
	for _, s := range c.Stories {
		storyIDs[s.ID] = true
	}
	knownUsers := map[uuid.UUID]bool{}
	for _, su := range SeedUsers() {
		knownUsers[su.User.ID] = true
	}
	for _, l := range c.Likes {
		if !storyIDs[l.StoryID] {
			t.Errorf("like %s references unknown story %s", l.ID, l.StoryID)
		}
		if !knownUsers[l.UserID] {
			t.Errorf("like %s references unknown user %s", l.ID, l.UserID)
		}
	}
}
