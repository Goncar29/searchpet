package dto

import (
	"time"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
)

// CreatePetRequest contiene los datos para crear una mascota.
// Es el input que viene del Handler — ya parseado, listo para usar.
// Los `max` replican el ancho de las columnas de domain.Pet (Name size:100,
// Type size:50, Breed y Color size:100, City size:120). Description no lleva
// tope porque su columna es `text`, y Gender tampoco porque ya lo acota
// ValidPetGenders — que es más estricto que su varchar(10).
type CreatePetRequest struct {
	Name string `json:"name" binding:"required,max=100"`
	// El `max` evita el 500, pero NO es una allowlist: el alta sigue aceptando
	// cualquier tipo de hasta 50 runas. domain.IsValidPetType existe y hoy sólo
	// lo usa el filtro de búsqueda de report_handler.go.
	Type        string  `json:"type" binding:"required,max=50"`
	Breed       string  `json:"breed" binding:"max=100"`
	Color       string  `json:"color" binding:"max=100"`
	Description string  `json:"description"`
	City        string  `json:"city" binding:"max=120"`
	Gender      string  `json:"gender"`
	// Opcional y acotado a 50 RUNAS por la columna (ver domain.IsValidMicrochipID).
	// Un string vacío se guarda como NULL: la columna es uniqueIndex y los vacíos
	// sí colisionan entre sí, los NULL no. No hay campo espejo en
	// UpdatePetRequest — hoy el microchip sólo se puede cargar al crear.
	MicrochipID *string `json:"microchip_id"`
	// BirthDate viaja como día de calendario plano ("2006-01-02"), NO como
	// instante ISO: la columna es DATE y se queda sólo con el día, así que
	// mandar medianoche local corre la fecha un día entero según la zona. Ver
	// domain.BirthDateLayout, que documenta el caso completo. Va siempre con su
	// precisión y las dos se validan como una unidad.
	BirthDate          *string `json:"birth_date"`
	BirthDatePrecision string  `json:"birth_date_precision"`
	// Status is optional. Accepted values: "registered" (default), "stray", and
	// "adoption". Any other value is rejected by the service layer.
	Status string `json:"status"`
	// InitialReport is required when Status == "stray" (400 initial_report_required
	// otherwise) and forbidden for any non-stray status — "registered", "adoption",
	// or omitted (400 initial_report_not_allowed otherwise).
	InitialReport *InitialReportRequest `json:"initial_report"`
	// ReporterContactPublic is the stray opt-in: when true, the reporter agrees
	// to expose their profile phone publicly. Only honored for stray creations.
	ReporterContactPublic bool `json:"reporter_contact_public"`
}

// InitialReportRequest contains the location data for the initial report that
// must accompany a stray pet creation or a publish-lost transition.
type InitialReportRequest struct {
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
	Note      string  `json:"note"`
	// Cuándo ocurrió, opcional y nunca futura. Sin esto el reporte inicial sólo
	// puede decir DÓNDE, y la gente publica días después de lo que vio: la
	// fecha de creación no sirve como sustituto. POST /api/reports ya la pedía,
	// así que los dos caminos de reporte por fin dicen lo mismo.
	OccurredAt *time.Time `json:"occurred_at"`
}

// PublishLostRequest contains the location data for transitioning an owned,
// registered pet to "lost" with its initial location report — used by
// POST /api/pets/:id/publish-lost.
type PublishLostRequest struct {
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
	Note      string  `json:"note"`
	// Cuándo se perdió, opcional y nunca futura. Es el caso donde más pesa:
	// entre que la mascota se pierde y el dueño publica pueden pasar días, y
	// buscar sin saber desde cuándo cambia por completo el radio.
	OccurredAt *time.Time `json:"occurred_at"`
}

