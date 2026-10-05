package tests

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
	"lost-pets/internal/event"
	"lost-pets/internal/repository"
	"lost-pets/internal/service"
	"lost-pets/tests/testdb"
)

// helperFlowDeps cablea los servicios REALES (pet, report, gamification) sobre
// Postgres real y un EventBus real. Nada de mocks: lo que se prueba es que las
// tres puertas, la transaccion, el insert de creditos y los premios coinciden.
type helperFlowDeps struct {
	db          *gorm.DB
	users       repository.UserRepository
	pets        repository.PetRepository
	reports     repository.ReportRepository
	episodes    repository.EpisodeRepository
	credits     repository.PetHelperCreditRepository
	points      repository.UserPointsRepository
	badges      repository.BadgeRepository
	petSvc      service.PetService
	reportSvc   service.ReportService
	gamSvc      service.GamificationService
	bus         *event.EventBus
	creditedEvs *[]event.PetHelpersCreditedEvent
}

func newHelperFlowDeps(t *testing.T) helperFlowDeps {
	t.Helper()
	db := testdb.SetupTestDB(t)
	d := helperFlowDeps{db: db}
	d.users = repository.NewUserRepository(db)
	d.pets = repository.NewPetRepository(db)
	d.reports = repository.NewReportRepository(db)
	d.episodes = repository.NewEpisodeRepository(db)
	d.credits = repository.NewPetHelperCreditRepository(db)
	d.points = repository.NewUserPointsRepository(db)
	d.badges = repository.NewBadgeRepository(db)
	uow := repository.NewUnitOfWork(db)
	d.bus = event.NewEventBus()
	episodeSvc := service.NewEpisodeService()
	d.petSvc = service.NewPetService(d.pets, d.bus, nil, d.reports, uow, repository.NewStatEventRepository(db), episodeSvc, d.episodes, service.WithHelperCredits(d.credits))
	d.reportSvc = service.NewReportService(d.reports, d.pets, d.bus, repository.NewStatEventRepository(db), episodeSvc, d.episodes, uow)
	gam := service.NewGamificationService(d.badges, d.points, d.users, repository.NewUserReviewRepository(db), d.reports, d.credits, repository.NewPetShareCreditRepository(db))
	gam.RegisterListeners(d.bus)
	d.gamSvc = gam

	var evs []event.PetHelpersCreditedEvent
	d.creditedEvs = &evs
	d.bus.SubscribeSync("pet.helpers_credited", func(p interface{}) {
		if ev, ok := p.(event.PetHelpersCreditedEvent); ok {
			evs = append(evs, ev)
		}
	})
	return d
}

// lostPet crea una mascota perdida del dueno (episodio abierto con su reporte
// inicial) y hace que cada ayudante deje un avistamiento.
func (d helperFlowDeps) lostPet(t *testing.T, owner *domain.User, helpers ...*domain.User) *domain.Pet {
	t.Helper()
	pet := &domain.Pet{ID: uuid.New(), OwnerID: ptrUUID(owner.ID), Name: "Rex", Type: "perro", Status: domain.PetStatusRegistered}
	if err := d.pets.Create(pet); err != nil {
		t.Fatalf("create pet: %v", err)
	}
	if _, err := d.petSvc.PublishLost(owner.ID.String(), pet.ID.String(), dto.PublishLostRequest{Latitude: mvdLat, Longitude: mvdLng}); err != nil {
		t.Fatalf("publish lost: %v", err)
	}
	d.sightings(t, pet, helpers...)
	return pet
}

func (d helperFlowDeps) sightings(t *testing.T, pet *domain.Pet, helpers ...*domain.User) {
	t.Helper()
	for _, h := range helpers {
		if _, err := d.reportSvc.CreateReport(h.ID.String(), service.CreateReportRequest{
			PetID: pet.ID.String(), Status: "sighting", Latitude: mvdLat, Longitude: mvdLng,
		}); err != nil {
			t.Fatalf("sighting by %s: %v", h.ID, err)
		}
	}
}

func (d helperFlowDeps) status(t *testing.T, pet *domain.Pet) string {
	t.Helper()
	p, err := d.pets.FindByID(pet.ID.String())
	if err != nil {
		t.Fatal(err)
	}
	return p.Status
}

