package service

import (
	"context"
	"log"
	"strings"
	"time"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
	"lost-pets/internal/event"
	"lost-pets/internal/repository"
)

// PetService define el CONTRATO de la capa de negocio para mascotas.
type PetService interface {
	CreatePet(ownerID string, req dto.CreatePetRequest) (*domain.Pet, error)
	GetPetByID(id string) (*domain.Pet, error)
	GetMyPets(ownerID string) ([]domain.Pet, error)
	// GetReportedPets returns the stray pets the user reported.
	GetReportedPets(reporterID string) ([]domain.Pet, error)
	UpdatePet(ownerID string, petID string, req dto.UpdatePetRequest) (*domain.Pet, error)
	DeletePet(ownerID string, petID string) error
	MarkAsFound(ownerID string, petID string) (*domain.Pet, error)
	// PublishLost transitions an owned pet to "lost" and creates its initial
	// location report atomically. Returns ErrForbidden if the caller does not
	// own the pet, ErrInvalidStatusTransition if the pet's current status
	// cannot transition to "lost".
	PublishLost(ownerID string, petID string, req dto.PublishLostRequest) (*domain.Pet, error)
	// SearchPets aplica filtros opcionales y devuelve resultados paginados.
	SearchPets(criteria domain.PetSearchCriteria) (dto.PetSearchResponse, error)
}

// petService es la implementación concreta del PetService.
type petService struct {
	repo         repository.PetRepository
	eventBus     *event.EventBus
	photoService PhotoService
	reportRepo   repository.ReportRepository
	uow          repository.UnitOfWork
	statEvents   repository.StatEventRepository
	episodes     EpisodeService
	episodeRepo  repository.EpisodeRepository
}

// NewPetService es el constructor — recibe el repository, el bus de eventos, el servicio de fotos,
// el report repository y el UnitOfWork (para operaciones transaccionales pet+report).
// eventBus es opcional — si es nil, los eventos no se publican.
// photoService es opcional — si es nil, la eliminación en cascada de fotos se omite.
// reportRepo es opcional — si es nil, el closure report en MarkAsFound se omite.
// uow es opcional en tests unitarios que no ejercitan el camino stray/publish-lost,
// pero requerido en producción para crear strays con initial_report (ver router.go).
// episodes y episodeRepo son opcionales — si son nil, el manejo de episodios se omite.
func NewPetService(repo repository.PetRepository, eventBus *event.EventBus, photoService PhotoService, reportRepo repository.ReportRepository, uow repository.UnitOfWork, statEvents repository.StatEventRepository, episodes EpisodeService, episodeRepo repository.EpisodeRepository) PetService {
	return &petService{repo: repo, eventBus: eventBus, photoService: photoService, reportRepo: reportRepo, uow: uow, statEvents: statEvents, episodes: episodes, episodeRepo: episodeRepo}
}

// recordStat appends a lifetime impact event synchronously, in-request.
// Best-effort: a failure is logged but never aborts the operation the event
// describes (the status change already succeeded). It deliberately does NOT go
// through the EventBus, whose fire-and-forget handlers drop failures silently.
func (s *petService) recordStat(eventType string, petID uuid.UUID) {
	if s.statEvents == nil {
		return
	}
	id := petID
	if err := s.statEvents.Record(context.Background(), eventType, &id); err != nil {
		log.Printf("[pet_service] recordStat %s pet=%s: %v", eventType, petID, err)
	}
}

