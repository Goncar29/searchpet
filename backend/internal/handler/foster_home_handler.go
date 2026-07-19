package handler

import (
	"errors"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
	"lost-pets/internal/service"
)

const maxFosterPhotoSize = 5 * 1024 * 1024

type FosterHomeHandler struct {
	svc      service.FosterHomeService
	photoSvc service.FosterHomePhotoService
}

func NewFosterHomeHandler(svc service.FosterHomeService, photoSvc service.FosterHomePhotoService) *FosterHomeHandler {
	return &FosterHomeHandler{svc: svc, photoSvc: photoSvc}
}

// POST /api/foster-homes
func (h *FosterHomeHandler) RegisterOwn(c *gin.Context) {
	var req dto.RegisterFosterHomeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, domain.ErrBindingFailed)
		return
	}
	if err := req.Validate(); err != nil {
		writeError(c, http.StatusBadRequest, err)
		return
	}
	fh := dto.ToRegisterFosterHomeDomain(&req)
	if err := h.svc.RegisterOwn(c.Request.Context(), getUserID(c), fh); err != nil {
		switch {
		case errors.Is(err, domain.ErrEmailNotVerified):
			writeError(c, http.StatusForbidden, err)
		case errors.Is(err, domain.ErrFosterHomeAlreadyOwned):
			writeError(c, http.StatusConflict, err)
		case errors.Is(err, domain.ErrUserNotFound):
			writeError(c, http.StatusNotFound, err)
		case errors.Is(err, domain.ErrInvalidInput):
			writeError(c, http.StatusBadRequest, err)
		default:
			writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		}
		return
	}
	c.JSON(http.StatusCreated, dto.ToMyFosterHomeResponse(fh))
}

// GET /api/foster-homes/mine
func (h *FosterHomeHandler) GetMine(c *gin.Context) {
	fh, err := h.svc.GetMine(c.Request.Context(), getUserID(c))
	if err != nil {
		writeFHNotFoundOr500(c, err)
		return
	}
	c.JSON(http.StatusOK, dto.ToMyFosterHomeResponse(fh))
}

// PUT /api/foster-homes/mine
func (h *FosterHomeHandler) UpdateMine(c *gin.Context) {
	var req dto.UpdateMyFosterHomeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, domain.ErrBindingFailed)
		return
	}
	if err := req.Validate(); err != nil {
		writeError(c, http.StatusBadRequest, err)
		return
	}
	fh, err := h.svc.UpdateMine(c.Request.Context(), getUserID(c), &req)
	if err != nil {
		switch {
		case errors.Is(err, domain.ErrFosterHomeNotFound):
			writeError(c, http.StatusNotFound, err)
		case errors.Is(err, domain.ErrFosterHomeSuspended):
			writeError(c, http.StatusConflict, err)
		case errors.Is(err, domain.ErrInvalidInput):
			writeError(c, http.StatusBadRequest, err)
		default:
			writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		}
		return
	}
	c.JSON(http.StatusOK, dto.ToMyFosterHomeResponse(fh))
}

// GET /api/foster-homes  (?city= &animal_type=)
func (h *FosterHomeHandler) List(c *gin.Context) {
	list, err := h.svc.GetApproved(c.Request.Context(), c.Query("city"), c.Query("animal_type"))
	if err != nil {
		writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		return
	}
	c.JSON(http.StatusOK, dto.ToFosterHomeListResponse(list))
}

// GET /api/foster-homes/:id
func (h *FosterHomeHandler) GetByID(c *gin.Context) {
	fh, err := h.svc.GetApprovedByID(c.Request.Context(), c.Param("id"))
	if err != nil {
		writeFHNotFoundOr500(c, err)
		return
	}
	c.JSON(http.StatusOK, dto.ToFosterHomeResponse(fh))
}

// POST /api/foster-homes/mine/photos  (multipart "photo")
func (h *FosterHomeHandler) UploadPhoto(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxFosterPhotoSize+1024)
	if err := c.Request.ParseMultipartForm(maxFosterPhotoSize); err != nil {
		writeError(c, http.StatusBadRequest, domain.ErrFileTooLarge)
		return
	}
	file, header, err := c.Request.FormFile("photo")
	if err != nil {
		writeError(c, http.StatusBadRequest, domain.ErrPhotoFieldRequired)
		return
	}
	defer file.Close()
	if header.Size > maxFosterPhotoSize {
		writeError(c, http.StatusBadRequest, domain.ErrFileTooLarge)
		return
	}
	buf := make([]byte, 512)
	n, _ := file.Read(buf)
	mime := strings.Split(http.DetectContentType(buf[:n]), ";")[0]
	if !allowedMIMETypes[mime] {
		writeError(c, http.StatusBadRequest, domain.ErrInvalidFileType)
		return
	}
	if _, err := file.Seek(0, 0); err != nil {
		writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		return
	}
	photo, err := h.photoSvc.Upload(c.Request.Context(), getUserID(c), file, header.Filename)
	if err != nil {
		switch {
		case errors.Is(err, domain.ErrFosterHomeNotFound):
			writeError(c, http.StatusNotFound, err)
		case errors.Is(err, domain.ErrTooManyFosterPhotos):
			writeError(c, http.StatusUnprocessableEntity, err)
		case errors.Is(err, domain.ErrStorageFailed):
			writeError(c, http.StatusBadGateway, err)
		default:
			writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		}
		return
	}
	c.JSON(http.StatusCreated, dto.FosterHomePhotoResponse{ID: photo.ID, URL: photo.URL})
}

