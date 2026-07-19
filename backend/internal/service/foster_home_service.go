package service

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"strconv"
	"strings"

	"github.com/google/uuid"
	"github.com/lib/pq"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
	"lost-pets/internal/event"
	"lost-pets/internal/repository"
)

// FosterHomeService define el contrato de negocio de hogares transitorios.
type FosterHomeService interface {
	RegisterOwn(ctx context.Context, userID string, fh *domain.FosterHome) error
	GetMine(ctx context.Context, userID string) (*domain.FosterHome, error)
	UpdateMine(ctx context.Context, userID string, req *dto.UpdateMyFosterHomeRequest) (*domain.FosterHome, error)
	GetApprovedByID(ctx context.Context, id string) (*domain.FosterHome, error)
	GetApproved(ctx context.Context, city, animalType string) ([]domain.FosterHome, error)

	GetPendingQueue(ctx context.Context) ([]domain.FosterHome, error)
	Approve(ctx context.Context, adminID, id string) (*domain.FosterHome, error)
	Reject(ctx context.Context, adminID, id, reason string) (*domain.FosterHome, error)
	Suspend(ctx context.Context, adminID, id, reason string) (*domain.FosterHome, error)
	Reinstate(ctx context.Context, adminID, id string) (*domain.FosterHome, error)
	ModerationLogs(ctx context.Context, id string) ([]domain.FosterHomeModerationLog, error)
	ChangeLogs(ctx context.Context, id string) ([]domain.FosterHomeChangeLog, error)

	// RecordOwnerContactChange registra un cambio de contacto del dueño (hook de perfil).
	RecordOwnerContactChange(ctx context.Context, userID uuid.UUID, changed map[string][2]string) error
}

type fosterHomeService struct {
	repo      repository.FosterHomeRepository
	userRepo  repository.UserRepository
	auditRepo repository.FosterHomeAuditRepository
	bus       *event.EventBus
}

func NewFosterHomeService(
	repo repository.FosterHomeRepository,
	userRepo repository.UserRepository,
	auditRepo repository.FosterHomeAuditRepository,
	bus *event.EventBus,
) FosterHomeService {
	return &fosterHomeService{repo: repo, userRepo: userRepo, auditRepo: auditRepo, bus: bus}
}

func (s *fosterHomeService) RegisterOwn(ctx context.Context, userID string, fh *domain.FosterHome) error {
	ownerUUID, err := uuid.Parse(userID)
	if err != nil {
		return domain.ErrInvalidInput
	}
	user, err := s.userRepo.GetByID(ctx, ownerUUID)
	if err != nil {
		return err
	}
	if !user.EmailVerified {
		return domain.ErrEmailNotVerified
	}
	if _, err := s.repo.GetByOwner(ctx, ownerUUID); err == nil {
		return domain.ErrFosterHomeAlreadyOwned
	} else if !errors.Is(err, domain.ErrFosterHomeNotFound) {
		return err
	}

	fh.OwnerUserID = ownerUUID
	fh.Status = domain.FosterHomeStatusPending
	if err := s.repo.Create(ctx, fh); err != nil {
		return err
	}
	if s.bus != nil {
		s.bus.Publish("foster_home.submitted", map[string]any{"foster_home_id": fh.ID, "owner_user_id": ownerUUID})
	}
	return nil
}

func (s *fosterHomeService) GetMine(ctx context.Context, userID string) (*domain.FosterHome, error) {
	ownerUUID, err := uuid.Parse(userID)
	if err != nil {
		return nil, domain.ErrInvalidInput
	}
	return s.repo.GetByOwner(ctx, ownerUUID)
}