// CreatePet crea una nueva mascota para el usuario autenticado.
// Status defaults to PetStatusRegistered.
// If req.Status == PetStatusStray, OwnerID is nil (stray pet with no owner) and
// req.InitialReport is REQUIRED — a "sighting" report is created in the same
// transaction (400 initial_report_required if absent).
// If req.Status == PetStatusRegistered (or omitted) or PetStatusAdoption, the
// caller becomes OwnerID and req.InitialReport is FORBIDDEN (400
// initial_report_not_allowed if present) — these pets carry no location report.
// An adoption pet is an owner-published listing; it takes no report and emits no
// events. Creating with lost/found/archived is rejected with
// ErrInvalidStatusTransition.
func (s *petService) CreatePet(ownerID string, req dto.CreatePetRequest) (*domain.Pet, error) {
	ownerUUID, err := uuid.Parse(ownerID)
	if err != nil {
		return nil, domain.ErrInvalidInput
	}

	// Determine status — default to registered
	status := domain.PetStatusRegistered
	if req.Status != "" {
		status = req.Status
	}

	// Only registered, stray and adoption are valid at creation
	if status != domain.PetStatusRegistered && status != domain.PetStatusStray && status != domain.PetStatusAdoption {
		return nil, domain.ErrInvalidStatusTransition
	}

	// initial_report rules: required for stray, forbidden for every other status
	if status == domain.PetStatusStray && req.InitialReport == nil {
		return nil, domain.ErrInitialReportRequired
	}
	if status != domain.PetStatusStray && req.InitialReport != nil {
		return nil, domain.ErrInitialReportNotAllowed
	}
	// Mismo contrato que POST /api/reports: si viene fecha, no puede ser futura.
	// Los dos caminos crean el mismo domain.Report, así que aceptar acá lo que
	// el otro rechaza dejaría el dato inconsistente según por dónde entró.
	if req.InitialReport != nil && req.InitialReport.OccurredAt != nil && req.InitialReport.OccurredAt.After(time.Now()) {
		return nil, domain.ErrInvalidInput
	}

	// Stray pets have no owner; registered pets always have an owner
	var ownerPtr *uuid.UUID
	var reporterPtr *uuid.UUID
	if status == domain.PetStatusStray {
		// OwnerID stays nil; the authenticated user becomes the reporter
		reporterPtr = &ownerUUID
	} else {
		ownerPtr = &ownerUUID
	}

	// The reporter-contact opt-in only applies to strays (the only pets with a
	// reporter). For registered pets it stays false regardless of the request.
	reporterContactPublic := status == domain.PetStatusStray && req.ReporterContactPublic

	// Sin allowlist, un gender largo llega hasta Postgres y explota con
	// SQLSTATE 22001: el usuario recibe un 500 por un dato que el servidor
	// tenía que rechazar con 400.
	if !domain.IsValidPetGender(req.Gender) {
		return nil, domain.ErrInvalidInput
	}

	// Mismo modo de falla que gender, un campo más arriba en el request:
	// microchip_id es `uniqueIndex;size:50` y viaja derecho al INSERT, así que sin
	// guarda un valor de 60 caracteres da SQLSTATE 22001 → 500 por input de
	// cliente. El largo se cuenta en RUNAS; ver domain.IsValidMicrochipID.
	//
	// El vacío se normaliza a NULL, y no es cosmético: en un uniqueIndex de
	// Postgres los NULL no colisionan entre sí pero los strings vacíos SÍ, así que
	// dos mascotas cargadas con el campo del formulario en blanco chocarían con
	// SQLSTATE 23505 → otro 500. Es el mismo defecto que el largo, con otro código.
	microchipID := req.MicrochipID
	if microchipID != nil {
		// Se recorta ANTES de las dos guardas, y no es cosmético en ninguna de
		// las dos. Sin recortar, "   " no es el vacío, así que se guarda como
		// tres espacios literales y la segunda mascota cargada igual vuelve a
		// chocar con 23505 — el mismo 500 que la normalización viene a cerrar.
		// Y " 985141" contra "985141" quedan como dos filas distintas, que
		// derrota al uniqueIndex justo en el único campo donde la identidad es
		// todo el punto.
		limpio := strings.TrimSpace(*microchipID)
		if !domain.IsValidMicrochipID(limpio) {
			return nil, domain.ErrInvalidInput
		}
		if limpio == "" {
			microchipID = nil
		} else {
			microchipID = &limpio
		}
	}

	// La fecha de nacimiento y su precisión se validan como una unidad, ANTES de
	// tocar nada: una fecha sin precisión no se puede mostrar sin mentir sobre
	// cuánto se sabe de ella, y una precisión sin fecha no describe nada.
	var birthDate *time.Time
	if req.BirthDate != nil && *req.BirthDate != "" {
		parsed, err := domain.ParseBirthDate(*req.BirthDate)
		if err != nil {
			return nil, err
		}
		birthDate = &parsed
	}
	if err := domain.ValidateBirthDate(birthDate, req.BirthDatePrecision); err != nil {
		return nil, err
	}

	pet := &domain.Pet{
		OwnerID:               ownerPtr,
		ReporterID:            reporterPtr,
		Name:                  req.Name,
		Type:                  req.Type,
		Breed:                 req.Breed,
		Color:                 req.Color,
		Description:           req.Description,
		Gender:                req.Gender,
		MicrochipID:           microchipID,
		BirthDate:             birthDate,
		BirthDatePrecision:    req.BirthDatePrecision,
		City:                  req.City,
		Status:                status,
		ReporterContactPublic: reporterContactPublic,
		Version:               1,
	}

	var report *domain.Report

	if status == domain.PetStatusStray {
		// Pet + initial report must be created atomically — a stray visible in
		// the public feed without a location report is corrupt data for a
		// map-centric product.
		if s.uow == nil {
			return nil, domain.ErrInternal
		}
		report = &domain.Report{
			PetID:               pet.ID,
			ReporterID:          ownerUUID,
			Status:              "sighting",
			Latitude:            req.InitialReport.Latitude,
			Longitude:           req.InitialReport.Longitude,
			LocationDescription: req.InitialReport.Note,
			OccurredAt:          req.InitialReport.OccurredAt,
		}
		err := s.uow.Execute(func(tx repository.UnitOfWorkRepos) error {
			if err := tx.Pets.Create(pet); err != nil {
				return err
			}
			report.PetID = pet.ID
			// Open a search episode for the new stray pet and stamp the initial report.
			if tx.Episodes != nil {
				ep, err := tx.Episodes.Open(pet.ID.String())
				if err != nil {
					return err
				}
				report.EpisodeID = &ep.ID
			}
			return tx.Reports.Create(report)
		})
		if err != nil {
			return nil, err
		}
		// A new stray sighting opens a search episode.
		s.recordStat(domain.StatEventSearchStarted, pet.ID)
	} else {
		if err := s.repo.Create(pet); err != nil {
			return nil, err
		}
	}

	// Publicamos pet.stray cuando se crea una mascota callejera — EmbeddingService
	// se suscribe para backfillear embeddings (no-op si todavía no tiene fotos).
	if s.eventBus != nil && status == domain.PetStatusStray {
		s.eventBus.Publish("pet.stray", event.PetStrayEvent{PetID: pet.ID})

		// report.created — triggers nearby push notifications via NotificationService.
		// PetOwnerID is intentionally left as zero value: stray pets have no owner to notify.
		s.eventBus.Publish("report.created", event.ReportCreatedEvent{
			ReportID:   report.ID,
			PetID:      pet.ID,
			ReporterID: ownerUUID,
			PetName:    pet.Name,
			PetType:    pet.Type,
			Status:     "sighting",
			Lat:        req.InitialReport.Latitude,
			Lng:        req.InitialReport.Longitude,
		})
	}

	return s.repo.FindByID(pet.ID.String())
}

