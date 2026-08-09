package domain

// Géneros válidos de una mascota. El vacío también es válido y significa "no
// especificado" — el campo es opcional en el alta y en la edición.
//
// La allowlist existe porque `pets.gender` es un VARCHAR(10): sin ella, un
// valor más largo llega hasta Postgres, revienta con SQLSTATE 22001 y el
// usuario recibe un 500 por un dato que el servidor tendría que haber
// rechazado con un 400. Es el mismo criterio que ValidPetStatuses.
const (
	PetGenderMale    = "male"
	PetGenderFemale  = "female"
	PetGenderUnknown = "unknown"
)

var ValidPetGenders = map[string]bool{
	PetGenderMale:    true,
	PetGenderFemale:  true,
	PetGenderUnknown: true,
}

// IsValidPetGender acepta el vacío (no especificado) además de la allowlist.
func IsValidPetGender(gender string) bool {
	return gender == "" || ValidPetGenders[gender]
}