// UpdatePetRequest contiene los datos para actualizar una mascota.
type UpdatePetRequest struct {
	// Mismos anchos que en el alta: editar escribe en las mismas columnas, y
	// acotar sólo una de las dos vías deja la clase abierta en la otra.
	Name string `json:"name" binding:"max=100"`
	// Optional fields use pointers so the server can tell "field omitted" (nil →
	// leave as-is, e.g. a status-only update) apart from "field cleared" (&"" →
	// blank it). Without this, a user could never empty an optional field.
	//
	// El `max` sobre un puntero se aplica al valor apuntado y se saltea cuando
	// es nil, así que convive con el update parcial. Verificado con un caso de
	// PUT en el e2e, no asumido — un tag que no se aplicara sería una prop que
	// se ve correcta en el diff y no hace nada.
	Breed       *string `json:"breed" binding:"omitempty,max=100"`
	Color       *string `json:"color" binding:"omitempty,max=100"`
	Description *string `json:"description"`
	City        *string `json:"city" binding:"omitempty,max=120"`
	Gender      *string `json:"gender"`
	Status      string  `json:"status"`
	// Día de calendario plano, igual que en el alta. `nil` = no enviado.
	//
	// Un string vacío en CUALQUIERA de los dos borra el par, pero sólo pisa lo
	// que estaba GUARDADO: si el mismo request manda además el otro campo con un
	// valor, no se descarta en silencio — el par queda incoherente y el validador
	// responde 400. Se prefiere el error explícito a aceptar un request
	// contradictorio tirando la mitad de lo que el usuario mandó.
	BirthDate          *string `json:"birth_date"`
	BirthDatePrecision *string `json:"birth_date_precision"`
	// Version is used for optimistic concurrency. Send the value received from the
	// last GET response; the server rejects the update with 409 if it has changed.
	Version int `json:"version"`
}

// PetSearchResponse es la respuesta paginada del endpoint GET /api/pets/search.
type PetSearchResponse struct {
	Data  []PetResponse `json:"data"`
	Total int64         `json:"total"`
	Page  int           `json:"page"`
	Limit int           `json:"limit"`
}

// PetOwnerResponse son los datos del dueño que exponemos dentro de un Pet.
type PetOwnerResponse struct {
	ID         uuid.UUID `json:"id"`
	Name       string    `json:"name"`
	Phone      string    `json:"phone,omitempty"`
	IsVerified bool      `json:"is_verified"`
}

// PetReporterResponse son los datos del reporter de un stray que exponemos
// públicamente — solo cuando el reporter hizo opt-in (ReporterContactPublic).
type PetReporterResponse struct {
	ID         uuid.UUID `json:"id"`
	Name       string    `json:"name"`
	Phone      string    `json:"phone,omitempty"`
	IsVerified bool      `json:"is_verified"`
}

// PetPhotoResponse son los datos de una foto de mascota.
type PetPhotoResponse struct {
	ID        uuid.UUID `json:"id"`
	URL       string    `json:"url"`
	IsPrimary bool      `json:"is_primary"`
	CreatedAt time.Time `json:"created_at"`
}

// PetResponse son los datos de la mascota que retornamos al cliente.
type PetResponse struct {
	ID          uuid.UUID          `json:"id"`
	OwnerID     *uuid.UUID         `json:"owner_id,omitempty"`
	ReporterID  *uuid.UUID         `json:"reporter_id,omitempty"`
	Name        string             `json:"name"`
	Type        string             `json:"type"`
	Breed       string             `json:"breed,omitempty"`
	Color       string             `json:"color,omitempty"`
	Description string             `json:"description,omitempty"`
	City        string             `json:"city,omitempty"`
	Gender      string             `json:"gender,omitempty"`
	Status      string             `json:"status"`
	// La edad NO viaja: viaja la fecha con su precisión y el cliente deriva.
	// Calcularla acá la congelaría en el instante de la respuesta y además
	// obligaría al backend a pluralizar "año/años" en tres idiomas.
	//
	// MicrochipID queda DELIBERADAMENTE fuera: GET /api/pets/:id es público, y
	// un número de microchip es un identificador con el que un tercero podría
	// reclamar una mascota ajena. Exponerlo necesita una respuesta con alcance
	// de dueño, que es un cambio aparte.
	BirthDate          string             `json:"birth_date,omitempty"`
	BirthDatePrecision string             `json:"birth_date_precision,omitempty"`
	Version     int                `json:"version"`
	Photos      []PetPhotoResponse `json:"photos"`
	Owner       *PetOwnerResponse  `json:"owner,omitempty"`
	// ReporterContactPublic mirrors the pet flag so the UI knows whether the
	// public reporter-contact channel is available. Reporter is only populated
	// (with the phone) when the opt-in is on AND a phone exists.
	ReporterContactPublic bool                 `json:"reporter_contact_public"`
	Reporter              *PetReporterResponse `json:"reporter,omitempty"`
	CreatedAt             time.Time            `json:"created_at"`
}

