package dto

// BanUserRequest is the optional body for banning a user.
type BanUserRequest struct {
	Reason string `json:"reason" binding:"max=500"`
}