// GetPetByID busca una mascota por ID. Cualquiera puede ver una mascota.
func (s *petService) GetPetByID(id string) (*domain.Pet, error) {
	return s.repo.FindByID(id)
}

// GetMyPets devuelve todas las mascotas del usuario autenticado.
func (s *petService) GetMyPets(ownerID string) ([]domain.Pet, error) {
	return s.repo.FindByOwnerID(ownerID)
}

// GetReportedPets devuelve las mascotas callejeras (stray) que reportó el usuario.
func (s *petService) GetReportedPets(reporterID string) ([]domain.Pet, error) {
	return s.repo.FindByReporterID(reporterID)
}

// UpdatePet actualiza una mascota — verifica que el usuario sea el dueño.
// Enforces state machine transitions and optimistic concurrency via Version field.
func (s *petService) UpdatePet(ownerID string, petID string, req dto.UpdatePetRequest) (*domain.Pet, error) {
	pet, err := s.repo.FindByID(petID)
	if err != nil {
		return nil, err
	}

	// LÓGICA DE NEGOCIO: el dueño (o el reporter, si es un stray) puede editar.
	if !canManagePet(pet, ownerID) {
		return nil, domain.ErrForbidden
	}

	// Optimistic concurrency — reject if version has changed since the caller last read
	if req.Version != 0 && pet.Version != req.Version {
		return nil, domain.ErrConflict
	}

	// Capturamos el estado anterior antes de aplicar cambios (necesario para publicar pet.lost)
	oldStatus := pet.Status

	// State machine guard — validate transition before applying any changes
	if req.Status != "" && req.Status != pet.Status {
		if err := domain.ValidateTransition(pet.Status, req.Status); err != nil {
			return nil, err
		}
	}

	// Name is required, so only overwrite it when a value is sent. Optional fields
	// are pointers: nil means "not sent" (leave as-is), a non-nil pointer — even to
	// an empty string — means "set to this", which lets the user clear the field.
	if req.Name != "" {
		pet.Name = req.Name
	}
	if req.Breed != nil {
		pet.Breed = *req.Breed
	}
	if req.Color != nil {
		pet.Color = *req.Color
	}
	if req.Description != nil {
		pet.Description = *req.Description
	}
	if req.City != nil {
		pet.City = *req.City
	}
	if req.Gender != nil {
		if !domain.IsValidPetGender(*req.Gender) {
			return nil, domain.ErrInvalidInput
		}
		pet.Gender = *req.Gender
	}

	// El ORDEN de estos dos bloques SÍ importa, y no por la razón que decía el
	// comentario anterior. Con la precisión primero, mandar una fecha junto a
	// una precisión vacía deja la fecha puesta y la precisión en blanco, o sea
	// un par incoherente que el validador rechaza con 400. Invertidos, el
	// borrado de la precisión pisaría la fecha y el request contradictorio se
	// aceptaría con un 200 descartando en silencio el dato que el usuario
	// mandó. Se prefiere el error explícito.
	if req.BirthDatePrecision != nil {
		pet.BirthDatePrecision = *req.BirthDatePrecision
		if *req.BirthDatePrecision == "" {
			pet.BirthDate = nil
		}
	}
	if req.BirthDate != nil {
		if *req.BirthDate == "" {
			pet.BirthDate = nil
			// Vaciar la fecha borra también la precisión GUARDADA: sin fecha no
			// describe nada. Pero no pisa una precisión que el mismo request
			// esté pidiendo — ese pedido es contradictorio y lo corta el
			// validador de abajo con 400, igual que en el caso espejo.
			//
			// Sin esta distinción, un `{"birth_date": ""}` a secas dejaba viva
			// la precisión vieja y devolvía 400 por un request impecable.
			if req.BirthDatePrecision == nil {
				pet.BirthDatePrecision = ""
			}
		} else {
			parsed, err := domain.ParseBirthDate(*req.BirthDate)
			if err != nil {
				return nil, err
			}
			pet.BirthDate = &parsed
		}
	}

	// Se valida SÓLO si el request tocó el par, y sobre el estado ya aplicado.
	//
	// Lo primero no es un detalle: validar siempre significa revalidar lo que ya
	// estaba guardado, y entonces cualquier fila que por lo que sea quedara
	// fuera de rango bloquearía TODA edición futura de esa mascota — incluido un
	// cambio de estado que no tiene nada que ver, como marcarla encontrada.
	//
	// Lo segundo tampoco: un update parcial que sólo manda la fecha tiene que
	// validarse contra la precisión que la mascota ya tenía, no contra el vacío
	// del request.
	if req.BirthDate != nil || req.BirthDatePrecision != nil {
		if err := domain.ValidateBirthDate(pet.BirthDate, pet.BirthDatePrecision); err != nil {
			return nil, err
		}
	}
	if req.Status != "" {
		pet.Status = req.Status
		// Increment version on status change
		pet.Version++
	}

	// Persist the pet and open/close its search episode ATOMICALLY when the status
	// changes. If these were two separate writes and the episode step failed, the
	// pet would keep the new status with no current episode — permanently invisible
	// on the map, and unrecoverable on retry (oldStatus would already equal the new
	// status). Mirrors the transactional pattern in PublishLost/CreatePet.
	statusChanged := req.Status != "" && req.Status != oldStatus
	if statusChanged && s.episodes != nil && s.uow != nil {
		if err := s.uow.Execute(func(tx repository.UnitOfWorkRepos) error {
			if err := tx.Pets.Update(pet); err != nil {
				return err
			}
			return s.episodes.HandleTransition(tx.Episodes, pet.ID.String(), oldStatus, pet.Status)
		}); err != nil {
			return nil, err
		}
	} else {
		if err := s.repo.Update(pet); err != nil {
			return nil, err
		}
	}

	// Publicamos pet.lost cuando la transición es hacia "lost"
	if s.eventBus != nil && oldStatus != domain.PetStatusLost && pet.Status == domain.PetStatusLost {
		s.eventBus.Publish("pet.lost", event.PetLostEvent{PetID: pet.ID})
	}

	// Lifetime ledger: a registered->lost edit opens a new search episode.
	if oldStatus != domain.PetStatusLost && pet.Status == domain.PetStatusLost {
		s.recordStat(domain.StatEventSearchStarted, pet.ID)
	}

	// Publicamos pet.found cuando la transición es hacia "found".
	// La UI marca "encontrada" desde el dropdown de estado del PetCard, que usa
	// UpdatePet (no MarkAsFound) — sin este publish se saltaría la gamificación
	// y la limpieza del embedding CLIP. Espeja la construcción del evento de
	// MarkAsFound: OwnerID es nil-safe (los strays no tienen dueño).
	if s.eventBus != nil && oldStatus != domain.PetStatusFound && pet.Status == domain.PetStatusFound {
		var eventOwnerID uuid.UUID
		if pet.OwnerID != nil {
			eventOwnerID = *pet.OwnerID
		}
		s.eventBus.Publish("pet.found", event.PetFoundEvent{
			PetID:   pet.ID,
			OwnerID: eventOwnerID,
			PetName: pet.Name,
		})
	}

	// Lifetime ledger: a transition into "found" reunites a pet.
	if oldStatus != domain.PetStatusFound && pet.Status == domain.PetStatusFound {
		s.recordStat(domain.StatEventPetFound, pet.ID)
	}

	// NOTE: there is no "pet.stray" publish here — the status machine (status_machine.go)
	// does not allow any transition INTO "stray" via UpdatePet (stray pets are only
	// created directly with status="stray", see CreatePet). The pet.stray event is
	// published from CreatePet instead.

	return pet, nil
}

