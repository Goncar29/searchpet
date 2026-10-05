package tests

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/event"
	"lost-pets/internal/service"
)

type upsertCall struct {
	user  uuid.UUID
	delta int
	field string
}

// helperAwardRig arma un GamificationService con repos en memoria y devuelve lo
// que el listener hizo. Publish corre el handler SINCRONO inline, asi que no hay
// nada que esperar: cuando Publish vuelve, los premios ya estan.
func helperAwardRig(credits int64) (*event.EventBus, *[]upsertCall, *[]string) {
	var upserts []upsertCall
	var badges []string
	badgeRepo := &mockBadgeRepository{
		createFn: func(_ context.Context, b *domain.Badge) error {
			badges = append(badges, b.UserID.String()+":"+b.BadgeType)
			return nil
		},
	}
	pointsRepo := &mockUserPointsRepository{
		upsertFn: func(_ context.Context, id uuid.UUID, delta int, field string) (*domain.UserPoints, error) {
			upserts = append(upserts, upsertCall{id, delta, field})
			return &domain.UserPoints{UserID: id}, nil
		},
	}
	svc := service.NewGamificationService(badgeRepo, pointsRepo, &mockUserRepository{}, &mockGamificationReviewRepository{}, stubReports{}, stubPets{n: credits}, stubShareCredits{fresh: true})
	bus := event.NewEventBus()
	svc.RegisterListeners(bus)
	return bus, &upserts, &badges
}

func TestGamificationService_OnPetHelpersCredited_AwardsEachHelper(t *testing.T) {
	bus, upserts, badges := helperAwardRig(1)
	a, b := uuid.New(), uuid.New()

	bus.Publish("pet.helpers_credited", event.PetHelpersCreditedEvent{PetID: uuid.New(), PetName: "Rex", HelperIDs: []uuid.UUID{a, b}})

	want := []upsertCall{{a, 100, "found_count"}, {b, 100, "found_count"}}
	if len(*upserts) != 2 || (*upserts)[0] != want[0] || (*upserts)[1] != want[1] {
		t.Fatalf("want +100 found_count for each helper, got %+v", *upserts)
	}
	if len(*badges) != 2 || (*badges)[0] != a.String()+":pet_rescuer" || (*badges)[1] != b.String()+":pet_rescuer" {
		t.Fatalf("want pet_rescuer for each helper and no super_finder at 1 credit, got %v", *badges)
	}
}

func TestGamificationService_OnPetHelpersCredited_SuperFinderThreshold(t *testing.T) {
	cases := []struct {
		credits   int64
		wantSuper bool
	}{{4, false}, {5, true}, {9, true}}
	for _, tc := range cases {
		bus, _, badges := helperAwardRig(tc.credits)
		h := uuid.New()
		bus.Publish("pet.helpers_credited", event.PetHelpersCreditedEvent{PetID: uuid.New(), HelperIDs: []uuid.UUID{h}})
		got := false
		for _, b := range *badges {
			if b == h.String()+":super_finder" {
				got = true
			}
		}
		if got != tc.wantSuper {
			t.Errorf("credits=%d: super_finder=%v, want %v (badges %v)", tc.credits, got, tc.wantSuper, *badges)
		}
	}
}

func TestGamificationService_OnPetHelpersCredited_NoHelpersNoAwards(t *testing.T) {
	bus, upserts, badges := helperAwardRig(9)
	bus.Publish("pet.helpers_credited", event.PetHelpersCreditedEvent{PetID: uuid.New(), HelperIDs: nil})
	if len(*upserts) != 0 || len(*badges) != 0 {
		t.Fatalf("an event with no helpers must award nothing: %+v %v", *upserts, *badges)
	}
}
