package dto

// ConfirmOTPRequest contiene el código a confirmar. No lleva canal: sólo queda
// el de email y /confirm-email ya lo conoce. SendOTPRequest se fue con el mismo
// argumento — /send-email no bindea cuerpo, así que era un tipo sin llamador con
// un binding:"required" invitando a re-cablearlo.
type ConfirmOTPRequest struct {
	Code string `json:"code" binding:"required"`
}

// VerificationStatusResponse indica si el email y el teléfono están verificados.
// PhoneVerified se conserva aunque la verificación por SMS ya no exista: hay
// usuarios que la completaron antes y IsVerified sigue leyéndola.
type VerificationStatusResponse struct {
	EmailVerified bool `json:"email_verified"`
	PhoneVerified bool `json:"phone_verified"`
	IsVerified    bool `json:"is_verified"`
}
