package service

import (
	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/event"
	"lost-pets/internal/repository"
)

// confirmHelpers es la ÚNICA función que decide a quién se acredita cuando una
// mascota pasa a `found`. La llaman las tres puertas que pueden dar vuelta ese
// estado (UpdatePet, MarkAsFound y CreateReport con status found), siempre
// DENTRO de la transacción del cambio de estado: la respuesta del dueño no puede
// faltar con la mascota ya encontrada, ni acreditarse un cambio que se revirtió.
//
// Reglas (decisiones del dueño del producto, 2026-10-01 y 2026-10-04):
//   - Los candidatos los calcula el servidor: usuarios distintos con algún
//     reporte en la búsqueda ACTUAL, menos el dueño y quien reportó el callejero.
//   - Con al menos un candidato, la lista es OBLIGATORIA: nil (campo ausente) →
//     ErrHelperIDsRequired. Una lista vacía y no-nil es "nadie ayudó" y vale.
//   - Cualquier id fuera del conjunto de candidatos (incluido el dueño) →
//     ErrInvalidHelpers. Sin candidatos, una lista no vacía también es inválida.
//   - Sin candidatos, nil se acepta: no hay nada que preguntar.
//   - Se acredita una vez por MASCOTA (índice único pet_id + helper), así que un
//     ciclo found → lost → found no vuelve a acreditar al mismo ayudante.
//
// Devuelve SÓLO los ids realmente insertados; son los únicos que cobran puntos y
// reciben el push.
//
// Si el UnitOfWork no trae los repositorios (los mocks de los tests unitarios que
// no ejercitan esto), no hace nada.
func confirmHelpers(tx repository.UnitOfWorkRepos, pet *domain.Pet, actorID string, helperIDs *[]string) ([]uuid.UUID, error) {
	if tx.HelperCredits == nil || tx.Episodes == nil {
		return nil, nil
	}

	ep, err := tx.Episodes.FindCurrent(pet.ID.String())
	if err != nil {
		return nil, err
	}
	candidates := []domain.HelperCandidate{}
	if ep != nil {
		candidates, err = tx.HelperCredits.FindCandidates(pet.ID.String(), ep.ID)
		if err != nil {
			return nil, err
		}
	}

	if helperIDs == nil {
		if len(candidates) > 0 {
			return nil, domain.ErrHelperIDsRequired
		}
		return nil, nil
	}

	allowed := make(map[uuid.UUID]bool, len(candidates))
	for _, c := range candidates {
		allowed[c.ID] = true
	}
	chosen := make([]uuid.UUID, 0, len(*helperIDs))
	seen := make(map[uuid.UUID]bool, len(*helperIDs))
	for _, raw := range *helperIDs {
		id, err := uuid.Parse(raw)
		if err != nil || !allowed[id] {
			return nil, domain.ErrInvalidHelpers
		}
		if !seen[id] {
			seen[id] = true
			chosen = append(chosen, id)
		}
	}
	if len(chosen) == 0 {
		return nil, nil
	}

	creditedBy, err := uuid.Parse(actorID)
	if err != nil {
		return nil, domain.ErrInvalidInput
	}
	credits := make([]domain.PetHelperCredit, 0, len(chosen))
	for _, id := range chosen {
		credits = append(credits, domain.PetHelperCredit{
			PetID:        pet.ID,
			EpisodeID:    &ep.ID,
			HelperUserID: id,
			CreditedBy:   creditedBy,
		})
	}
	return tx.HelperCredits.InsertCredits(credits)
}

// publishHelpersCredited avisa, DESPUÉS del commit, quiénes quedaron acreditados.
// No publica nada si nadie lo fue (nadie ayudó, o ya estaban acreditados).
func publishHelpersCredited(bus *event.EventBus, pet *domain.Pet, credited []uuid.UUID) {
	if bus == nil || len(credited) == 0 {
		return
	}
	bus.Publish("pet.helpers_credited", event.PetHelpersCreditedEvent{
		PetID:     pet.ID,
		PetName:   pet.Name,
		HelperIDs: credited,
	})
}
