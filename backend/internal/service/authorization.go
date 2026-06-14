package service

import "lost-pets/internal/domain"

// canManagePet reports whether userID is authorized to manage pet.
//
// Owned pets are managed by their owner; stray pets (which have no owner —
// OwnerID is nil) are managed by the user who reported them (ReporterID).
// Nil-safe for both OwnerID and ReporterID: a pet with neither set is
// manageable by nobody.
//
// This is the single source of truth for owner/reporter authorization across
// the pet, photo and share services. PublishLost intentionally does NOT use it
// (marking a pet "lost" only applies to owned pets).
func canManagePet(pet *domain.Pet, userID string) bool {
	switch {
	case pet.OwnerID != nil:
		return pet.OwnerID.String() == userID
	case pet.ReporterID != nil:
		return pet.ReporterID.String() == userID
	default:
		return false
	}
}