// DELETE /api/foster-homes/mine/photos/:photoId
func (h *FosterHomeHandler) DeletePhoto(c *gin.Context) {
	if err := h.photoSvc.Delete(c.Request.Context(), getUserID(c), c.Param("photoId")); err != nil {
		switch {
		case errors.Is(err, domain.ErrFosterHomeNotFound), errors.Is(err, domain.ErrPhotoNotFound):
			writeError(c, http.StatusNotFound, err)
		default:
			writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		}
		return
	}
	c.Status(http.StatusNoContent)
}

// --- Admin ---

func (h *FosterHomeHandler) PendingQueue(c *gin.Context) {
	list, err := h.svc.GetPendingQueue(c.Request.Context())
	if err != nil {
		writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		return
	}
	c.JSON(http.StatusOK, dto.ToMyFosterHomeListResponse(list))
}

func (h *FosterHomeHandler) Approve(c *gin.Context) {
	fh, err := h.svc.Approve(c.Request.Context(), getUserID(c), c.Param("id"))
	if err != nil {
		writeFHTransitionError(c, err)
		return
	}
	c.JSON(http.StatusOK, dto.ToMyFosterHomeResponse(fh))
}

func (h *FosterHomeHandler) Reject(c *gin.Context) {
	var req dto.ReasonRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, domain.ErrRejectionReasonRequired)
		return
	}
	fh, err := h.svc.Reject(c.Request.Context(), getUserID(c), c.Param("id"), req.Reason)
	if err != nil {
		writeFHTransitionError(c, err)
		return
	}
	c.JSON(http.StatusOK, dto.ToMyFosterHomeResponse(fh))
}

func (h *FosterHomeHandler) Suspend(c *gin.Context) {
	var req dto.ReasonRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, domain.ErrSuspensionReasonRequired)
		return
	}
	fh, err := h.svc.Suspend(c.Request.Context(), getUserID(c), c.Param("id"), req.Reason)
	if err != nil {
		writeFHTransitionError(c, err)
		return
	}
	c.JSON(http.StatusOK, dto.ToMyFosterHomeResponse(fh))
}

func (h *FosterHomeHandler) Reinstate(c *gin.Context) {
	fh, err := h.svc.Reinstate(c.Request.Context(), getUserID(c), c.Param("id"))
	if err != nil {
		writeFHTransitionError(c, err)
		return
	}
	c.JSON(http.StatusOK, dto.ToMyFosterHomeResponse(fh))
}

func (h *FosterHomeHandler) ModerationLogs(c *gin.Context) {
	logs, err := h.svc.ModerationLogs(c.Request.Context(), c.Param("id"))
	if err != nil {
		writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		return
	}
	c.JSON(http.StatusOK, logs)
}

func (h *FosterHomeHandler) ChangeLogs(c *gin.Context) {
	logs, err := h.svc.ChangeLogs(c.Request.Context(), c.Param("id"))
	if err != nil {
		writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		return
	}
	c.JSON(http.StatusOK, logs)
}

func writeFHNotFoundOr500(c *gin.Context, err error) {
	if errors.Is(err, domain.ErrFosterHomeNotFound) {
		writeError(c, http.StatusNotFound, err)
		return
	}
	if errors.Is(err, domain.ErrInvalidInput) {
		writeError(c, http.StatusBadRequest, err)
		return
	}
	writeError(c, http.StatusInternalServerError, domain.ErrInternal)
}

func writeFHTransitionError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, domain.ErrFosterHomeNotFound):
		writeError(c, http.StatusNotFound, err)
	case errors.Is(err, domain.ErrInvalidFosterHomeStatus):
		writeError(c, http.StatusConflict, err)
	case errors.Is(err, domain.ErrRejectionReasonRequired), errors.Is(err, domain.ErrSuspensionReasonRequired), errors.Is(err, domain.ErrInvalidInput):
		writeError(c, http.StatusBadRequest, err)
	default:
		writeError(c, http.StatusInternalServerError, domain.ErrInternal)
	}
}
