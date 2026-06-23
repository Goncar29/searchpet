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
