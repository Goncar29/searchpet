package service

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"net/url"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
	"lost-pets/internal/repository"
	"lost-pets/pkg/googleauth"
	"lost-pets/pkg/jwt"
)

var reInvalidCharsUser = regexp.MustCompile(`[^a-zA-Z0-9_\-]`)

func sanitizeAvatarPublicID(userID, filename string) string {
	base := strings.TrimSuffix(filename, filepath.Ext(filename))
	base = reInvalidCharsUser.ReplaceAllString(base, "_")
	if base == "" {
		base = "avatar"
	}
	return fmt.Sprintf("users/%s/%s", userID, base)
}

type authService struct {
	userRepo  repository.UserRepository
	secretKey string
	// storage usa la interfaz ImageUploader (no el cliente concreto) igual que
	// photo_service y foster_home_photo_service: permite testear la importación
	// de la foto de Google con un uploader falso. Puede ser nil.
	storage ImageUploader
	// fosterHomeService is OPTIONAL (may be nil): when wired, UpdateProfile uses it
	// to record owner contact changes on the user's foster home forensic history.
	// A nil value makes the hook a no-op.
	fosterHomeService FosterHomeService
	// googleVerifier is OPTIONAL (may be nil): nil means GOOGLE_CLIENT_ID is not
	// configured, and LoginWithGoogle fails closed with ErrGoogleSignInUnavailable.
	googleVerifier googleauth.Verifier
	// runAsync dispara trabajo que NO debe demorar la respuesta. Es un campo para
	// que los tests lo corran inline y sean deterministas; en producción es `go f()`.
	runAsync func(func())
	// disconnectUser cierra los WebSocket vivos del usuario. OPCIONAL (puede ser
	// nil). Lo usa SOLO el descarte anti pre-hijacking de LoginWithGoogle, que
	// estampa PasswordChangedAt: eso corta los JWT pero no un socket ya abierto,
	// porque autentica una única vez con su ticket al hacer el upgrade. Función y
	// no el Hub para que esta capa siga sin conocer internal/websocket — mismo
	// criterio que password_reset_service.
	disconnectUser func(userID uuid.UUID)
}

// NewAuthService crea una instancia del servicio de auth con sus dependencias.
// fosterHomeService puede ser nil (hook de contacto es no-op en ese caso).
// googleVerifier puede ser nil (login con Google deshabilitado).
// disconnectUser puede ser nil (no se cierran sockets al descartar la contraseña).
func NewAuthService(
	userRepo repository.UserRepository,
	secretKey string,
	storage ImageUploader,
	fosterHomeService FosterHomeService,
	googleVerifier googleauth.Verifier,
	disconnectUser func(userID uuid.UUID),
) AuthService {
	return &authService{
		userRepo:          userRepo,
		secretKey:         secretKey,
		storage:           storage,
		fosterHomeService: fosterHomeService,
		googleVerifier:    googleVerifier,
		runAsync:          func(f func()) { go f() },
		disconnectUser:    disconnectUser,
	}
}

// Register crea un nuevo usuario, hashea su password y retorna el usuario + JWT
func (s *authService) Register(ctx context.Context, email, password, name, city string) (*domain.User, string, error) {
	// 1. Verificar que el email no esté en uso
	_, err := s.userRepo.GetByEmail(ctx, email)
	if err == nil {
		// Si no hubo error, el usuario ya existe
		return nil, "", domain.ErrEmailAlreadyExists
	}
	if !errors.Is(err, domain.ErrUserNotFound) {
		// Si el error es distinto a "no encontrado", es un error de BD
		return nil, "", err
	}

	// 2. Hashear el password con bcrypt
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return nil, "", domain.ErrInternal
	}

	// 3. Crear el usuario en BD
	user := &domain.User{
		Email:        email,
		PasswordHash: string(hash),
		Name:         name,
		City:         city,
	}
	if err := s.userRepo.Create(ctx, user); err != nil {
		return nil, "", err
	}

	// 4. Generar JWT
	token, err := jwt.GenerateToken(user.ID, s.secretKey)
	if err != nil {
		return nil, "", domain.ErrInternal
	}

	return user, token, nil
}