func (s *fosterHomeService) UpdateMine(ctx context.Context, userID string, req *dto.UpdateMyFosterHomeRequest) (*domain.FosterHome, error) {
	ownerUUID, err := uuid.Parse(userID)
	if err != nil {
		return nil, domain.ErrInvalidInput
	}
	fh, err := s.repo.GetByOwner(ctx, ownerUUID)
	if err != nil {
		return nil, err
	}
	// Un hogar suspendido queda CONGELADO: el dueño no puede editarlo.
	if fh.Status == domain.FosterHomeStatusSuspended {
		return nil, domain.ErrFosterHomeSuspended
	}

	changed := map[string][2]string{}
	if req.City != nil && *req.City != fh.City {
		changed["city"] = [2]string{fh.City, *req.City}
		fh.City = *req.City
	}
	if req.HousingType != nil && *req.HousingType != fh.HousingType {
		changed["housing_type"] = [2]string{fh.HousingType, *req.HousingType}
		fh.HousingType = *req.HousingType
	}
	if req.Description != nil && *req.Description != fh.Description {
		changed["description"] = [2]string{fh.Description, *req.Description}
		fh.Description = *req.Description
	}
	if req.Capacity != nil && *req.Capacity != fh.Capacity {
		changed["capacity"] = [2]string{strconv.Itoa(fh.Capacity), strconv.Itoa(*req.Capacity)}
		fh.Capacity = *req.Capacity
	}
	if req.WhatsappPhone != nil && (fh.WhatsappPhone == nil || *req.WhatsappPhone != *fh.WhatsappPhone) {
		old := ""
		if fh.WhatsappPhone != nil {
			old = *fh.WhatsappPhone
		}
		changed["whatsapp_phone"] = [2]string{old, *req.WhatsappPhone}
		v := *req.WhatsappPhone
		fh.WhatsappPhone = &v
	}
	if req.AnimalTypes != nil {
		oldCSV := strings.Join([]string(fh.AnimalTypes), ",")
		newCSV := strings.Join(req.AnimalTypes, ",")
		if oldCSV != newCSV {
			changed["animal_types"] = [2]string{oldCSV, newCSV}
			fh.AnimalTypes = pq.StringArray(req.AnimalTypes)
		}
	}
	if req.Latitude != nil {
		fh.Latitude = req.Latitude
	}
	if req.Longitude != nil {
		fh.Longitude = req.Longitude
	}

	// Un rejected que se edita vuelve a pending (resubmit).
	if fh.Status == domain.FosterHomeStatusRejected {
		fh.Status = domain.FosterHomeStatusPending
		fh.RejectionReason = ""
	}

	if err := s.repo.Update(ctx, fh); err != nil {
		return nil, err
	}

	if len(changed) > 0 {
		s.writeChangeLog(ctx, fh, ownerUUID, domain.FosterHomeChangeListingEdit, changed)
	}
	return fh, nil
}

// writeChangeLog serializa el diff y persiste un FosterHomeChangeLog con snapshot de contacto.
func (s *fosterHomeService) writeChangeLog(ctx context.Context, fh *domain.FosterHome, editor uuid.UUID, changeType string, changed map[string][2]string) {
	diff := map[string]map[string]string{}
	for field, oldNew := range changed {
		diff[field] = map[string]string{"old": oldNew[0], "new": oldNew[1]}
	}
	raw, _ := json.Marshal(diff)
	wa := ""
	if fh.WhatsappPhone != nil {
		wa = *fh.WhatsappPhone
	}
	ownerEmail, ownerPhone := "", ""
	if u, err := s.userRepo.GetByID(ctx, fh.OwnerUserID); err == nil {
		ownerEmail, ownerPhone = u.Email, u.Phone
	}
	if err := s.auditRepo.CreateChangeLog(ctx, &domain.FosterHomeChangeLog{
		FosterHomeID:  fh.ID,
		EditedByID:    editor,
		ChangeType:    changeType,
		ChangedFields: string(raw),
		OwnerEmail:    ownerEmail,
		OwnerPhone:    ownerPhone,
		OwnerWhatsapp: wa,
	}); err != nil {
		log.Printf("[foster_home] failed to write change log for %s: %v", fh.ID, err)
	}
}

