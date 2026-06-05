package dto

// ImageSearchResultDTO representa un resultado individual de búsqueda por imagen.
type ImageSearchResultDTO struct {
	PetID      string  `json:"pet_id"`
	Name       string  `json:"name"`
	Type       string  `json:"type"`
	PhotoURL   string  `json:"photo_url"`
	Similarity float64 `json:"similarity"`
	OwnerID    string  `json:"owner_id"`
}

// ImageSearchResponse es el body de respuesta de POST /api/pets/search/image.
type ImageSearchResponse struct {
	Results []ImageSearchResultDTO `json:"results"`
}