// Login verifica las credenciales del usuario y retorna el usuario + JWT
func (s *authService) Login(ctx context.Context, email, password string) (*domain.User, string, error) {
	// 1. Buscar usuario por email
	user, err := s.userRepo.GetByEmail(ctx, email)
	if err != nil {
		if errors.Is(err, domain.ErrUserNotFound) {
			// No revelamos si el email existe o no (seguridad)
			return nil, "", domain.ErrInvalidCredentials
		}
		return nil, "", err
	}

	// 2. Verificar que no esté baneado
	if user.IsBanned {
		return nil, "", domain.ErrUserBanned
	}

	// 3. Comparar el password con el hash guardado en BD
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password)); err != nil {
		return nil, "", domain.ErrInvalidCredentials
	}

	// 4. Generar JWT
	token, err := jwt.GenerateToken(user.ID, s.secretKey)
	if err != nil {
		return nil, "", domain.ErrInternal
	}

	return user, token, nil
}

// GetUser retorna los datos de un usuario por su ID
func (s *authService) GetUser(ctx context.Context, id uuid.UUID) (*domain.User, error) {
	return s.userRepo.GetByID(ctx, id)
}

// UpdateProfilePhoto sube la foto a Cloudinary y actualiza la URL en BD
func (s *authService) UpdateProfilePhoto(ctx context.Context, id uuid.UUID, file multipart.File, filename string) (*domain.User, error) {
	if s.storage == nil {
		log.Println("[auth_service] Cloudinary no configurado — no se puede subir foto de perfil")
		return nil, domain.ErrStorageFailed
	}

	user, err := s.userRepo.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}

	if seeker, ok := file.(io.Seeker); ok {
		_, _ = seeker.Seek(0, io.SeekStart)
	}

	publicID := sanitizeAvatarPublicID(id.String(), filename)
	log.Printf("[auth_service] Subiendo foto de perfil a Cloudinary — publicID: %s", publicID)

	secureURL, _, err := s.storage.UploadImage(ctx, file, publicID, "searchpet")
	if err != nil {
		log.Printf("[auth_service] Error en Cloudinary: %v", err)
		return nil, domain.ErrStorageFailed
	}

	user.ProfilePhotoURL = secureURL
	if err := s.userRepo.Update(ctx, user); err != nil {
		return nil, err
	}

	return user, nil
}

// UpdatePreferences actualiza las preferencias de búsqueda del usuario.
// Valida que SearchRadiusMeters esté en el rango 1000–50000.
func (s *authService) UpdatePreferences(ctx context.Context, id uuid.UUID, req dto.UpdatePreferencesRequest) (*dto.UserPreferencesResponse, error) {
	if req.SearchRadiusMeters < 1000 || req.SearchRadiusMeters > 50000 {
		return nil, domain.ErrInvalidInput
	}

	user, err := s.userRepo.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}

	user.SearchRadiusMeters = req.SearchRadiusMeters
	if err := s.userRepo.Update(ctx, user); err != nil {
		return nil, err
	}

	return &dto.UserPreferencesResponse{
		SearchRadiusMeters: user.SearchRadiusMeters,
	}, nil
}

// UpdateProfile actualiza el nombre y teléfono del usuario. Si el usuario dueño
// tiene un hogar transitorio, los cambios de contacto (name/phone) se registran
// en el historial forense del hogar vía RecordOwnerContactChange (best-effort:
// nunca hace fallar el update de perfil).
func (s *authService) UpdateProfile(ctx context.Context, id uuid.UUID, name, phone, city string) (*domain.User, error) {
	user, err := s.userRepo.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}
	oldName := user.Name
	oldPhone := user.Phone

	if name != "" {
		user.Name = name
	}
	user.Phone = phone
	if city != "" {
		user.City = city
	}
	if err := s.userRepo.Update(ctx, user); err != nil {
		return nil, err
	}

	if s.fosterHomeService != nil {
		changed := map[string][2]string{}
		if user.Name != oldName {
			changed["name"] = [2]string{oldName, user.Name}
		}
		if user.Phone != oldPhone {
			changed["phone"] = [2]string{oldPhone, user.Phone}
		}
		if len(changed) > 0 {
			if err := s.fosterHomeService.RecordOwnerContactChange(ctx, id, changed); err != nil {
				log.Printf("[auth_service] failed to record owner contact change for %s: %v", id, err)
			}
		}
	}

	return user, nil
}

