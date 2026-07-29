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
