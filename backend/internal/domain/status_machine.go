package domain

// AllowedTransitions defines the valid state machine edges for Pet.Status.
// Any transition not listed here is rejected with ErrInvalidStatusTransition.
var AllowedTransitions = map[string][]string{
	PetStatusRegistered: {PetStatusLost, PetStatusArchived},
	PetStatusLost:       {PetStatusRegistered, PetStatusFound, PetStatusArchived},
	PetStatusFound:      {PetStatusRegistered, PetStatusArchived},
	PetStatusArchived:   {PetStatusRegistered},
	PetStatusStray:      {PetStatusFound},
}

// ValidateTransition returns nil if the transition from → to is allowed,
// nil if from == to (no-op, idempotent), or ErrInvalidStatusTransition otherwise.
func ValidateTransition(from, to string) error {
	if from == to {
		return nil
	}
	for _, allowed := range AllowedTransitions[from] {
		if allowed == to {
			return nil
		}
	}
	return ErrInvalidStatusTransition
}