// LoginWithGoogle resuelve un ID token de Google a una sesión nuestra.
//
// Tres caminos, en orden:
//  1. GoogleID conocido  → login de usuario que vuelve.
//  2. Email conocido     → vincula Google a la cuenta local existente.
//  3. Nada conocido      → crea el usuario.
//
// SEGURIDAD: los caminos 2 y 3 solo se alcanzan con claims.EmailVerified == true.
// Ese gate impide que un tercero reclame la cuenta de un email que NO controla.
// NO alcanza por sí solo para el camino 2: Register no exige ninguna prueba del
// email, así que una cuenta local con EmailVerified=false pudo haberla plantado
// un atacante. Por eso al vincular una cuenta no verificada se descarta su
// contraseña (ver el comentario en ese bloque).
func (s *authService) LoginWithGoogle(ctx context.Context, idToken string) (*domain.User, string, bool, error) {
	if s.googleVerifier == nil {
		log.Println("[auth_service] login con Google solicitado pero GOOGLE_CLIENT_ID no está configurado")
		return nil, "", false, domain.ErrGoogleSignInUnavailable
	}

	claims, err := s.googleVerifier.Verify(ctx, idToken)
	if err != nil {
		log.Printf("[auth_service] google: verificación de id token falló: %v", err)
		return nil, "", false, domain.ErrGoogleTokenInvalid
	}
	if !claims.EmailVerified {
		return nil, "", false, domain.ErrGoogleEmailUnverified
	}
	if claims.Sub == "" || claims.Email == "" {
		return nil, "", false, domain.ErrGoogleTokenInvalid
	}

	email := strings.ToLower(strings.TrimSpace(claims.Email))

	// 1. Usuario que vuelve — match por el `sub` estable de Google.
	existing, err := s.userRepo.GetByGoogleID(ctx, claims.Sub)
	if err == nil {
		if existing.IsBanned {
			return nil, "", false, domain.ErrUserBanned
		}
		token, err := s.issueToken(existing)
		if err != nil {
			return nil, "", false, err
		}
		return existing, token, false, nil
	}
	if !errors.Is(err, domain.ErrUserNotFound) {
		return nil, "", false, err
	}

	// 2. Cuenta local con el mismo email (verificado por Google) — vincular.
	existing, err = s.userRepo.GetByEmail(ctx, email)
	if err == nil {
		if existing.IsBanned {
			return nil, "", false, domain.ErrUserBanned
		}
		// Una cuenta ya vinculada a OTRA cuenta de Google no se re-vincula por
		// coincidencia de email: eso pasa cuando una dirección cambia de dueño
		// (buzón de Workspace reasignado, cuenta de Google borrada y reemitida).
		// Sin esto, el nuevo dueño del email se queda con la cuenta del anterior.
		if existing.GoogleID != "" && existing.GoogleID != claims.Sub {
			return nil, "", false, domain.ErrGoogleAccountMismatch
		}
		sessionsRevoked := false
		// SEGURIDAD — pre-hijacking: Register no exige ninguna prueba de que el
		// email sea tuyo, así que una cuenta con EmailVerified=false pudo haberla
		// creado un atacante con TU email y una contraseña que él eligió. Si
		// dejáramos vivir esa contraseña, al vincular te meteríamos en una cuenta
		// que el atacante también puede abrir. Se descarta: quien acaba de probar
		// el email ante Google es el dueño legítimo, y entra por Google.
		if !existing.EmailVerified {
			existing.PasswordHash = ""
			// Descartar la contraseña era media defensa: si el atacante que plantó
			// la cuenta ya tiene una sesión abierta, le sacábamos la credencial y
			// lo dejábamos adentro hasta 72h. Sellar esto la corta — middleware.Auth
			// rechaza todo JWT emitido antes de este instante.
			//
			// Truncado al segundo porque el `iat` de un JWT no tiene componente
			// sub-segundo: con microsegundos, el token que emitimos doce líneas más
			// abajo se rechazaría a sí mismo y el login con Google fallaría siempre.
			discardedAt := time.Now().Truncate(time.Second)
			existing.PasswordChangedAt = &discardedAt
			// Se recuerda en una variable porque EmailVerified se pisa a true
			// tres líneas más abajo: después de eso ya no hay forma de saber si
			// por acá se revocó algo.
			sessionsRevoked = true
		}
		existing.GoogleID = claims.Sub
		existing.EmailVerified = true
		// Invariante del codebase (verification_service.go): IsVerified es
		// EmailVerified || PhoneVerified. Sin esto, todo usuario de Google
		// quedaría sin insignia de verificado en la UI.
		existing.IsVerified = true
		// Sin esto la cuenta vinculada conservaba el método viejo (o vacío) y
		// quedaba mintiendo: el email pasó a estar verificado por Google.
		existing.VerificationMethod = googleVerificationMethod(existing.PhoneVerified)
		if err := s.userRepo.Update(ctx, existing); err != nil {
			return nil, "", false, err
		}
		// Mismo agujero que cerró la recuperación de contraseña, en el otro
		// extremo: password_changed_at invalida los JWT, pero un socket autenticó
		// UNA sola vez con su ticket al hacer el upgrade y nadie lo vuelve a
		// chequear mientras vive. Sin esto, al atacante que plantó la cuenta le
		// sacábamos la contraseña y el token, y le dejábamos la conexión abierta
		// leyendo los mensajes del dueño legítimo — la mitad de la defensa.
		//
		// Va DESPUÉS del Update y solo si hubo descarte: si el write falla no
		// cambió nada, y cortar conexiones de un login normal sería pura molestia.
		if sessionsRevoked && s.disconnectUser != nil {
			s.disconnectUser(existing.ID)
		}
		token, err := s.issueToken(existing)
		if err != nil {
			return nil, "", false, err
		}
		return existing, token, false, nil
	}
	if !errors.Is(err, domain.ErrUserNotFound) {
		return nil, "", false, err
	}

	// 3. Usuario nuevo.
	user := &domain.User{
		Email:              email,
		Name:               truncateRunes(claims.Name, userNameMaxRunes),
		GoogleID:           claims.Sub,
		PasswordHash:       "", // sin contraseña: bcrypt contra "" siempre falla → login por password bloqueado
		EmailVerified:      true,
		IsVerified:         true, // invariante: EmailVerified || PhoneVerified
		VerificationMethod: googleVerificationMethod(false),
	}
	if err := s.userRepo.Create(ctx, user); err != nil {
		return nil, "", false, err
	}

	// Foto: FUERA del camino de respuesta. Es cosmética, y bajarla + subirla a
	// Cloudinary puede tardar segundos que no tiene por qué pagar el alta. El
	// avatar aparece en el siguiente refresh del usuario.
	s.importGooglePhotoAsync(user.ID, claims.Picture)

	token, err := s.issueToken(user)
	if err != nil {
		return nil, "", false, err
	}
	return user, token, true, nil
}