// pointsRow devuelve la fila de user_points (ceros si todavia no existe).
//
// Las asserts de abajo miran FoundCount y no Points a proposito: los +5 por cada
// reporte los suma un listener ASINCRONO de report.created, asi que Points se
// mueve solo y leerlo seria una carrera. FoundCount y el +100 los toca unicamente
// el listener SINCRONO de pet.helpers_credited, que ya termino cuando vuelve la
// puerta: ese numero es determinista.
func (d helperFlowDeps) pointsRow(t *testing.T, id uuid.UUID) domain.UserPoints {
	t.Helper()
	p, err := d.points.GetByUserID(context.Background(), id)
	if errors.Is(err, domain.ErrPointsNotFound) {
		return domain.UserPoints{}
	}
	if err != nil {
		t.Fatal(err)
	}
	return *p
}

func ids(us ...*domain.User) *[]string {
	out := make([]string, 0, len(us))
	for _, u := range us {
		out = append(out, u.ID.String())
	}
	return &out
}

// door es una de las tres formas de dar vuelta una mascota a `found`.
type door struct {
	name string
	run  func(d helperFlowDeps, actor *domain.User, pet *domain.Pet, helperIDs *[]string) error
}

var foundDoors = []door{
	{"UpdatePet", func(d helperFlowDeps, actor *domain.User, pet *domain.Pet, h *[]string) error {
		_, err := d.petSvc.UpdatePet(actor.ID.String(), pet.ID.String(), dto.UpdatePetRequest{Status: domain.PetStatusFound, HelperIDs: h})
		return err
	}},
	{"MarkAsFound", func(d helperFlowDeps, actor *domain.User, pet *domain.Pet, h *[]string) error {
		_, err := d.petSvc.MarkAsFound(actor.ID.String(), pet.ID.String(), h)
		return err
	}},
	{"CreateReport", func(d helperFlowDeps, actor *domain.User, pet *domain.Pet, h *[]string) error {
		_, err := d.reportSvc.CreateReport(actor.ID.String(), service.CreateReportRequest{
			PetID: pet.ID.String(), Status: "found", Latitude: mvdLat, Longitude: mvdLng, HelperIDs: h,
		})
		return err
	}},
}

