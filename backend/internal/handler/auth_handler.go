package handler

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
	"lost-pets/internal/service"
)

type AuthHandler struct {
	authService service.AuthService
}

// NewAuthHandler crea una instancia del handler con sus dependencias
func NewAuthHandler(authService service.AuthService) *AuthHandler {
	return &AuthHandler{authService: authService}
}

// Register godoc
// POST /api/auth/register
func (h *AuthHandler) Register(c *gin.Context) {
	var req dto.RegisterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, domain.ErrInvalidInput)
		return
	}

	user, token, err := h.authService.Register(c.Request.Context(), req.Email, req.Password, req.Name, req.City)
	if err != nil {
		if errors.Is(err, domain.ErrEmailAlreadyExists) {
			writeError(c, http.StatusConflict, err)
			return
		}
		writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		return
	}

	c.JSON(http.StatusCreated, dto.AuthResponse{
		User:  dto.ToUserResponse(user),
		Token: token,
	})
}

// Login godoc
// POST /api/auth/login
func (h *AuthHandler) Login(c *gin.Context) {
	var req dto.LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, domain.ErrInvalidInput)
		return
	}

	user, token, err := h.authService.Login(c.Request.Context(), req.Email, req.Password)
	if err != nil {
		if errors.Is(err, domain.ErrInvalidCredentials) {
			writeError(c, http.StatusUnauthorized, err)
			return
		}
		if errors.Is(err, domain.ErrUserBanned) {
			writeError(c, http.StatusForbidden, err)
			return
		}
		writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		return
	}

	c.JSON(http.StatusOK, dto.AuthResponse{
		User:  dto.ToUserResponse(user),
		Token: token,
	})
}

// GoogleAuth godoc
// POST /api/auth/google
// Público. Verifica un ID token de Google y devuelve una sesión nuestra.
func (h *AuthHandler) GoogleAuth(c *gin.Context) {
	var req dto.GoogleAuthRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, domain.ErrBindingFailed)
		return
	}

	user, token, isNewUser, err := h.authService.LoginWithGoogle(c.Request.Context(), req.IDToken)
	if err != nil {
		switch {
		case errors.Is(err, domain.ErrGoogleTokenInvalid), errors.Is(err, domain.ErrGoogleEmailUnverified):
			writeError(c, http.StatusUnauthorized, err)
		case errors.Is(err, domain.ErrGoogleAccountMismatch):
			writeError(c, http.StatusConflict, err)
		case errors.Is(err, domain.ErrUserBanned):
			writeError(c, http.StatusForbidden, err)
		case errors.Is(err, domain.ErrGoogleSignInUnavailable):
			writeError(c, http.StatusBadGateway, err)
		default:
			writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		}
		return
	}

	c.JSON(http.StatusOK, dto.GoogleAuthResponse{
		User:      dto.ToUserResponse(user),
		Token:     token,
		IsNewUser: isNewUser,
	})
}

// UploadProfilePhoto godoc
// POST /api/auth/me/photo
func (h *AuthHandler) UploadProfilePhoto(c *gin.Context) {
	userID, exists := c.Get("userID")
	if !exists {
		writeError(c, http.StatusUnauthorized, domain.ErrUnauthorized)
		return
	}

	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 5*1024*1024+1024)
	if err := c.Request.ParseMultipartForm(5 * 1024 * 1024); err != nil {
		writeError(c, http.StatusBadRequest, domain.ErrFileTooLarge)
		return
	}

	file, header, err := c.Request.FormFile("photo")
	if err != nil {
		writeError(c, http.StatusBadRequest, domain.ErrPhotoFieldRequired)
		return
	}
	defer file.Close()

	user, err := h.authService.UpdateProfilePhoto(c.Request.Context(), userID.(uuid.UUID), file, header.Filename)
	if err != nil {
		switch {
		case errors.Is(err, domain.ErrStorageFailed):
			writeError(c, http.StatusBadGateway, err)
		default:
			writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		}
		return
	}

	c.JSON(http.StatusOK, dto.ToUserResponse(user))
}

// UpdateMe godoc
// PUT /api/auth/me
func (h *AuthHandler) UpdateMe(c *gin.Context) {
	userID, exists := c.Get("userID")
	if !exists {
		writeError(c, http.StatusUnauthorized, domain.ErrUnauthorized)
		return
	}

	var req dto.UpdateProfileRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, domain.ErrInvalidInput)
		return
	}

	user, err := h.authService.UpdateProfile(c.Request.Context(), userID.(uuid.UUID), req.Name, req.Phone, req.City)
	if err != nil {
		if errors.Is(err, domain.ErrUserNotFound) {
			writeError(c, http.StatusNotFound, err)
			return
		}
		writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		return
	}

	c.JSON(http.StatusOK, dto.ToUserResponse(user))
}

// UpdatePreferences godoc
// PUT /api/users/me/preferences
func (h *AuthHandler) UpdatePreferences(c *gin.Context) {
	userID, exists := c.Get("userID")
	if !exists {
		writeError(c, http.StatusUnauthorized, domain.ErrUnauthorized)
		return
	}

	var req dto.UpdatePreferencesRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, domain.ErrInvalidInput)
		return
	}

	prefs, err := h.authService.UpdatePreferences(c.Request.Context(), userID.(uuid.UUID), req)
	if err != nil {
		if errors.Is(err, domain.ErrInvalidInput) {
			writeError(c, http.StatusUnprocessableEntity, domain.ErrInvalidSearchRadius)
			return
		}
		if errors.Is(err, domain.ErrUserNotFound) {
			writeError(c, http.StatusNotFound, err)
			return
		}
		writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		return
	}

	c.JSON(http.StatusOK, prefs)
}

// GetMe godoc
// GET /api/auth/me
func (h *AuthHandler) GetMe(c *gin.Context) {
	userID, exists := c.Get("userID")
	if !exists {
		writeError(c, http.StatusUnauthorized, domain.ErrUnauthorized)
		return
	}

	user, err := h.authService.GetUser(c.Request.Context(), userID.(uuid.UUID))
	if err != nil {
		if errors.Is(err, domain.ErrUserNotFound) {
			writeError(c, http.StatusNotFound, err)
			return
		}
		writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		return
	}

	c.JSON(http.StatusOK, dto.ToUserResponse(user))
}

// UpdateLocation godoc
// PATCH /api/auth/me/location
// Protegido. Setea coordenadas y/o ciudad del usuario autenticado.
func (h *AuthHandler) UpdateLocation(c *gin.Context) {
	rawID, exists := c.Get("userID")
	if !exists {
		writeError(c, http.StatusUnauthorized, domain.ErrUnauthorized)
		return
	}
	id, ok := rawID.(uuid.UUID)
	if !ok {
		writeError(c, http.StatusUnauthorized, domain.ErrUnauthorized)
		return
	}

	var req dto.UpdateLocationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, domain.ErrBindingFailed)
		return
	}

	user, err := h.authService.UpdateLocation(c.Request.Context(), id, req)
	if err != nil {
		switch {
		case errors.Is(err, domain.ErrInvalidInput):
			writeError(c, http.StatusBadRequest, err)
		case errors.Is(err, domain.ErrUserNotFound):
			writeError(c, http.StatusNotFound, err)
		default:
			writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		}
		return
	}

	c.JSON(http.StatusOK, dto.ToUserResponse(user))
}
