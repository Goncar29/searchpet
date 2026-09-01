package main

import (
	"testing"

	"lost-pets/internal/domain"
	"lost-pets/tests/testdb"

	"github.com/google/uuid"
)

// El ledger de métricas NO tiene foreign key a pets — a propósito, para que
// borrar una mascota no baje los contadores históricos. Eso significa que nada
// cascadea: `resetSeedData` tiene que borrarlo por su cuenta, y olvidarse NO da
// error, simplemente deja las filas.
//
// Va contra Postgres real y no contra un mock por el mismo motivo que la regla
// #34: lo que se afirma acá es el comportamiento de un DELETE sobre una tabla
// sin FK, y un repositorio falso no modela ni la tabla ni su ausencia de
// constraints. Un mock diría que sí a cualquier lista.
//
// El defecto que cierra fue REAL y observado: los eventos sobrevivían al reset
// y, como los IDs del seed son FIJOS, el `JOIN pets` del panel de impacto los
// volvía a enganchar a las mascotas recreadas. Se midió una Firulais `lost`
// figurando como reunida dos veces, y 290 de 330 eventos apuntando a mascotas
// que ya no existían.
func TestResetSeedData_borraElLedgerDeMetricas(t *testing.T) {
	db := testdb.SetupTestDB(t)

	if err := db.AutoMigrate(&domain.PlatformEvent{}); err != nil {
		t.Fatalf("migrate platform_events: %v", err)
	}

	petID := uuid.New()
	for _, ev := range []string{domain.StatEventPetFound, domain.StatEventSearchStarted} {
		if err := db.Create(&domain.PlatformEvent{EventType: ev, PetID: &petID}).Error; err != nil {
			t.Fatalf("sembrar %s: %v", ev, err)
		}
	}

	var antes int64
	db.Model(&domain.PlatformEvent{}).Count(&antes)
	if antes < 2 {
		t.Fatalf("el arnés no sembró: hay %d eventos, esperaba al menos 2", antes)
	}

	if err := resetSeedData(db); err != nil {
		t.Fatalf("resetSeedData: %v", err)
	}

	var despues int64
	if err := db.Model(&domain.PlatformEvent{}).Count(&despues).Error; err != nil {
		t.Fatalf("contar después: %v", err)
	}
	if despues != 0 {
		t.Errorf("el reset dejó %d filas en platform_events, esperaba 0 — "+
			"los contadores de impacto van a arrastrar métricas de datos borrados", despues)
	}
}