// Las tres puertas aplican la MISMA regla, y cada una la hace cumplir sola:
// una puerta que se olvidara de llamar a confirmHelpers daria verde en las otras
// dos y rojo aca, con el nombre de la puerta.
func TestHelperConfirmation_EveryDoorEnforcesTheRule(t *testing.T) {
	for _, dr := range foundDoors {
		dr := dr
		t.Run(dr.name, func(t *testing.T) {
			t.Run("nil list with candidates is required and nothing changes", func(t *testing.T) {
				d := newHelperFlowDeps(t)
				owner, helper := newTestUser(t, d.users), newTestUser(t, d.users)
				pet := d.lostPet(t, owner, helper)

				err := dr.run(d, owner, pet, nil)
				if !errors.Is(err, domain.ErrHelperIDsRequired) {
					t.Fatalf("want ErrHelperIDsRequired, got %v", err)
				}
				if got := d.status(t, pet); got != domain.PetStatusLost {
					t.Fatalf("the rejected request must roll back: status=%s", got)
				}
				if n, _ := d.credits.CountByHelper(helper.ID); n != 0 {
					t.Fatalf("no credit on a rejected request, got %d", n)
				}
			})

			t.Run("nil list without candidates is accepted", func(t *testing.T) {
				d := newHelperFlowDeps(t)
				owner := newTestUser(t, d.users)
				pet := d.lostPet(t, owner)

				if err := dr.run(d, owner, pet, nil); err != nil {
					t.Fatalf("no candidates, nil list must be fine: %v", err)
				}
				if got := d.status(t, pet); got != domain.PetStatusFound {
					t.Fatalf("status=%s", got)
				}
			})

			t.Run("empty list means nobody helped", func(t *testing.T) {
				d := newHelperFlowDeps(t)
				owner, helper := newTestUser(t, d.users), newTestUser(t, d.users)
				pet := d.lostPet(t, owner, helper)

				if err := dr.run(d, owner, pet, ids()); err != nil {
					t.Fatalf("empty list is a valid answer: %v", err)
				}
				if got := d.status(t, pet); got != domain.PetStatusFound {
					t.Fatalf("status=%s", got)
				}
				if n, _ := d.credits.CountByHelper(helper.ID); n != 0 {
					t.Fatalf("nobody was chosen, got %d credits", n)
				}
				if p := d.pointsRow(t, helper.ID); p.FoundCount != 0 {
					t.Fatalf("nobody was chosen, found_count must stay 0, got %d", p.FoundCount)
				}
				if len(*d.creditedEvs) != 0 {
					t.Fatal("no helpers_credited event when nobody was credited")
				}
			})

			invalid := map[string]func(owner, helper, stranger *domain.User) *[]string{
				"an id that never reported":  func(_, _, s *domain.User) *[]string { return ids(s) },
				"the owner":                  func(o, _, _ *domain.User) *[]string { return ids(o) },
				"a valid id mixed with a bad": func(_, h, s *domain.User) *[]string { return ids(h, s) },
				"a malformed id": func(_, _, _ *domain.User) *[]string {
					l := []string{"not-a-uuid"}
					return &l
				},
			}
			for name, pick := range invalid {
				pick := pick
				t.Run("rejects "+name, func(t *testing.T) {
					d := newHelperFlowDeps(t)
					owner, helper, stranger := newTestUser(t, d.users), newTestUser(t, d.users), newTestUser(t, d.users)
					pet := d.lostPet(t, owner, helper)

					err := dr.run(d, owner, pet, pick(owner, helper, stranger))
					if !errors.Is(err, domain.ErrInvalidHelpers) {
						t.Fatalf("want ErrInvalidHelpers, got %v", err)
					}
					if got := d.status(t, pet); got != domain.PetStatusLost {
						t.Fatalf("a rejected request must roll back: status=%s", got)
					}
					if n, _ := d.credits.CountByHelper(helper.ID); n != 0 {
						t.Fatalf("a mixed list must credit nobody, got %d", n)
					}
				})
			}

			t.Run("credits the chosen helpers and pays them", func(t *testing.T) {
				d := newHelperFlowDeps(t)
				owner, a, b := newTestUser(t, d.users), newTestUser(t, d.users), newTestUser(t, d.users)
				pet := d.lostPet(t, owner, a, b)

				// Solo se elige a "a": "b" reporto pero el dueno no lo confirma.
				if err := dr.run(d, owner, pet, ids(a)); err != nil {
					t.Fatal(err)
				}
				if got := d.status(t, pet); got != domain.PetStatusFound {
					t.Fatalf("status=%s", got)
				}
				if n, _ := d.credits.CountByHelper(a.ID); n != 1 {
					t.Fatalf("a: want 1 credit, got %d", n)
				}
				if n, _ := d.credits.CountByHelper(b.ID); n != 0 {
					t.Fatalf("b was not chosen, got %d credits", n)
				}
				// +100 y found_count por ayudar; el dueno no gana nada por reunir a su mascota.
				if p := d.pointsRow(t, a.ID); p.FoundCount != 1 || p.Points < 100 {
					t.Fatalf("a: want found_count 1 and >=100 points, got %+v", p)
				}
				if p := d.pointsRow(t, b.ID); p.FoundCount != 0 {
					t.Fatalf("b was not chosen: found_count must be 0, got %d", p.FoundCount)
				}
				if p := d.pointsRow(t, owner.ID); p.FoundCount != 0 {
					t.Fatalf("the owner must earn nothing for finding their own pet, got found_count %d", p.FoundCount)
				}
				has, err := d.badges.HasBadge(context.Background(), a.ID, "pet_rescuer")
				if err != nil || !has {
					t.Fatalf("a must hold pet_rescuer (has=%v err=%v)", has, err)
				}
				prof, err := d.gamSvc.GetPublicProfile(context.Background(), a.ID)
				if err != nil {
					t.Fatal(err)
				}
				if prof.FoundCount != 1 {
					t.Fatalf("profile found_count comes from credits: want 1, got %d", prof.FoundCount)
				}
				profB, err := d.gamSvc.GetPublicProfile(context.Background(), b.ID)
				if err != nil {
					t.Fatal(err)
				}
				if profB.FoundCount != 0 {
					t.Fatalf("b reported on a found pet but was not credited: want 0, got %d", profB.FoundCount)
				}
			})

			t.Run("a reporter of an older search is not a candidate", func(t *testing.T) {
				d := newHelperFlowDeps(t)
				owner, old := newTestUser(t, d.users), newTestUser(t, d.users)
				pet := d.lostPet(t, owner, old)
				// Cierra la busqueda 1 sin pasar por la regla (como un dato historico).
				if err := d.pets.UpdateStatus(pet.ID.String(), domain.PetStatusRegistered); err != nil {
					t.Fatal(err)
				}
				if err := d.episodes.CloseCurrent(pet.ID.String(), "found"); err != nil {
					t.Fatal(err)
				}
				if _, err := d.petSvc.PublishLost(owner.ID.String(), pet.ID.String(), dto.PublishLostRequest{Latitude: mvdLat, Longitude: mvdLng}); err != nil {
					t.Fatal(err)
				}

				// Busqueda 2 sin reportes ajenos: no hay candidatos, asi que "old" es invalido.
				err := dr.run(d, owner, pet, ids(old))
				if !errors.Is(err, domain.ErrInvalidHelpers) {
					t.Fatalf("want ErrInvalidHelpers for a reporter of the previous search, got %v", err)
				}
			})
		})
	}
}

