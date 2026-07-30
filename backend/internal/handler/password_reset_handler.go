package handler

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
	"lost-pets/internal/service"
)

// forgotPasswordMessage is fixed. Deriving anything in the response from whether
// the address exists would undo the service-level enumeration defence.
const forgotPasswordMessage = "Si el email está registrado, te enviamos un código."

// bcryptMaxPasswordBytes is the hard input limit of bcrypt.GenerateFromPassword.
// It is a BYTE count, which is why the DTO's rune-based `max=72` cannot enforce it.
const bcryptMaxPasswordBytes = 72

// PasswordResetHandler expone la recuperación de contraseña. Ambas rutas son
// públicas: por definición el usuario no puede iniciar sesión.
type PasswordResetHandler struct {
	passwordResetService service.PasswordResetService
}

func NewPasswordResetHandler(s service.PasswordResetService) *PasswordResetHandler {
	return &PasswordResetHandler{passwordResetService: s}
}

// ForgotPassword godoc
// POST /api/auth/password/forgot
//
// SECURITY: responde 200 con un cuerpo fijo para email existente, inexistente,
// baneado, en cooldown o con el mailer caído. Un 500 acá aparecería SOLO para
// direcciones reales, ya que el service solo propaga un error si la falla es
// independiente de si el email existe (ver PasswordResetService.RequestReset).
func (h *PasswordResetHandler) ForgotPassword(c *gin.Context) {
	var req dto.ForgotPasswordRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, domain.ErrBindingFailed)
		return
	}

	if err := h.passwordResetService.RequestReset(c.Request.Context(), req.Email); err != nil {
		// Only reachable on infrastructure failure, which is independent of
		// whether the address exists.
		writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": forgotPasswordMessage})
}

// ResetPassword godoc
// POST /api/auth/password/reset
//
// SECURITY: no auto-login. El usuario entra con su contraseña nueva, lo que de
// paso confirma que quedó bien.
func (h *PasswordResetHandler) ResetPassword(c *gin.Context) {
	var req dto.ResetPasswordRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, domain.ErrBindingFailed)
		return
	}

	// The DTO's `max=72` counts RUNES; bcrypt's limit is 72 BYTES. Without this,
	// a 72-rune multibyte passphrase (up to 288 bytes) clears the binding, reaches
	// bcrypt inside the service, and comes back as a 500 — after IncrementAttempts
	// has already spent one of the five tries. Five of those and the token is dead,
	// with nothing on screen ever explaining why. Checked here so no state moves.
	if len(req.NewPassword) > bcryptMaxPasswordBytes {
		writeError(c, http.StatusBadRequest, domain.ErrBindingFailed)
		return
	}

	err := h.passwordResetService.ConfirmReset(c.Request.Context(), req.Email, req.Code, req.NewPassword)
	if err != nil {
		if errors.Is(err, domain.ErrOTPInvalid) {
			writeError(c, http.StatusBadRequest, err)
			return
		}
		writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "contraseña actualizada"})
}
