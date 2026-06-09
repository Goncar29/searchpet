package domain

// Pet status constants — the only valid values for Pet.Status.
// "active" is NOT a valid status; it is a legacy value replaced by "registered".
const (
	PetStatusRegistered = "registered"
	PetStatusLost       = "lost"
	PetStatusStray      = "stray"
	PetStatusFound      = "found"
	PetStatusArchived   = "archived"
)

// ValidPetStatuses is the authoritative set of allowed status values.
// Use this for input validation before calling service methods.
var ValidPetStatuses = map[string]bool{
	PetStatusRegistered: true,
	PetStatusLost:       true,
	PetStatusStray:      true,
	PetStatusFound:      true,
	PetStatusArchived:   true,
}

// FeedVisibleStatuses are the statuses returned in the public feed by default.
// Only lost and stray pets are publicly searchable.
var FeedVisibleStatuses = []string{PetStatusLost, PetStatusStray}