// ToPetResponse convierte un domain.Pet en un PetResponse limpio.
func ToPetResponse(pet *domain.Pet) PetResponse {
	photos := make([]PetPhotoResponse, len(pet.Photos))
	for i, p := range pet.Photos {
		photos[i] = PetPhotoResponse{
			ID:        p.ID,
			URL:       p.URL,
			IsPrimary: p.IsPrimary,
			CreatedAt: p.CreatedAt,
		}
	}

	resp := PetResponse{
		ID:                    pet.ID,
		OwnerID:               pet.OwnerID,
		ReporterID:            pet.ReporterID,
		Name:                  pet.Name,
		Type:                  pet.Type,
		Breed:                 pet.Breed,
		Color:                 pet.Color,
		Description:           pet.Description,
		City:                  pet.City,
		Gender:                pet.Gender,
		BirthDate:             domain.FormatBirthDate(pet.BirthDate),
		BirthDatePrecision:    pet.BirthDatePrecision,
		Status:                pet.Status,
		Version:               pet.Version,
		Photos:                photos,
		ReporterContactPublic: pet.ReporterContactPublic,
		CreatedAt:             pet.CreatedAt,
	}

	// Owner es opcional — solo lo incluimos si fue cargado (Preload)
	if pet.Owner.ID != (uuid.UUID{}) {
		resp.Owner = &PetOwnerResponse{
			ID:         pet.Owner.ID,
			Name:       pet.Owner.Name,
			Phone:      pet.Owner.Phone,
			IsVerified: pet.Owner.IsVerified,
		}
	}

	// Reporter (stray) — privacidad: solo exponemos el teléfono cuando el
	// reporter hizo opt-in Y efectivamente tiene un teléfono cargado. Sin
	// opt-in o sin teléfono, no incluimos el bloque (la UI cae a chat in-app).
	if pet.ReporterContactPublic && pet.Reporter.ID != (uuid.UUID{}) && pet.Reporter.Phone != "" {
		resp.Reporter = &PetReporterResponse{
			ID:         pet.Reporter.ID,
			Name:       pet.Reporter.Name,
			Phone:      pet.Reporter.Phone,
			IsVerified: pet.Reporter.IsVerified,
		}
	}

	return resp
}

// ToPetListResponse convierte un slice de domain.Pet en un slice de PetResponse.
func ToPetListResponse(pets []domain.Pet) []PetResponse {
	result := make([]PetResponse, len(pets))
	for i, pet := range pets {
		result[i] = ToPetResponse(&pet)
	}
	return result
}

// ToPhotoResponse convierte un domain.Photo en un PetPhotoResponse.
// Reutilizamos el DTO existente — no creamos uno nuevo para evitar duplicación.
func ToPhotoResponse(photo *domain.Photo) PetPhotoResponse {
	return PetPhotoResponse{
		ID:        photo.ID,
		URL:       photo.URL,
		IsPrimary: photo.IsPrimary,
		CreatedAt: photo.CreatedAt,
	}
}

// ToPhotoListResponse convierte un slice de domain.Photo en un slice de PetPhotoResponse.
func ToPhotoListResponse(photos []domain.Photo) []PetPhotoResponse {
	result := make([]PetPhotoResponse, len(photos))
	for i, p := range photos {
		result[i] = ToPhotoResponse(&p)
	}
	return result
}
