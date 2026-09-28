package handler

// bcryptMaxPasswordBytes is the hard input limit of bcrypt.GenerateFromPassword.
// It is a BYTE count, which is why a DTO's rune-based `max` cannot enforce it
// (rule #36). Every handler that hashes a user-supplied password checks it
// before any state moves: AuthHandler.Register and PasswordResetHandler.ResetPassword.
const bcryptMaxPasswordBytes = 72
