package main

import "testing"

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
