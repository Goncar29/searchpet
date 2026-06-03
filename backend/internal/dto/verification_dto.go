package dto

// SendOTPRequest contiene el canal para enviar el OTP (email).
type SendOTPRequest struct {
	Channel string `json:"channel" binding:"required"` // "email" or "sms"
}

// SendSMSRequest contiene el teléfono destino para enviar el OTP por SMS.
type SendSMSRequest struct {
	Phone string `json:"phone" binding:"required"`
}

// ConfirmOTPRequest contiene el canal y el código a confirmar.
// Channel es opcional: los endpoints /email/confirm y /phone/confirm ya conocen el canal implícitamente.
// Phone es requerido para channel="sms" (validado en el handler); ignorado para channel="email".
type ConfirmOTPRequest struct {
	Channel string `json:"channel"`
	Code    string `json:"code" binding:"required"`
	Phone   string `json:"phone"`
}

// VerificationStatusResponse indica si el email y el teléfono están verificados.
type VerificationStatusResponse struct {
	EmailVerified bool `json:"email_verified"`
	PhoneVerified bool `json:"phone_verified"`
	IsVerified    bool `json:"is_verified"`
}
