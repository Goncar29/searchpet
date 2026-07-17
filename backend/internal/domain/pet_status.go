package domain

// Pet status constants — the only valid values for Pet.Status.
// "active" is NOT a valid status; it is a legacy value replaced by "registered".
const (
	PetStatusRegistered = "registered"
	PetStatusLost       = "lost"
	PetStatusStray      = "stray"
	PetStatusFound      = "found"
	PetStatusArchived   = "archived"
	PetStatusAdoption   = "adoption"
	PetStatusAdopted    = "adopted"
)

// ValidPetStatuses is the authoritative set of allowed status values.
// Use this for input validation before calling service methods.
var ValidPetStatuses = map[string]bool{
	PetStatusRegistered: true,
	PetStatusLost:       true,
	PetStatusStray:      true,
	PetStatusFound:      true,
	PetStatusArchived:   true,
	PetStatusAdoption:   true,
	PetStatusAdopted:    true,
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

// MapVisibleStatuses are the pet statuses whose reports show on the nearby/map
// feed (FindNearby). It includes found — a fresh "found here" marker tells the
// people who were tracking the pet that it was recovered — but excludes
// registered/archived so stale reports of re-privatized or closed cases don't
// leak. Kept distinct from FeedVisibleStatuses on purpose: the map and the
// default pet-browse feed are different surfaces and may diverge.
var MapVisibleStatuses = []string{PetStatusLost, PetStatusStray, PetStatusFound}

// AdoptionVisibleStatuses is the allowlist for the public "Adoptar" section.
// Only pets *available* for adoption are public; adopted pets are visible only
// to their owner (their profile tab). Deliberately kept OUT of
// FeedVisibleStatuses / MapVisibleStatuses / PublicSearchableStatuses so
// adoption never leaks into the lost-pet feed, map, or public search.
var AdoptionVisibleStatuses = []string{PetStatusAdoption}
