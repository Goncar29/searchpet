package main

import (
	"github.com/google/uuid"
	"lost-pets/internal/domain"
)

var (
	adminID = uuid.MustParse("00000000-0000-0000-0000-000000000001")
	userAID = uuid.MustParse("00000000-0000-0000-0000-000000000002")
	userBID = uuid.MustParse("00000000-0000-0000-0000-000000000003")
	userCID = uuid.MustParse("00000000-0000-0000-0000-000000000004")

	montevideoLat = -34.9011 //nolint:unused
	montevideoLng = -56.1645 //nolint:unused
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
