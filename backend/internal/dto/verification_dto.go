package dto

// SendOTPRequest contiene el canal para enviar el OTP (email).
type SendOTPRequest struct {
	Channel string `json:"channel" binding:"required"` // solo "email"
}

// ConfirmOTPRequest contiene el canal y el código a confirmar.
// Channel es opcional: /confirm-email ya conoce el canal implícitamente.
type ConfirmOTPRequest struct {
	Channel string `json:"channel"`
	Code    string `json:"code" binding:"required"`
}

// VerificationStatusResponse indica si el email y el teléfono están verificados.
// PhoneVerified se conserva aunque la verificación por SMS ya no exista: hay
// usuarios que la completaron antes y IsVerified sigue leyéndola.
type VerificationStatusResponse struct {
	EmailVerified bool `json:"email_verified"`
	PhoneVerified bool `json:"phone_verified"`
	IsVerified    bool `json:"is_verified"`
}
