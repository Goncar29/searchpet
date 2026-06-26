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

	// Every seeded like must point at a seeded story and a known user.
	storyIDs := map[uuid.UUID]bool{}
	for _, s := range c.Stories {
		storyIDs[s.ID] = true
	}
	for _, l := range c.Likes {
		if !storyIDs[l.StoryID] {
			t.Errorf("like %s references unknown story %s", l.ID, l.StoryID)
		}
		if l.UserID == uuid.Nil {
			t.Errorf("like %s has no user", l.ID)
		}
	}
}