// DeletePet elimina una mascota — verifica que el usuario sea el dueño.
// Antes de borrar el registro, elimina los assets de Cloudinary (cascade delete).
func (s *petService) DeletePet(ownerID string, petID string) error {
	pet, err := s.repo.FindByID(petID)
	if err != nil {
		return err
	}

	// LÓGICA DE NEGOCIO: el dueño (o el reporter, si es un stray) puede eliminar.
	if !canManagePet(pet, ownerID) {
		return domain.ErrForbidden
	}

	// Cascade delete: eliminar fotos de Cloudinary antes de borrar el registro.
	if s.photoService != nil {
		if photoErr := s.photoService.DeleteByPetID(petID); photoErr != nil {
			log.Printf("[pet_service] Error eliminando fotos de mascota %s: %v", petID, photoErr)
		}
	}

	return s.repo.Delete(petID)
}

// SearchPets aplica filtros opcionales y devuelve una respuesta paginada.
func (s *petService) SearchPets(criteria domain.PetSearchCriteria) (dto.PetSearchResponse, error) {
	pets, total, err := s.repo.Search(criteria)
	if err != nil {
		return dto.PetSearchResponse{}, err
	}

	page := criteria.Page
	if page < 1 {
		page = 1
	}
	limit := criteria.Limit
	if limit < 1 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}

	data := dto.ToPetListResponse(pets)

	return dto.PetSearchResponse{
		Data:  data,
		Total: total,
		Page:  page,
		Limit: limit,
	}, nil
}

