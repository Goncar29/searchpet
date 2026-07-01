package domain

// IsActiveSearchStatus reports whether a status represents an OPEN search —
// the states during which a search episode is active. Transitioning INTO one
// of these (from a non-active state) opens an episode; transitioning OUT of
// one closes it.
func IsActiveSearchStatus(status string) bool {
	return status == PetStatusLost || status == PetStatusStray
}