// Un callejero no tiene dueno: quien lo reporto decide los ayudantes y no cobra.
func TestHelperConfirmation_StrayReporterActsAsOwnerAndEarnsNothing(t *testing.T) {
	d := newHelperFlowDeps(t)
	reporter, helper := newTestUser(t, d.users), newTestUser(t, d.users)

	stray, err := d.petSvc.CreatePet(reporter.ID.String(), dto.CreatePetRequest{
		Name: "Callejero", Type: "perro", Status: domain.PetStatusStray,
		InitialReport: &dto.InitialReportRequest{Latitude: mvdLat, Longitude: mvdLng},
	})
	if err != nil {
		t.Fatalf("create stray: %v", err)
	}
	d.sightings(t, stray, helper)

	// El reportante no es candidato de su propio callejero.
	if err := foundDoors[1].run(d, reporter, stray, ids(reporter)); !errors.Is(err, domain.ErrInvalidHelpers) {
		t.Fatalf("the stray's reporter must not be choosable, got %v", err)
	}
	if err := foundDoors[1].run(d, reporter, stray, ids(helper)); err != nil {
		t.Fatal(err)
	}
	if n, _ := d.credits.CountByHelper(helper.ID); n != 1 {
		t.Fatalf("helper: want 1 credit, got %d", n)
	}
	if n, _ := d.credits.CountByHelper(reporter.ID); n != 0 {
		t.Fatalf("reporter: want 0 credits, got %d", n)
	}
	if p := d.pointsRow(t, reporter.ID); p.FoundCount != 0 {
		t.Fatalf("stray reporter must not earn for the find: found_count %d", p.FoundCount)
	}
	if p := d.pointsRow(t, helper.ID); p.FoundCount != 1 {
		t.Fatalf("helper must earn: found_count %d", p.FoundCount)
	}
}

// Se acredita una vez por MASCOTA: un ciclo found -> lost -> found no vuelve a
// pagarle al mismo ayudante, y el segundo cierre no publica el evento.
func TestHelperConfirmation_FoundLostFoundLoopCreditsOnce(t *testing.T) {
	d := newHelperFlowDeps(t)
	owner, helper := newTestUser(t, d.users), newTestUser(t, d.users)
	pet := d.lostPet(t, owner, helper)

	if _, err := d.petSvc.MarkAsFound(owner.ID.String(), pet.ID.String(), ids(helper)); err != nil {
		t.Fatal(err)
	}
	if p := d.pointsRow(t, helper.ID); p.FoundCount != 1 {
		t.Fatalf("first find: want found_count 1, got %d", p.FoundCount)
	}

	// found -> lost no esta en la maquina de estados: se simula como en episode_flow_test.
	if err := d.pets.UpdateStatus(pet.ID.String(), domain.PetStatusRegistered); err != nil {
		t.Fatal(err)
	}
	if _, err := d.petSvc.PublishLost(owner.ID.String(), pet.ID.String(), dto.PublishLostRequest{Latitude: mvdLat, Longitude: mvdLng}); err != nil {
		t.Fatal(err)
	}
	d.sightings(t, pet, helper)
	if _, err := d.petSvc.MarkAsFound(owner.ID.String(), pet.ID.String(), ids(helper)); err != nil {
		t.Fatal(err)
	}

	if p := d.pointsRow(t, helper.ID); p.FoundCount != 1 {
		t.Fatalf("second find must not pay the helper again: found_count %d", p.FoundCount)
	}
	if n, _ := d.credits.CountByHelper(helper.ID); n != 1 {
		t.Fatalf("one pet, one credit: got %d", n)
	}
	if len(*d.creditedEvs) != 1 {
		t.Fatalf("helpers_credited must fire once, fired %d", len(*d.creditedEvs))
	}
}