// MarkAsFound marca una mascota como encontrada usando el state machine.
// For owned pets: only the owner may call this.
// For stray pets: only the user who reported the stray (ReporterID) may call this.
func (s *petService) MarkAsFound(ownerID string, petID string) (*domain.Pet, error) {
	pet, err := s.repo.FindByID(petID)
	if err != nil {
		return nil, err
	}

	// Authorization — owner (owned pets) or reporter (stray pets). canManagePet is
	// the single source of truth: it keys off whether the pet has an owner, so it
	// also covers an already-found stray (status no longer "stray") whose reporter
	// retries — a case the previous status-based branch locked out.
	if !canManagePet(pet, ownerID) {
		return nil, domain.ErrForbidden
	}

	// Validate state machine transition
	if err := domain.ValidateTransition(pet.Status, domain.PetStatusFound); err != nil {
		return nil, err
	}

	// Idempotent: if already found, return without error
	if pet.Status == domain.PetStatusFound {
		return pet, nil
	}

	oldStatus := pet.Status

	// Flip the status and close the search episode ATOMICALLY (same rationale as
	// UpdatePet: a committed status with a still-open episode leaves a dangling
	// open episode that the next re-lost cycle would orphan).
	if s.episodes != nil && s.uow != nil {
		if err := s.uow.Execute(func(tx repository.UnitOfWorkRepos) error {
			if err := tx.Pets.UpdateStatus(petID, domain.PetStatusFound); err != nil {
				return err
			}
			return s.episodes.HandleTransition(tx.Episodes, petID, oldStatus, domain.PetStatusFound)
		}); err != nil {
			return nil, err
		}
	} else {
		if err := s.repo.UpdateStatus(petID, domain.PetStatusFound); err != nil {
			return nil, err
		}
	}

	pet.Status = domain.PetStatusFound
	pet.Version++

	// Parseamos el UUID del owner para el closure report y el evento
	ownerUUID, _ := uuid.Parse(ownerID)

	// REQ-02: Auto-create closure report (best-effort — failure does not abort the status flip).
	// CloseCurrent leaves pets.current_episode_id pointing at the just-closed episode,
	// so FindCurrent still returns it for the stamp.
	if s.reportRepo != nil {
		closureReport := &domain.Report{
			PetID:               pet.ID,
			ReporterID:          ownerUUID,
			Status:              "found",
			LocationDescription: "Closure report",
		}
		if s.episodeRepo != nil {
			if cur, err := s.episodeRepo.FindCurrent(petID); err == nil && cur != nil {
				closureReport.EpisodeID = &cur.ID
			}
		}
		if err := s.reportRepo.Create(closureReport); err != nil {
			log.Printf("[pet_service] Error creating closure report for pet %s: %v", petID, err)
		}
	}

	// Publicamos el evento en el bus
	if s.eventBus != nil {
		// Determine the actual owner UUID for the event — for stray it may be nil
		var eventOwnerID uuid.UUID
		if pet.OwnerID != nil {
			eventOwnerID = *pet.OwnerID
		}
		s.eventBus.Publish("pet.found", event.PetFoundEvent{
			PetID:   pet.ID,
			OwnerID: eventOwnerID,
			PetName: pet.Name,
		})
	}

	// Lifetime ledger: this pet was reunited with its family.
	s.recordStat(domain.StatEventPetFound, pet.ID)

	return pet, nil
}

