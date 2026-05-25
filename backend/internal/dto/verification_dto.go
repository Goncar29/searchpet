package dto

// SendOTPRequest contiene el canal para enviar el OTP.
type SendOTPRequest struct {
	Channel string `json:"channel" binding:"required"` // "email" or "sms"
}

// ConfirmOTPRequest contiene el canal y el código a confirmar.
// Channel es opcional: los endpoints /email/confirm y /phone/confirm ya conocen el canal implícitamente.
type ConfirmOTPRequest struct {
	Channel string `json:"channel"`
	Code    string `json:"code" binding:"required"`
}

// VerificationStatusResponse indica si el email y el teléfono están verificados.
type VerificationStatusResponse struct {
	EmailVerified bool `json:"email_verified"`
	PhoneVerified bool `json:"phone_verified"`
	IsVerified    bool `json:"is_verified"`
}