// Una mascota ya encontrada devuelve temprano e ignora la lista: reintentar el
// PATCH nunca acredita dos veces ni exige una respuesta que ya se dio.
func TestHelperConfirmation_MarkAsFoundRetryIgnoresTheList(t *testing.T) {
	d := newHelperFlowDeps(t)
	owner, helper := newTestUser(t, d.users), newTestUser(t, d.users)
	pet := d.lostPet(t, owner, helper)

	if _, err := d.petSvc.MarkAsFound(owner.ID.String(), pet.ID.String(), ids(helper)); err != nil {
		t.Fatal(err)
	}
	if _, err := d.petSvc.MarkAsFound(owner.ID.String(), pet.ID.String(), nil); err != nil {
		t.Fatalf("retry on an already-found pet must not demand the list: %v", err)
	}
	if p := d.pointsRow(t, helper.ID); p.FoundCount != 1 {
		t.Fatalf("retry must not pay again: found_count %d", p.FoundCount)
	}
}

// super_finder depende de las filas de creditos, no del contador de user_points.
func TestHelperConfirmation_SuperFinderAtFiveCredits(t *testing.T) {
	d := newHelperFlowDeps(t)
	owner, helper := newTestUser(t, d.users), newTestUser(t, d.users)

	for i := 1; i <= 5; i++ {
		pet := d.lostPet(t, owner, helper)
		if _, err := d.petSvc.MarkAsFound(owner.ID.String(), pet.ID.String(), ids(helper)); err != nil {
			t.Fatal(err)
		}
		has, err := d.badges.HasBadge(context.Background(), helper.ID, "super_finder")
		if err != nil {
			t.Fatal(err)
		}
		if i < 5 && has {
			t.Fatalf("super_finder must wait for 5 credits, held it after %d", i)
		}
		if i == 5 && !has {
			t.Fatal("super_finder must be awarded at 5 credits")
		}
	}
}

// El candidato se lista para el selector del dueno y nadie mas lo ve.
func TestHelperConfirmation_GetHelperCandidates(t *testing.T) {
	d := newHelperFlowDeps(t)
	owner, helper, stranger := newTestUser(t, d.users), newTestUser(t, d.users), newTestUser(t, d.users)
	pet := d.lostPet(t, owner, helper)

	got, err := d.petSvc.GetHelperCandidates(owner.ID.String(), pet.ID.String())
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].ID != helper.ID {
		t.Fatalf("owner should see exactly the helper, got %+v", got)
	}
	if _, err := d.petSvc.GetHelperCandidates(stranger.ID.String(), pet.ID.String()); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("a non-owner must get ErrForbidden, got %v", err)
	}
	if _, err := d.petSvc.GetHelperCandidates(helper.ID.String(), pet.ID.String()); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("a candidate must not read the candidate list either, got %v", err)
	}
}

// Door 3 (a "found" report) must tell gamification whose pet it is, or the
// owner's / stray reporter's closing report would earn +5 like real help. The
// listener that pays is async, so this pins the payload instead of the points;
// the predicate itself is covered in gamification_service_test.go.
func TestHelperConfirmation_FoundReportCarriesWhoseSearchItCloses(t *testing.T) {
	d := newHelperFlowDeps(t)
	createReport := foundDoors[2]
	if createReport.name != "CreateReport" {
		t.Fatalf("door 3 moved: got %q", createReport.name)
	}
	var got []event.ReportCreatedEvent
	d.bus.SubscribeSync("report.created", func(p interface{}) {
		if ev, ok := p.(event.ReportCreatedEvent); ok && ev.Status == "found" {
			got = append(got, ev)
		}
	})

	owner := newTestUser(t, d.users)
	pet := d.lostPet(t, owner)
	if err := createReport.run(d, owner, pet, nil); err != nil {
		t.Fatal(err)
	}

	reporter := newTestUser(t, d.users)
	stray, err := d.petSvc.CreatePet(reporter.ID.String(), dto.CreatePetRequest{
		Name: "Callejero", Type: "perro", Status: domain.PetStatusStray,
		InitialReport: &dto.InitialReportRequest{Latitude: mvdLat, Longitude: mvdLng},
	})
	if err != nil {
		t.Fatalf("create stray: %v", err)
	}
	if err := createReport.run(d, reporter, stray, nil); err != nil {
		t.Fatal(err)
	}

	if len(got) != 2 {
		t.Fatalf("want 2 found report events, got %d", len(got))
	}
	if got[0].PetOwnerID != owner.ID {
		t.Errorf("owned pet: PetOwnerID = %s, want %s", got[0].PetOwnerID, owner.ID)
	}
	if got[1].PetReporterID != reporter.ID {
		t.Errorf("stray: PetReporterID = %s, want %s", got[1].PetReporterID, reporter.ID)
	}
}