func (s *fosterHomeService) RecordOwnerContactChange(ctx context.Context, userID uuid.UUID, changed map[string][2]string) error {
	fh, err := s.repo.GetByOwner(ctx, userID)
	if errors.Is(err, domain.ErrFosterHomeNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	if len(changed) == 0 {
		return nil
	}
	s.writeChangeLog(ctx, fh, userID, domain.FosterHomeChangeOwnerContact, changed)
	return nil
}

func (s *fosterHomeService) GetApprovedByID(ctx context.Context, id string) (*domain.FosterHome, error) {
	fhUUID, err := uuid.Parse(id)
	if err != nil {
		return nil, domain.ErrInvalidInput
	}
	fh, err := s.repo.GetByID(ctx, fhUUID)
	if err != nil {
		return nil, err
	}
	if fh.Status != domain.FosterHomeStatusApproved {
		return nil, domain.ErrFosterHomeNotFound
	}
	return fh, nil
}

func (s *fosterHomeService) GetApproved(ctx context.Context, city, animalType string) ([]domain.FosterHome, error) {
	return s.repo.GetApproved(ctx, city, animalType)
}

func (s *fosterHomeService) GetPendingQueue(ctx context.Context) ([]domain.FosterHome, error) {
	return s.repo.GetPendingQueue(ctx)
}

func (s *fosterHomeService) loadAny(ctx context.Context, id string) (*domain.FosterHome, error) {
	fhUUID, err := uuid.Parse(id)
	if err != nil {
		return nil, domain.ErrInvalidInput
	}
	return s.repo.GetByID(ctx, fhUUID)
}

// transition aplica el cambio de estado, persiste y escribe el moderation log con snapshot.
func (s *fosterHomeService) transition(ctx context.Context, adminID, id, action, reason, newStatus string, allowedFrom ...string) (*domain.FosterHome, error) {
	adminUUID, err := uuid.Parse(adminID)
	if err != nil {
		return nil, domain.ErrInvalidInput
	}
	fh, err := s.loadAny(ctx, id)
	if err != nil {
		return nil, err
	}
	ok := false
	for _, from := range allowedFrom {
		if fh.Status == from {
			ok = true
			break
		}
	}
	if !ok {
		return nil, domain.ErrInvalidFosterHomeStatus
	}
	fh.Status = newStatus
	if action == domain.FosterHomeActionReject {
		fh.RejectionReason = reason
	}
	if newStatus == domain.FosterHomeStatusApproved {
		fh.RejectionReason = ""
	}
	if err := s.repo.Update(ctx, fh); err != nil {
		return nil, err
	}

	wa := ""
	if fh.WhatsappPhone != nil {
		wa = *fh.WhatsappPhone
	}
	ownerEmail, ownerPhone := "", ""
	if u, uerr := s.userRepo.GetByID(ctx, fh.OwnerUserID); uerr == nil {
		ownerEmail, ownerPhone = u.Email, u.Phone
	}
	if err := s.auditRepo.CreateModerationLog(ctx, &domain.FosterHomeModerationLog{
		FosterHomeID:  fh.ID,
		ActorAdminID:  adminUUID,
		Action:        action,
		Reason:        reason,
		OwnerUserID:   fh.OwnerUserID,
		OwnerEmail:    ownerEmail,
		OwnerPhone:    ownerPhone,
		OwnerWhatsapp: wa,
	}); err != nil {
		log.Printf("[foster_home] failed to write moderation log for %s: %v", fh.ID, err)
	}

	eventName := map[string]string{
		domain.FosterHomeActionApprove:   "foster_home.approved",
		domain.FosterHomeActionReject:    "foster_home.rejected",
		domain.FosterHomeActionSuspend:   "foster_home.suspended",
		domain.FosterHomeActionReinstate: "foster_home.approved",
	}[action]
	if s.bus != nil && eventName != "" {
		s.bus.Publish(eventName, map[string]any{"foster_home_id": fh.ID})
	}
	return fh, nil
}

func (s *fosterHomeService) Approve(ctx context.Context, adminID, id string) (*domain.FosterHome, error) {
	return s.transition(ctx, adminID, id, domain.FosterHomeActionApprove, "", domain.FosterHomeStatusApproved, domain.FosterHomeStatusPending)
}

func (s *fosterHomeService) Reject(ctx context.Context, adminID, id, reason string) (*domain.FosterHome, error) {
	reason = strings.TrimSpace(reason)
	if reason == "" {
		return nil, domain.ErrRejectionReasonRequired
	}
	return s.transition(ctx, adminID, id, domain.FosterHomeActionReject, reason, domain.FosterHomeStatusRejected, domain.FosterHomeStatusPending)
}

func (s *fosterHomeService) Suspend(ctx context.Context, adminID, id, reason string) (*domain.FosterHome, error) {
	reason = strings.TrimSpace(reason)
	if reason == "" {
		return nil, domain.ErrSuspensionReasonRequired
	}
	return s.transition(ctx, adminID, id, domain.FosterHomeActionSuspend, reason, domain.FosterHomeStatusSuspended, domain.FosterHomeStatusApproved)
}

func (s *fosterHomeService) Reinstate(ctx context.Context, adminID, id string) (*domain.FosterHome, error) {
	return s.transition(ctx, adminID, id, domain.FosterHomeActionReinstate, "", domain.FosterHomeStatusApproved, domain.FosterHomeStatusSuspended)
}

func (s *fosterHomeService) ModerationLogs(ctx context.Context, id string) ([]domain.FosterHomeModerationLog, error) {
	fhUUID, err := uuid.Parse(id)
	if err != nil {
		return nil, domain.ErrInvalidInput
	}
	return s.auditRepo.ListModerationLogs(ctx, fhUUID)
}

func (s *fosterHomeService) ChangeLogs(ctx context.Context, id string) ([]domain.FosterHomeChangeLog, error) {
	fhUUID, err := uuid.Parse(id)
	if err != nil {
		return nil, domain.ErrInvalidInput
	}
	return s.auditRepo.ListChangeLogs(ctx, fhUUID)
}
