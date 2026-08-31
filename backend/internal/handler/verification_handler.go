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

	err := h.verificationService.SendOTP(c.Request.Context(), callerID, "email")
	if err != nil {
		h.handleSendError(c, err)
		return
	}

	c.JSON(http.StatusAccepted, gin.H{"message": "código enviado"})
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
		writeError(c, http.StatusBadRequest, domain.ErrInvalidInput)
		return
	}

	err := h.verificationService.ConfirmOTP(c.Request.Context(), callerID, "email", req.Code)
	if err != nil {
		h.handleConfirmError(c, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "email verificado"})
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

// handleSendError centraliza el mapeo de errores para el endpoint de envío.
//
// Los tres 429 son deliberadamente distintos: "esperá un minuto", "terminaste por
// hoy" y "la plataforma se quedó sin presupuesto" son situaciones distintas para
// el usuario y señales distintas para nosotros. Colapsarlos sería el mismo error
// que el mensaje genérico que este handler devolvía.
func (h *VerificationHandler) handleSendError(c *gin.Context, err error) {
	if errors.Is(err, domain.ErrEmailAlreadyVerified) {
		// 409 y no 429: no se agotó ningún cupo, el pedido no tiene sentido contra
		// el estado actual de la cuenta. Tampoco es 400 — nada del request está mal
		// formado, y un Retry-After acá invitaría a reintentar algo que nunca va a
		// funcionar.
		writeError(c, http.StatusConflict, err)
		return
	}

	var rateLimitErr *service.ErrRateLimitOTP
	if errors.As(err, &rateLimitErr) {
		c.Header("Retry-After", strconv.Itoa(rateLimitErr.RetryAfter))
		writeError(c, http.StatusTooManyRequests, rateLimitErr)
		return
	}

	var dailyLimitErr *service.ErrOTPDailyLimit
	if errors.As(err, &dailyLimitErr) {
		c.Header("Retry-After", strconv.Itoa(dailyLimitErr.RetryAfter))
		writeError(c, http.StatusTooManyRequests, dailyLimitErr)
		return
	}

	if errors.Is(err, domain.ErrOTPChannelUnavailable) {
		// Sin Retry-After a propósito: cuándo se libera depende de otros usuarios,
		// así que cualquier número sería una adivinanza.
		writeError(c, http.StatusTooManyRequests, err)
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

	writeError(c, http.StatusInternalServerError, domain.ErrInternal)
}
