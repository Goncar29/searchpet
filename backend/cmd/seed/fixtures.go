package main

import (
	"time"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
)

var (
	adminID = uuid.MustParse("00000000-0000-0000-0000-000000000001")
	userAID = uuid.MustParse("00000000-0000-0000-0000-000000000002")
	userBID = uuid.MustParse("00000000-0000-0000-0000-000000000003")
	userCID = uuid.MustParse("00000000-0000-0000-0000-000000000004")

	montevideoLat = -34.9011
	montevideoLng = -56.1645
)

// SeedUser carries a plaintext password; seed.go hashes it at insert time.
type SeedUser struct {
	User     domain.User
	Password string
}

var (
	petLost1ID  = uuid.MustParse("00000000-0000-0000-0000-0000000000a1") // lost, with photo (image-search)
	petLost2ID  = uuid.MustParse("00000000-0000-0000-0000-0000000000a2") // lost, NO description, NO photo
	petStray1ID = uuid.MustParse("00000000-0000-0000-0000-0000000000a3") // stray, ownerless, with photo (image-search)
	petFoundID  = uuid.MustParse("00000000-0000-0000-0000-0000000000a4") // found
	petRegID    = uuid.MustParse("00000000-0000-0000-0000-0000000000a5") // registered
	petArchID   = uuid.MustParse("00000000-0000-0000-0000-0000000000a6") // archived

	photoLost1ID  = uuid.MustParse("00000000-0000-0000-0000-0000000000b1")
	photoStray1ID = uuid.MustParse("00000000-0000-0000-0000-0000000000b2")

	// Stable public images (Wikimedia Commons). Used for image-search embeddings;
	// download these exact URLs to run the self-match test.
	dogPhotoURL = "https://upload.wikimedia.org/wikipedia/commons/d/d9/Collage_of_Nine_Dogs.jpg"
	catPhotoURL = "https://upload.wikimedia.org/wikipedia/commons/1/15/Cat_August_2010-4.jpg"
)

func ptrUUID(id uuid.UUID) *uuid.UUID { return &id }

// SeedPets returns one pet per status plus edge-case variants (no description,
// stray without owner, no photo) to exercise all code paths in tests and seed.
func SeedPets() []domain.Pet {
	return []domain.Pet{
		{ID: petLost1ID, OwnerID: ptrUUID(userAID), Name: "Firulais", Type: "perro",
			Breed: "Labrador", Color: "Negro", Description: "Collar rojo, muy amigable.",
			Status: domain.PetStatusLost},
		{ID: petLost2ID, OwnerID: ptrUUID(userBID), Name: "Michi", Type: "gato",
			Status: domain.PetStatusLost}, // no description, no photo
		{ID: petStray1ID, ReporterID: ptrUUID(userAID), Name: "Callejero Parque", Type: "perro",
			Color: "Marrón", Description: "Visto cerca del parque.",
			Status: domain.PetStatusStray, ReporterContactPublic: true},
		{ID: petFoundID, OwnerID: ptrUUID(userBID), Name: "Rex", Type: "perro",
			Breed: "Pastor", Status: domain.PetStatusFound},
		{ID: petRegID, OwnerID: ptrUUID(userAID), Name: "Luna", Type: "gato",
			Color: "Blanco", Status: domain.PetStatusRegistered},
		{ID: petArchID, OwnerID: ptrUUID(userCID), Name: "Toby", Type: "perro",
			Status: domain.PetStatusArchived},
	}
}

// SeedPhotos returns primary photos for the two image-search-targeted pets
// (lost Firulais and stray Callejero). petLost2ID intentionally has no photo
// to cover the no-photo edge case.
func SeedPhotos() []domain.Photo {
	return []domain.Photo{
		{ID: photoLost1ID, PetID: petLost1ID, URL: dogPhotoURL, UploadedBy: userAID, IsPrimary: true},
		{ID: photoStray1ID, PetID: petStray1ID, URL: catPhotoURL, UploadedBy: userAID, IsPrimary: true},
	}
}

func offset(base, d float64) float64 { return base + d }

