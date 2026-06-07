package handler

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
	"lost-pets/internal/service"
)

// VerificationHandler maneja las operaciones de verificación de identidad via OTP.
type VerificationHandler struct {
	verificationService service.VerificationService
	featureEnabled      bool
}

// NewVerificationHandler crea una instancia del VerificationHandler.
// featureEnabled controla el feature flag ENABLE_EMAIL_VERIFICATION.
func NewVerificationHandler(verificationService service.VerificationService, featureEnabled bool) *VerificationHandler {
	return &VerificationHandler{
		verificationService: verificationService,
		featureEnabled:      featureEnabled,
	}
}

// notImplemented retorna 501 cuando el feature flag está deshabilitado.
func (h *VerificationHandler) notImplemented(c *gin.Context) {
	writeError(c, http.StatusNotImplemented, domain.ErrInternal)
}

// SendEmail godoc
// POST /api/verification/send-email
func (h *VerificationHandler) SendEmail(c *gin.Context) {
	if !h.featureEnabled {
		h.notImplemented(c)
		return
	}

	callerID := getUserUUID(c)

	err := h.verificationService.SendOTP(c.Request.Context(), callerID, "email", "")
	if err != nil {
		h.handleSendError(c, err)
		return
	}

	c.JSON(http.StatusAccepted, gin.H{"message": "código enviado"})
}

// SendSMS godoc
// POST /api/verification/send-sms
func (h *VerificationHandler) SendSMS(c *gin.Context) {
	if !h.featureEnabled {
		h.notImplemented(c)
		return
	}

	callerID := getUserUUID(c)

	var req dto.SendSMSRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, err)
		return
	}

	err := h.verificationService.SendOTP(c.Request.Context(), callerID, "sms", req.Phone)
	if err != nil {
		h.handleSendError(c, err)
		return
	}

	c.JSON(http.StatusAccepted, gin.H{"message": "código SMS enviado"})
}

// ConfirmEmail godoc
// POST /api/verification/confirm-email
func (h *VerificationHandler) ConfirmEmail(c *gin.Context) {
	if !h.featureEnabled {
		h.notImplemented(c)
		return
	}

	callerID := getUserUUID(c)

	var req dto.ConfirmOTPRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, err)
		return
	}

	err := h.verificationService.ConfirmOTP(c.Request.Context(), callerID, "email", req.Code, "")
	if err != nil {
		h.handleConfirmError(c, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "email verificado"})
}

// ConfirmSMS godoc
// POST /api/verification/confirm-sms
func (h *VerificationHandler) ConfirmSMS(c *gin.Context) {
	if !h.featureEnabled {
		h.notImplemented(c)
		return
	}

	callerID := getUserUUID(c)

	var req dto.ConfirmOTPRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, err)
		return
	}

	if req.Phone == "" {
		writeError(c, http.StatusBadRequest, domain.ErrInvalidInput)
		return
	}

	err := h.verificationService.ConfirmOTP(c.Request.Context(), callerID, "sms", req.Code, req.Phone)
	if err != nil {
		h.handleConfirmError(c, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "teléfono verificado"})
}

// GetStatus godoc
// GET /api/verification/status
func (h *VerificationHandler) GetStatus(c *gin.Context) {
	if !h.featureEnabled {
		h.notImplemented(c)
		return
	}

	callerID := getUserUUID(c)
	status, err := h.verificationService.GetStatus(c.Request.Context(), callerID)
	if err != nil {
		writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		return
	}
	c.JSON(http.StatusOK, status)
}

// handleSendError centraliza el mapeo de errores para los endpoints de envío.
func (h *VerificationHandler) handleSendError(c *gin.Context, err error) {
	var rateLimitErr *service.ErrRateLimitOTP
	if errors.As(err, &rateLimitErr) {
		// 429 con Retry-After header (requerimiento de la spec)
		c.Header("Retry-After", strconv.Itoa(rateLimitErr.RetryAfter))
		c.JSON(http.StatusTooManyRequests, gin.H{
			"error":       "rate limit excedido",
			"retry_after": rateLimitErr.RetryAfter,
		})
		return
	}

	var noPhoneErr *service.ErrNoPhoneOnFile
	if errors.As(err, &noPhoneErr) {
		writeError(c, http.StatusUnprocessableEntity, noPhoneErr)
		return
	}

	var extErr *service.ErrExternalService
	if errors.As(err, &extErr) {
		// 502 Bad Gateway para fallos de proveedores externos
		writeError(c, http.StatusBadGateway, domain.ErrInternal)
		return
	}

	writeError(c, http.StatusInternalServerError, domain.ErrInternal)
}

// handleConfirmError centraliza el mapeo de errores para los endpoints de confirmación.
func (h *VerificationHandler) handleConfirmError(c *gin.Context, err error) {
	if errors.Is(err, domain.ErrOTPExpired) {
		writeError(c, http.StatusBadRequest, err)
		return
	}

	if errors.Is(err, domain.ErrOTPInvalid) {
		writeError(c, http.StatusBadRequest, err)
		return
	}

	if errors.Is(err, domain.ErrPhoneMismatch) {
		writeError(c, http.StatusBadRequest, err)
		return
	}

	writeError(c, http.StatusInternalServerError, domain.ErrInternal)
}
