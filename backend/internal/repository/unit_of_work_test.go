package repository_test

import (
	"errors"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"lost-pets/internal/domain"
	"lost-pets/internal/repository"
)

// setupMockDB opens a GORM connection (postgres dialect, the production
// dialect) backed by sqlmock so transaction behavior can be asserted without
// a real database.
func setupMockDB(t *testing.T) (*gorm.DB, sqlmock.Sqlmock) {
	t.Helper()
	sqlDB, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("failed to create sqlmock: %v", err)
	}
	t.Cleanup(func() { sqlDB.Close() })

	db, err := gorm.Open(postgres.New(postgres.Config{Conn: sqlDB, PreferSimpleProtocol: true}), &gorm.Config{SkipDefaultTransaction: true})
	if err != nil {
		t.Fatalf("failed to open gorm: %v", err)
	}
	return db, mock
}

// newMinimalPet returns a minimal valid domain.Pet for INSERT tests.
func newMinimalPet() *domain.Pet {
	return &domain.Pet{
		Name:   "Firulais",
		Type:   "perro",
		Status: domain.PetStatusStray,
	}
}

func TestUnitOfWork_CommitsWhenFnSucceeds(t *testing.T) {
	db, mock := setupMockDB(t)
	uow := repository.NewUnitOfWork(db)

	mock.ExpectBegin()
	mock.ExpectCommit()

	err := uow.Execute(func(tx repository.UnitOfWorkRepos) error {
		if tx.Pets == nil || tx.Reports == nil {
			t.Fatal("expected transaction-scoped repositories to be non-nil")
		}
		return nil
	})
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet sqlmock expectations: %v", err)
	}
}

func TestUnitOfWork_RollsBackWhenFnFails(t *testing.T) {
	db, mock := setupMockDB(t)
	uow := repository.NewUnitOfWork(db)

	boom := errors.New("publish failed")

	mock.ExpectBegin()
	mock.ExpectRollback()

	err := uow.Execute(func(tx repository.UnitOfWorkRepos) error {
		return boom
	})
	if !errors.Is(err, boom) {
		t.Fatalf("expected fn error to surface, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet sqlmock expectations: %v", err)
	}
}

func TestUnitOfWork_ReposAreBoundToTransaction(t *testing.T) {
	db, mock := setupMockDB(t)
	uow := repository.NewUnitOfWork(db)

	mock.ExpectBegin()
	// Any INSERT executed through tx.Pets.Create must run INSIDE the
	// transaction, i.e. between BEGIN and COMMIT on this same connection.
	// GORM's postgres driver issues an INSERT ... RETURNING "id" query, so it
	// goes through QueryContext rather than ExecContext.
	mock.ExpectQuery(`INSERT INTO "pets"`).
		WillReturnRows(sqlmock.NewRows([]string{"id", "created_at", "updated_at"}))
	mock.ExpectCommit()

	err := uow.Execute(func(tx repository.UnitOfWorkRepos) error {
		pet := newMinimalPet()
		return tx.Pets.Create(pet)
	})
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet sqlmock expectations: %v", err)
	}
}