// userNameMaxRunes refleja el `size:100` de User.Name. Google no acota el claim
// `name`, y un nombre más largo hacía fallar el INSERT: el alta entera moría con
// un 500 en vez de crear la cuenta con el nombre recortado.
const userNameMaxRunes = 100

// truncateRunes recorta por RUNAS, no por bytes: cortar bytes a la mitad de un
// carácter multibyte (cualquier acento o emoji en un nombre) dejaría UTF-8
// inválido en la base.
func truncateRunes(s string, max int) string {
	r := []rune(s)
	if len(r) <= max {
		return s
	}
	return string(r[:max])
}

// googleVerificationMethod mantiene el vocabulario de verification_service:
// "both" cuando también hay teléfono verificado. "google" registra CÓMO se
// verificó el email, que es lo que aporta sobre un "email" genérico.
func googleVerificationMethod(phoneVerified bool) string {
	if phoneVerified {
		return "both"
	}
	return "google"
}

// issueToken genera nuestro JWT y normaliza el error a ErrInternal.
func (s *authService) issueToken(user *domain.User) (string, error) {
	token, err := jwt.GenerateToken(user.ID, s.secretKey)
	if err != nil {
		return "", domain.ErrInternal
	}
	return token, nil
}

// googlePhotoMaxBytes acota la descarga. Los avatares de Google pesan pocos KB;
// esto es un tope de sanidad, no un límite esperado.
const googlePhotoMaxBytes = 5 << 20 // 5 MiB

// googlePhotoHost es el único host del que aceptamos descargar el avatar.
// La URL viene dentro de un token firmado por Google, pero igual la acotamos:
// si algún día Google (o un token mal validado) trajera otra URL, esto impide
// que el backend se convierta en un puente para pegarle a hosts arbitrarios.
// var (no const) para que los tests internos puedan apuntarlo a un servidor
// local; en producción nunca se reasigna.
var googlePhotoHost = ".googleusercontent.com"

func isGooglePhotoURL(u *url.URL) bool {
	return u.Scheme == "https" && strings.HasSuffix(strings.ToLower(u.Hostname()), googlePhotoHost)
}