// PublishLost transitions an owned, registered pet to "lost" and creates its
// initial location report in a single transaction. After commit, publishes
// pet.lost (CLIP embedding backfill) and report.created (nearby push notifications).
func (s *petService) PublishLost(ownerID string, petID string, req dto.PublishLostRequest) (*domain.Pet, error) {
	pet, err := s.repo.FindByID(petID)
	if err != nil {
		return nil, err
	}

	// Solo el dueño puede publicar su mascota como perdida
	if pet.OwnerID == nil || pet.OwnerID.String() != ownerID {
		return nil, domain.ErrForbidden
	}

	// Validar que la transición a "lost" sea permitida desde el status actual
	if err := domain.ValidateTransition(pet.Status, domain.PetStatusLost); err != nil {
		return nil, err
	}

	// Se valida ANTES de abrir la transacción, igual que las dos guardas de
	// arriba: rechazar tarde funcionaría (el uow revierte) pero deja el orden
	// de las validaciones dependiendo de un rollback en vez de ser explícito.
	if req.OccurredAt != nil && req.OccurredAt.After(time.Now()) {
		return nil, domain.ErrInvalidInput
	}

	if s.uow == nil {
		return nil, domain.ErrInternal
	}

	ownerUUID, err := uuid.Parse(ownerID)
	if err != nil {
		return nil, domain.ErrInvalidInput
	}

	var report *domain.Report
	err = s.uow.Execute(func(tx repository.UnitOfWorkRepos) error {
		if err := tx.Pets.UpdateStatus(petID, domain.PetStatusLost); err != nil {
			return err
		}
		report = &domain.Report{
			PetID:               pet.ID,
			ReporterID:          ownerUUID,
			Status:              "lost",
			Latitude:            req.Latitude,
			Longitude:           req.Longitude,
			LocationDescription: req.Note,
			OccurredAt:          req.OccurredAt,
		}
		// Open a search episode and stamp the initial location report.
		if tx.Episodes != nil {
			ep, err := tx.Episodes.Open(petID)
			if err != nil {
				return err
			}
			report.EpisodeID = &ep.ID
		}
		return tx.Reports.Create(report)
	})
	if err != nil {
		return nil, err
	}

	pet.Status = domain.PetStatusLost
	pet.Version++

	// Publicamos los eventos DESPUÉS del commit — fallos aquí no afectan la transacción ya confirmada
	if s.eventBus != nil {
		s.eventBus.Publish("pet.lost", event.PetLostEvent{PetID: pet.ID})
		s.eventBus.Publish("report.created", event.ReportCreatedEvent{
			ReportID:   report.ID,
			PetID:      pet.ID,
			ReporterID: ownerUUID,
			PetOwnerID: ownerUUID,
			PetName:    pet.Name,
			PetType:    pet.Type,
			Status:     "lost",
			Lat:        req.Latitude,
			Lng:        req.Longitude,
		})
	}

	// Lifetime ledger: publishing as lost opens a new search episode.
	s.recordStat(domain.StatEventSearchStarted, pet.ID)

	return pet, nil
}
