//go:build e2e

package e2e_test

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"lost-pets/internal/domain"
)

// El índice único de historias es PARCIAL, y este test existe para probar que la
// parte "parcial" no es un adorno.
//
// Va contra Postgres real porque lo que se afirma es el comportamiento de un
// ÍNDICE: un repositorio falso no tiene índices y aceptaría cualquier insert
// (regla #34). El chequeo del service tampoco alcanza — corre ANTES y mira
// `deleted_at IS NULL`, así que sin la misma condición en el índice los dos
// discreparían justo en el caso que importa.
func TestUniqueStoryPerPet_indiceParcial(t *testing.T) {
	_, db, cleanup := startTestServerWithDB(t)
	defer cleanup()

	// La migración corre al arrancar el server. Si el índice no está, el resto
	// del test no prueba nada — y un verde ahí sería peor que un rojo.
	var existe bool
	if err := db.Raw(`SELECT EXISTS (
		SELECT 1 FROM pg_indexes
		WHERE tablename = 'success_stories' AND indexname = 'uniq_success_stories_pet_alive'
	)`).Scan(&existe).Error; err != nil {
		t.Fatalf("consultando pg_indexes: %v", err)
	}
	if !existe {
		t.Fatal("el índice uniq_success_stories_pet_alive NO existe — la migración no corrió")
	}

	user := crearUsuarioParaHistoria(t, db)
	pet := crearPetParaHistoria(t, db, user.ID)

	primera := &domain.SuccessStory{PetID: pet.ID, UserID: user.ID, Body: "volvió"}
	if err := db.Create(primera).Error; err != nil {
		t.Fatalf("la primera historia debía entrar: %v", err)
	}

	// Dos historias VIVAS para la misma mascota: la base las rechaza.
	if err := db.Create(&domain.SuccessStory{PetID: pet.ID, UserID: user.ID, Body: "otra vez"}).Error; err == nil {
		t.Fatal("la base aceptó DOS historias vivas para la misma mascota")
	}

	// EL CASO QUE HACE FALTA LA PARCIALIDAD: con la primera borrada en lógico,
	// una nueva TIENE que entrar. Con un índice plano esto fallaría, el service
	// —que filtra `deleted_at IS NULL`— habría dejado seguir igual, y el usuario
	// perdería su historia escrita con un 500 genérico.
	if err := db.Model(&domain.SuccessStory{}).
		Where("id = ?", primera.ID).
		UpdateColumn("deleted_at", time.Now()).Error; err != nil {
		t.Fatalf("borrando en lógico: %v", err)
	}

	if err := db.Create(&domain.SuccessStory{PetID: pet.ID, UserID: user.ID, Body: "después del borrado"}).Error; err != nil {
		t.Fatalf("con la anterior BORRADA la nueva debía entrar, y el índice la rechazó: %v", err)
	}

	// Y una mascota distinta nunca estorba a la primera.
	otra := crearPetParaHistoria(t, db, user.ID)
	if err := db.Create(&domain.SuccessStory{PetID: otra.ID, UserID: user.ID, Body: "otra mascota"}).Error; err != nil {
		t.Fatalf("el índice bloqueó una mascota DISTINTA: %v", err)
	}
}

func crearUsuarioParaHistoria(t *testing.T, db *gorm.DB) *domain.User {
	t.Helper()
	u := &domain.User{Email: uuid.NewString() + "@test.uy", Name: "Test", PasswordHash: "x"}
	if err := db.Create(u).Error; err != nil {
		t.Fatalf("creando usuario: %v", err)
	}
	return u
}

func crearPetParaHistoria(t *testing.T, db *gorm.DB, ownerID uuid.UUID) *domain.Pet {
	t.Helper()
	owner := ownerID
	p := &domain.Pet{OwnerID: &owner, Name: "Luna", Type: "perro", Status: "found"}
	if err := db.Create(p).Error; err != nil {
		t.Fatalf("creando mascota: %v", err)
	}
	return p
}