// googlePhotoClient revalida el destino en CADA salto de redirect.
// Validar sólo la URL inicial no alcanza: el cliente HTTP de Go sigue los 3xx
// solo, hasta 10 saltos, sin volver a chequear nada — así que un redirect
// bastaría para saltear la restricción de host y usar el backend como puente
// hacia cualquier lado. Se valida dónde TERMINA el pedido, no dónde arranca.
var googlePhotoClient = &http.Client{
	CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= 5 {
			return fmt.Errorf("demasiados redirects (%d)", len(via))
		}
		if !isGooglePhotoURL(req.URL) {
			return fmt.Errorf("redirect a un destino no permitido: %s", req.URL.Host)
		}
		return nil
	},
}

// importGooglePhotoAsync lanza la importación del avatar fuera del camino de
// respuesta. No-op si no hay foto o no hay storage configurado.
func (s *authService) importGooglePhotoAsync(userID uuid.UUID, pictureURL string) {
	if pictureURL == "" || s.storage == nil {
		return
	}
	s.runAsync(func() {
		// context.Background() a propósito: el contexto del request muere apenas
		// respondemos, y este trabajo le sobrevive por diseño.
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()

		photoURL := s.importGooglePhoto(ctx, userID, pictureURL)
		if photoURL == "" {
			return
		}
		// Se RELEE el usuario en vez de reusar el de la request: Update usa Save,
		// que escribe la fila entera, así que guardar una copia vieja pisaría
		// cualquier cambio hecho mientras la foto bajaba.
		user, err := s.userRepo.GetByID(ctx, userID)
		if err != nil {
			log.Printf("[auth_service] google: no se pudo releer el usuario %s para guardar su foto: %v", userID, err)
			return
		}
		user.ProfilePhotoURL = photoURL
		if err := s.userRepo.Update(ctx, user); err != nil {
			log.Printf("[auth_service] google: no se pudo persistir la foto de perfil de %s: %v", userID, err)
		}
	})
}

// importGooglePhoto baja el avatar de Google y lo re-sube a Cloudinary, para no
// hotlinkear una URL que Google puede rotar o revocar.
//
// Best-effort por diseño: CUALQUIER falla retorna "" y el alta continúa sin foto.
// Una cuenta creada sin avatar es un problema cosmético; un alta que falla porque
// Cloudinary tuvo un mal día, no.
func (s *authService) importGooglePhoto(ctx context.Context, userID uuid.UUID, pictureURL string) string {
	if pictureURL == "" || s.storage == nil {
		return ""
	}

	parsed, err := url.Parse(pictureURL)
	if err != nil || !isGooglePhotoURL(parsed) {
		log.Printf("[auth_service] google: picture url rechazada para %s (esquema/host inesperado: %q)", userID, pictureURL)
		return ""
	}

	reqCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, pictureURL, nil)
	if err != nil {
		return ""
	}
	resp, err := googlePhotoClient.Do(req)
	if err != nil {
		log.Printf("[auth_service] google: descarga de foto falló para %s: %v", userID, err)
		return ""
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		log.Printf("[auth_service] google: descarga de foto para %s retornó %d", userID, resp.StatusCode)
		return ""
	}

	publicID := sanitizeAvatarPublicID(userID.String(), "google-avatar")
	secureURL, _, err := s.storage.UploadImage(reqCtx, io.LimitReader(resp.Body, googlePhotoMaxBytes), publicID, "searchpet")
	if err != nil {
		log.Printf("[auth_service] google: upload a Cloudinary falló para %s: %v", userID, err)
		return ""
	}
	return secureURL
}

// UpdateLocation setea la ubicación del usuario. Reutilizable: la usa el
// onboarding de Google, pero cualquier usuario puede completar su ubicación
// después desde el perfil.
func (s *authService) UpdateLocation(ctx context.Context, id uuid.UUID, req dto.UpdateLocationRequest) (*domain.User, error) {
	city := strings.TrimSpace(req.City)

	// lat/lng son un par — una sola es una coordenada rota, no un update parcial.
	if (req.Latitude == nil) != (req.Longitude == nil) {
		return nil, domain.ErrInvalidInput
	}
	if req.Latitude == nil && city == "" {
		return nil, domain.ErrInvalidInput
	}
	if req.Latitude != nil {
		if *req.Latitude < -90 || *req.Latitude > 90 || *req.Longitude < -180 || *req.Longitude > 180 {
			return nil, domain.ErrInvalidInput
		}
	}

	user, err := s.userRepo.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if req.Latitude != nil {
		user.Latitude = req.Latitude
		user.Longitude = req.Longitude
	}
	if city != "" {
		user.City = city
	}
	if err := s.userRepo.Update(ctx, user); err != nil {
		return nil, err
	}
	return user, nil
}