// SeedReports returns a set of reports with varied PostGIS coordinates and
// occurrence dates. Includes both reports with and without LocationDescription
// to exercise optional-field code paths.
func SeedReports() []domain.Report {
	now := time.Now()
	older := now.Add(-72 * time.Hour)
	return []domain.Report{
		{ID: uuid.MustParse("00000000-0000-0000-0000-0000000000c1"),
			PetID: petLost1ID, ReporterID: userAID, Status: "lost",
			Latitude: offset(montevideoLat, 0.004), Longitude: offset(montevideoLng, 0.004),
			LocationDescription: "Última vez en Pocitos.", OccurredAt: &older},
		{ID: uuid.MustParse("00000000-0000-0000-0000-0000000000c2"),
			PetID: petLost1ID, ReporterID: userBID, Status: "sighting",
			Latitude: offset(montevideoLat, -0.006), Longitude: offset(montevideoLng, 0.002),
			OccurredAt: &now}, // no description
		{ID: uuid.MustParse("00000000-0000-0000-0000-0000000000c3"),
			PetID: petStray1ID, ReporterID: userAID, Status: "lost",
			Latitude: offset(montevideoLat, 0.001), Longitude: offset(montevideoLng, -0.003),
			LocationDescription: "Cerca del Parque Rodó."},
	}
}

// CommunityData groups the community-layer fixtures: blocks, abuse reports,
// local groups, group memberships, success stories, points, and badges.
type CommunityData struct {
	Blocks  []domain.BlockedUser
	Abuse   []domain.ReportAbuse
	Groups  []domain.LocalGroup
	Members []domain.GroupMember
	Stories []domain.SuccessStory
	Likes   []domain.StoryLike
	Points  []domain.UserPoints
	Badges  []domain.Badge
}

// SeedCommunity returns one representative fixture per community entity type.
func SeedCommunity() CommunityData {
	groupID := uuid.MustParse("00000000-0000-0000-0000-0000000000d1")
	storyID := uuid.MustParse("00000000-0000-0000-0000-0000000000e4")
	return CommunityData{
		Blocks: []domain.BlockedUser{
			{ID: uuid.MustParse("00000000-0000-0000-0000-0000000000e1"),
				BlockerID: userAID, BlockedID: userBID, Reason: "spam"},
		},
		Abuse: []domain.ReportAbuse{
			{ID: uuid.MustParse("00000000-0000-0000-0000-0000000000e2"),
				ReporterID: userBID, TargetUserID: ptrUUID(userCID),
				Reason: "Perfil sospechoso", Status: "pending"},
		},
		Groups: []domain.LocalGroup{
			{ID: groupID, Name: "Rescatistas Montevideo", City: "Montevideo",
				Description: "Grupo de prueba", CreatedBy: adminID, MemberCount: 1},
		},
		Members: []domain.GroupMember{
			{ID: uuid.MustParse("00000000-0000-0000-0000-0000000000e3"),
				GroupID: groupID, UserID: userAID},
		},
		Stories: []domain.SuccessStory{
			{ID: storyID,
				PetID: petFoundID, UserID: userBID, Title: "¡Rex volvió a casa!",
				Body: "Gracias a la comunidad.", LikeCount: 2},
		},
		// Real likes backing LikeCount (invariant: like_count == row count, see
		// migration 000011). Liked by Ana and Caro; the author (Bruno) and the
		// admin are left out so they can exercise the like→increment path.
		Likes: []domain.StoryLike{
			{ID: uuid.MustParse("00000000-0000-0000-0000-0000000000e7"), StoryID: storyID, UserID: userAID},
			{ID: uuid.MustParse("00000000-0000-0000-0000-0000000000e8"), StoryID: storyID, UserID: userCID},
		},
		Points: []domain.UserPoints{
			{ID: uuid.MustParse("00000000-0000-0000-0000-0000000000e5"),
				UserID: userAID, Points: 120, TotalReports: 5, FoundCount: 1},
		},
		Badges: []domain.Badge{
			{ID: uuid.MustParse("00000000-0000-0000-0000-0000000000e6"),
				UserID: userAID, BadgeType: "first_helper"},
		},
	}
}

// SeedUsers returns the fixed set of users: an admin, two verified normals
// (a blocked pair), and one unverified user.
func SeedUsers() []SeedUser {
	return []SeedUser{
		{
			User: domain.User{
				ID: adminID, Email: "admin@searchpet.local", Name: "Admin Local",
				IsAdmin: true, IsVerified: true, EmailVerified: true, City: "Montevideo",
			},
			Password: "admin1234",
		},
		{
			User: domain.User{
				ID: userAID, Email: "ana@searchpet.local", Name: "Ana", Phone: "+59899111111",
				IsVerified: true, EmailVerified: true, City: "Montevideo",
			},
			Password: "user1234",
		},
		{
			User: domain.User{
				ID: userBID, Email: "bruno@searchpet.local", Name: "Bruno", Phone: "+59899222222",
				IsVerified: true, EmailVerified: true, City: "Montevideo",
			},
			Password: "user1234",
		},
		{
			User: domain.User{
				ID: userCID, Email: "caro@searchpet.local", Name: "Caro",
				IsVerified: false, City: "Salto",
			},
			Password: "user1234",
		},
	}
}
