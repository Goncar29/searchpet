package repository

import (
	"gorm.io/gorm"
)

// UnitOfWorkRepos bundles the repositories that must share a single GORM
// transaction. Add fields here as new composite operations need them —
// today only Pets + Reports are required by the publish flow.
type UnitOfWorkRepos struct {
	Pets    PetRepository
	Reports ReportRepository
}

// UnitOfWork runs a function within a single database transaction, giving it
// transaction-scoped repository instances. If the function returns an error,
// the transaction is rolled back; otherwise it is committed.
type UnitOfWork interface {
	Execute(fn func(repos UnitOfWorkRepos) error) error
}

type gormUnitOfWork struct {
	db *gorm.DB
}

// NewUnitOfWork is the constructor — receives the top-level *gorm.DB connection.
func NewUnitOfWork(db *gorm.DB) UnitOfWork {
	return &gormUnitOfWork{db: db}
}

func (u *gormUnitOfWork) Execute(fn func(repos UnitOfWorkRepos) error) error {
	return u.db.Transaction(func(tx *gorm.DB) error {
		repos := UnitOfWorkRepos{
			Pets:    NewPetRepository(tx),
			Reports: NewReportRepository(tx),
		}
		return fn(repos)
	})
}
