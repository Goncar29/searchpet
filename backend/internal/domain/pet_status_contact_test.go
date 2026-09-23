// Package domain — verifica ContactVisibleStatuses/IsContactVisible: el
// teléfono del dueño en GET /api/pets/:id sólo debe considerarse visible en
// lost, stray y adoption. Las dos mitades (rule "test sólo la negativa"):
// los tres que exponen Y los cuatro que no.
package domain

import "testing"

func TestIsContactVisible_LostStrayAdoption_True(t *testing.T) {
	for _, status := range []string{PetStatusLost, PetStatusStray, PetStatusAdoption} {
		if !IsContactVisible(status) {
			t.Errorf("status %q: esperaba IsContactVisible=true, vino false", status)
		}
	}
}

func TestIsContactVisible_RegisteredArchivedFoundAdopted_False(t *testing.T) {
	for _, status := range []string{
		PetStatusRegistered,
		PetStatusArchived,
		PetStatusFound,
		PetStatusAdopted,
	} {
		if IsContactVisible(status) {
			t.Errorf("status %q: esperaba IsContactVisible=false, vino true", status)
		}
	}
}
