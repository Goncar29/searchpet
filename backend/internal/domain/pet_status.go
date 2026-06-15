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

// FeedVisibleStatuses are the statuses returned in the public feed by default
// (when no explicit status filter is provided). Only lost and stray pets —
// active searches — show up by default.
var FeedVisibleStatuses = []string{PetStatusLost, PetStatusStray}

// PublicSearchableStatuses is the allowlist of statuses an unauthenticated
// visitor may request explicitly on the public search endpoint. found is
// included so people tracking a pet learn it was recovered. registered and
// archived are private/closed and must NEVER be enumerable via ?status=,
// otherwise anyone could list every user's private pets.
var PublicSearchableStatuses = map[string]bool{
	PetStatusLost:  true,
	PetStatusStray: true,
	PetStatusFound: true,
}
