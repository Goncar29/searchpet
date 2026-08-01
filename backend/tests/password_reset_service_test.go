package tests

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
	"lost-pets/internal/domain"
	"lost-pets/internal/service"
)

// ============================================================
// Mocks specific to password reset (the shared ones in
// verification_service_test.go key on GetByID, this flow keys on GetByEmail).
// ============================================================

type resetUserRepo struct {
	byEmail   map[string]*domain.User
	updated   *domain.User
	updateErr error
}

func (r *resetUserRepo) Create(context.Context, *domain.User) error { return nil }
func (r *resetUserRepo) GetByID(context.Context, uuid.UUID) (*domain.User, error) {
	return nil, domain.ErrUserNotFound
}
func (r *resetUserRepo) GetByEmail(_ context.Context, email string) (*domain.User, error) {
	u, ok := r.byEmail[email]
	if !ok {
		return nil, domain.ErrUserNotFound
	}
	return u, nil
}
func (r *resetUserRepo) GetByGoogleID(context.Context, string) (*domain.User, error) {
	return nil, domain.ErrUserNotFound
}
func (r *resetUserRepo) Update(_ context.Context, u *domain.User) error {
	if r.updateErr != nil {
		return r.updateErr
	}
	r.updated = u
	return nil
}
func (r *resetUserRepo) Delete(context.Context, uuid.UUID) error { return nil }

type resetTokenRepo struct {
	active     *domain.VerificationToken
	created    []*domain.VerificationToken
	markedUsed []uuid.UUID
	attempts   int
	retiredAll int
	// Counted apart from retiredAll on purpose: ConfirmReset sweeps every code,
	// RequestReset sweeps every code EXCEPT the one it just minted. Sharing one
	// counter would let the ordering regress without a single test going red.
	retiredAllExcept int
	retiredExceptID  uuid.UUID
	// deletedIDs registra los tokens borrados: el fallo de envio los borra en vez
	// de marcarlos usados, para no gastar cupo diario con un codigo que no salio.
	deletedIDs []uuid.UUID
	// createErr, findErr and markAllUsedErr simulate an infrastructure fault
	// reachable ONLY for an account that exists — the shape that would otherwise
	// leak account existence.
	createErr            error
	findErr              error
	markAllUsedErr       error
	markAllUsedExceptErr error
	// countByUser y countGlobal manejan los dos topes diarios. Cero significa
	// "por debajo del cap", que es lo que quiere casi todo test existente.
	countByUser int64
	countGlobal int64
	countErr    error
}

func (r *resetTokenRepo) Create(_ context.Context, t *domain.VerificationToken) error {
	if r.createErr != nil {
		return r.createErr
	}
	t.ID = uuid.New()
	t.CreatedAt = time.Now()
	r.created = append(r.created, t)
	return nil
}
func (r *resetTokenRepo) FindActiveByUser(_ context.Context, _ uuid.UUID, channel string) (*domain.VerificationToken, error) {
	if r.findErr != nil {
		return nil, r.findErr
	}
	if r.active != nil && r.active.Channel == channel {
		return r.active, nil
	}
	return nil, nil
}
func (r *resetTokenRepo) MarkUsed(_ context.Context, id uuid.UUID) error {
	r.markedUsed = append(r.markedUsed, id)
	return nil
}

// Counted apart from markedUsed on purpose: MarkUsed retires one known token,
// this retires every outstanding one. Conflating them hides which guarantee a
// test is actually asserting.
func (r *resetTokenRepo) MarkAllUsedByUser(_ context.Context, _ uuid.UUID, _ string) error {
	if r.markAllUsedErr != nil {
		return r.markAllUsedErr
	}
	r.retiredAll++
	return nil
}

// The sweep RequestReset uses: everything except the code just minted. The
// exceptID is recorded so a test can prove the survivor is the NEW token and not
// whatever row happened to be lying around.
func (r *resetTokenRepo) MarkAllUsedByUserExcept(_ context.Context, _ uuid.UUID, _ string, exceptID uuid.UUID) error {
	if r.markAllUsedExceptErr != nil {
		return r.markAllUsedExceptErr
	}
	r.retiredAllExcept++
	r.retiredExceptID = exceptID
	return nil
}
func (r *resetTokenRepo) IncrementAttempts(context.Context, uuid.UUID) (int, error) {
	r.attempts++
	return r.attempts, nil
}
func (r *resetTokenRepo) DeleteByID(_ context.Context, id uuid.UUID) error {
	r.deletedIDs = append(r.deletedIDs, id)
	return nil
}
func (r *resetTokenRepo) DeleteExpired(context.Context) (int64, error) { return 0, nil }

func (r *resetTokenRepo) CountSince(_ context.Context, userID *uuid.UUID, _ string, _ time.Time) (int64, error) {
	if r.countErr != nil {
		return 0, r.countErr
	}
	if userID == nil {
		return r.countGlobal, nil
	}
	return r.countByUser, nil
}

type recordingMailer struct {
	sentTo   string
	sentCode string
	err      error
}

func (m *recordingMailer) SendOTP(context.Context, string, string) error { return nil }
func (m *recordingMailer) SendPasswordReset(_ context.Context, to, code string) error {
	m.sentTo, m.sentCode = to, code
	return m.err
}

// newResetSvc builds the service with runAsync inlined so tests are deterministic.
// disconnectUser is nil here: most cases do not care, and the service treats it as
// optional. Use newResetSvcWithDisconnect when the socket teardown is the subject.
func newResetSvc(users *resetUserRepo, tokens *resetTokenRepo, m *recordingMailer) service.PasswordResetService {
	return service.NewPasswordResetServiceForTest(tokens, users, m, func(f func()) { f() }, nil, nil)
}

// newResetSvcWithDisconnect records which users had their live sockets closed.
func newResetSvcWithDisconnect(
	users *resetUserRepo, tokens *resetTokenRepo, m *recordingMailer, disconnected *[]uuid.UUID,
) service.PasswordResetService {
	return service.NewPasswordResetServiceForTest(tokens, users, m, func(f func()) { f() },
		func(userID uuid.UUID) { *disconnected = append(*disconnected, userID) }, nil)
}

// newResetSvcWithSleep records the timing pad instead of serving it, so the
// enumeration mitigation can be asserted without the suite actually waiting.
func newResetSvcWithSleep(
	users *resetUserRepo, tokens *resetTokenRepo, m *recordingMailer, slept *[]time.Duration,
) service.PasswordResetService {
	return service.NewPasswordResetServiceForTest(tokens, users, m, func(f func()) { f() }, nil,
		func(d time.Duration) { *slept = append(*slept, d) })
}

func knownUser(email string) *resetUserRepo {
	return &resetUserRepo{byEmail: map[string]*domain.User{
		email: {ID: uuid.New(), Email: email, PasswordHash: "old-hash"},
	}}
}

// ============================================================
// RequestReset — enumeration resistance
// ============================================================

func TestRequestReset_UnknownEmail_NoTokenNoMailNoError(t *testing.T) {
	users := &resetUserRepo{byEmail: map[string]*domain.User{}}
	tokens := &resetTokenRepo{}
	m := &recordingMailer{}

	if err := newResetSvc(users, tokens, m).RequestReset(context.Background(), "ghost@example.com"); err != nil {
		t.Fatalf("unknown email must not surface an error, got %v", err)
	}
	if len(tokens.created) != 0 {
		t.Fatal("no token may be created for an unknown address")
	}
	if m.sentTo != "" {
		t.Fatal("no mail may be sent to an unknown address")
	}
}

func TestRequestReset_BannedUser_NoTokenNoMailNoError(t *testing.T) {
	users := knownUser("banned@example.com")
	users.byEmail["banned@example.com"].IsBanned = true
	tokens := &resetTokenRepo{}
	m := &recordingMailer{}

	if err := newResetSvc(users, tokens, m).RequestReset(context.Background(), "banned@example.com"); err != nil {
		t.Fatalf("banned user must be indistinguishable from success, got %v", err)
	}
	if len(tokens.created) != 0 || m.sentTo != "" {
		t.Fatal("a banned user must produce neither a token nor a mail")
	}
}

func TestRequestReset_WithinCooldown_SwallowsRateLimit(t *testing.T) {
	users := knownUser("user@example.com")
	tokens := &resetTokenRepo{active: &domain.VerificationToken{
		ID:        uuid.New(),
		Channel:   "password_reset",
		CreatedAt: time.Now().Add(-10 * time.Second), // inside the 60s window
		ExpiresAt: time.Now().Add(9 * time.Minute),
	}}
	m := &recordingMailer{}

	// Surfacing the rate limit would leak existence: only real accounts can hit it.
	if err := newResetSvc(users, tokens, m).RequestReset(context.Background(), "user@example.com"); err != nil {
		t.Fatalf("cooldown must be swallowed, got %v", err)
	}
	if len(tokens.created) != 0 || m.sentTo != "" {
		t.Fatal("cooldown must suppress both the token and the mail")
	}
}

func TestRequestReset_HappyPath_CreatesTokenAndSends(t *testing.T) {
	users := knownUser("user@example.com")
	tokens := &resetTokenRepo{}
	m := &recordingMailer{}

	if err := newResetSvc(users, tokens, m).RequestReset(context.Background(), "user@example.com"); err != nil {
		t.Fatalf("RequestReset: %v", err)
	}
	if len(tokens.created) != 1 {
		t.Fatalf("created %d tokens, want 1", len(tokens.created))
	}
	tok := tokens.created[0]
	if tok.Channel != "password_reset" {
		t.Fatalf("channel = %q, want password_reset", tok.Channel)
	}
	if tok.CodeHash == "" || len(tok.CodeHash) != 64 {
		t.Fatalf("CodeHash = %q, want a 64-char sha256 hex", tok.CodeHash)
	}
	if m.sentTo != "user@example.com" {
		t.Fatalf("sentTo = %q", m.sentTo)
	}
	if len(m.sentCode) != 6 {
		t.Fatalf("sentCode = %q, want 6 digits", m.sentCode)
	}
	// The plaintext code must never be persisted.
	if tok.CodeHash == m.sentCode {
		t.Fatal("the token stores the plaintext code")
	}
}

func TestRequestReset_MailFailure_StillReturnsNilAndFreesTheCooldown(t *testing.T) {
	users := knownUser("user@example.com")
	tokens := &resetTokenRepo{}
	m := &recordingMailer{err: errors.New("brevo down")}

	// A 502 here would appear ONLY for addresses that exist.
	if err := newResetSvc(users, tokens, m).RequestReset(context.Background(), "user@example.com"); err != nil {
		t.Fatalf("mail failure must not reach the caller, got %v", err)
	}
	// El mecanismo cambio: antes se marcaba usado, ahora se BORRA. La intencion es
	// la misma —que el cooldown de 60s no bloquee el reintento de algo que nunca
	// llego— pero marcarlo dejaba la fila contando para el cupo diario, porque
	// CountSince ignora `used`. Ver TestRequestReset_FailedSendDoesNotBurnTheDailyQuota.
	if len(tokens.deletedIDs) != 1 {
		t.Fatal("un envio fallido tiene que sacar el token para que el cooldown de 60s no bloquee el reintento")
	}
}

// ============================================================
// ConfirmReset — every failure collapses into one error
// ============================================================

// activeResetToken builds a live password_reset token whose code is `code`.
func activeResetToken(code string) *domain.VerificationToken {
	return &domain.VerificationToken{
		ID:        uuid.New(),
		Channel:   "password_reset",
		CodeHash:  hashCode(code), // helper from verification_service_test.go
		ExpiresAt: time.Now().Add(10 * time.Minute),
		CreatedAt: time.Now(),
	}
}

// TestConfirmReset_AllFailuresReturnTheSameError asserts a SAMENESS property, and
// sameness is trivially satisfied by a function that always returns ErrOTPInvalid —
// this test passed unchanged against the Task 6 stub that did exactly that. What
// gives it teeth is TestConfirmReset_HappyPath and _GoogleOnlyUserGetsAPassword
// forcing the success path to exist and be reachable; only then does "every failure
// collapses to one error" constrain anything. If you ever weaken those two, this
// test keeps passing while guaranteeing nothing. Do not read it in isolation.
func TestConfirmReset_AllFailuresReturnTheSameError(t *testing.T) {
	cases := []struct {
		name   string
		users  *resetUserRepo
		tokens *resetTokenRepo
		email  string
		code   string
	}{
		{
			name:   "wrong code",
			users:  knownUser("user@example.com"),
			tokens: &resetTokenRepo{active: activeResetToken("111111")},
			email:  "user@example.com",
			code:   "999999",
		},
		{
			name:  "expired token",
			users: knownUser("user@example.com"),
			tokens: func() *resetTokenRepo {
				tok := activeResetToken("111111")
				tok.ExpiresAt = time.Now().Add(-time.Minute)
				return &resetTokenRepo{active: tok}
			}(),
			email: "user@example.com",
			code:  "111111",
		},
		{
			name:   "no active token",
			users:  knownUser("user@example.com"),
			tokens: &resetTokenRepo{},
			email:  "user@example.com",
			code:   "111111",
		},
		{
			name:   "unknown email",
			users:  &resetUserRepo{byEmail: map[string]*domain.User{}},
			tokens: &resetTokenRepo{active: activeResetToken("111111")},
			email:  "ghost@example.com",
			code:   "111111",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			svc := newResetSvc(tc.users, tc.tokens, &recordingMailer{})
			err := svc.ConfirmReset(context.Background(), tc.email, tc.code, "newpassword")

			// Distinguishing these lets an attacker probe which accounts exist:
			// request a reset, wait past the TTL, submit garbage — an "expired"
			// answer proves the address is registered.
			if !errors.Is(err, domain.ErrOTPInvalid) {
				t.Fatalf("err = %v, want domain.ErrOTPInvalid for every failure mode", err)
			}
			if tc.users.updated != nil {
				t.Fatal("no password may be written on a failed reset")
			}
		})
	}
}

func TestConfirmReset_SixthAttemptInvalidatesTheToken(t *testing.T) {
	users := knownUser("user@example.com")
	tokens := &resetTokenRepo{active: activeResetToken("111111"), attempts: 5}
	svc := newResetSvc(users, tokens, &recordingMailer{})

	// Even with the RIGHT code: the cap has been spent.
	err := svc.ConfirmReset(context.Background(), "user@example.com", "111111", "newpassword")

	if !errors.Is(err, domain.ErrOTPInvalid) {
		t.Fatalf("err = %v, want domain.ErrOTPInvalid", err)
	}
	if len(tokens.markedUsed) != 1 {
		t.Fatal("exceeding the attempt cap must invalidate the token")
	}
}

func TestConfirmReset_HappyPath_SetsHashAndStampsPasswordChangedAt(t *testing.T) {
	users := knownUser("user@example.com")
	tokens := &resetTokenRepo{active: activeResetToken("111111")}
	svc := newResetSvc(users, tokens, &recordingMailer{})

	before := time.Now().Add(-time.Second)
	if err := svc.ConfirmReset(context.Background(), "user@example.com", "111111", "newpassword"); err != nil {
		t.Fatalf("ConfirmReset: %v", err)
	}

	got := users.updated
	if got == nil {
		t.Fatal("the user was never updated")
	}
	if got.PasswordHash == "old-hash" {
		t.Fatal("the password hash was not replaced")
	}
	if err := bcrypt.CompareHashAndPassword([]byte(got.PasswordHash), []byte("newpassword")); err != nil {
		t.Fatalf("the stored hash does not match the new password: %v", err)
	}
	if got.PasswordChangedAt == nil {
		t.Fatal("PasswordChangedAt was not stamped — sessions would survive the reset")
	}
	if got.PasswordChangedAt.Before(before) {
		t.Fatalf("PasswordChangedAt = %v, want roughly now", got.PasswordChangedAt)
	}
	// Truncation matters: a JWT's iat has second granularity, so a sub-second
	// value here would make a freshly issued token reject itself.
	if got.PasswordChangedAt.Nanosecond() != 0 {
		t.Fatalf("PasswordChangedAt = %v, want it truncated to the second", got.PasswordChangedAt)
	}
	if tokens.retiredAll != 1 {
		t.Fatal("the token must be single-use, and every outstanding code retired with it")
	}
}

func TestConfirmReset_GoogleOnlyUserGetsAPassword(t *testing.T) {
	// The case that motivated the whole feature: LoginWithGoogle discards the
	// hash when linking an unverified account (rule #25), leaving the legitimate
	// owner Google-only with no way back.
	users := knownUser("user@example.com")
	users.byEmail["user@example.com"].PasswordHash = ""
	tokens := &resetTokenRepo{active: activeResetToken("111111")}
	svc := newResetSvc(users, tokens, &recordingMailer{})

	if err := svc.ConfirmReset(context.Background(), "user@example.com", "111111", "newpassword"); err != nil {
		t.Fatalf("ConfirmReset: %v", err)
	}
	if users.updated == nil || users.updated.PasswordHash == "" {
		t.Fatal("a Google-only account must come out of this with a usable password")
	}
}

func TestConfirmReset_MarksTheEmailVerified(t *testing.T) {
	// Not cosmetic, and not a nice-to-have. Register never asks for proof of the
	// address, so EmailVerified=false is the COMMON case. auth_service.go blanks
	// PasswordHash for any unverified account that later links a Google identity
	// (the pre-hijacking defence, rule #25) — so without this the user recovers
	// their password and then silently loses it on their next Google sign-in,
	// landing back in the Google-only hole this whole flow exists to close.
	// Redeeming the OTP proves control of the mailbox exactly as strongly as the
	// verification flow does, so the flag is earned.
	users := knownUser("user@example.com")
	users.byEmail["user@example.com"].EmailVerified = false
	users.byEmail["user@example.com"].IsVerified = false
	tokens := &resetTokenRepo{active: activeResetToken("111111")}
	svc := newResetSvc(users, tokens, &recordingMailer{})

	if err := svc.ConfirmReset(context.Background(), "user@example.com", "111111", "newpassword"); err != nil {
		t.Fatalf("ConfirmReset: %v", err)
	}
	if users.updated == nil {
		t.Fatal("no user was written")
	}
	if !users.updated.EmailVerified {
		t.Fatal("EmailVerified must be set — otherwise a later Google sign-in discards this password")
	}
	// Codebase invariant (verification_service.go): IsVerified is the OR of the
	// two channels and VerificationMethod names the confirmed ones. Setting the
	// flag without these leaves the user in a state no other flow can produce.
	if !users.updated.IsVerified {
		t.Fatal("IsVerified must follow EmailVerified")
	}
	if users.updated.VerificationMethod != "email" {
		t.Fatalf("VerificationMethod = %q, want \"email\"", users.updated.VerificationMethod)
	}
}

func TestConfirmReset_KeepsBothWhenThePhoneWasAlreadyVerified(t *testing.T) {
	// The other half of the invariant: verifying the email must not erase a
	// phone verification the user already had.
	users := knownUser("user@example.com")
	users.byEmail["user@example.com"].EmailVerified = false
	users.byEmail["user@example.com"].PhoneVerified = true
	tokens := &resetTokenRepo{active: activeResetToken("111111")}
	svc := newResetSvc(users, tokens, &recordingMailer{})

	if err := svc.ConfirmReset(context.Background(), "user@example.com", "111111", "newpassword"); err != nil {
		t.Fatalf("ConfirmReset: %v", err)
	}
	if users.updated.VerificationMethod != "both" {
		t.Fatalf("VerificationMethod = %q, want \"both\"", users.updated.VerificationMethod)
	}
}

func TestConfirmReset_ClosesLiveSockets(t *testing.T) {
	// password_changed_at cuts every JWT, but a WebSocket authenticates ONCE with
	// a ticket at upgrade time and is never re-checked (internal/websocket). So
	// without this, whoever is already holding an open socket keeps receiving the
	// victim's messages indefinitely after the reset — the exact access the reset
	// exists to revoke. The 30s ticket TTL only bounds NEW connections.
	users := knownUser("user@example.com")
	tokens := &resetTokenRepo{active: activeResetToken("111111")}
	var disconnected []uuid.UUID
	svc := newResetSvcWithDisconnect(users, tokens, &recordingMailer{}, &disconnected)

	if err := svc.ConfirmReset(context.Background(), "user@example.com", "111111", "newpassword"); err != nil {
		t.Fatalf("ConfirmReset: %v", err)
	}
	if len(disconnected) != 1 {
		t.Fatalf("disconnected %d users, want 1 — live sockets survive the reset", len(disconnected))
	}
	if disconnected[0] != users.byEmail["user@example.com"].ID {
		t.Fatalf("disconnected %v, want the account being reset", disconnected[0])
	}
}

func TestConfirmReset_WrongCodeLeavesSocketsAlone(t *testing.T) {
	// The other direction, and the reason the call sits AFTER the write instead of
	// before it: a failed attempt must not kick the legitimate owner off their own
	// connections. Otherwise anyone could disrupt a session by guessing codes.
	users := knownUser("user@example.com")
	tokens := &resetTokenRepo{active: activeResetToken("111111")}
	var disconnected []uuid.UUID
	svc := newResetSvcWithDisconnect(users, tokens, &recordingMailer{}, &disconnected)

	err := svc.ConfirmReset(context.Background(), "user@example.com", "999999", "newpassword")
	if !errors.Is(err, domain.ErrOTPInvalid) {
		t.Fatalf("err = %v, want domain.ErrOTPInvalid", err)
	}
	if len(disconnected) != 0 {
		t.Fatal("a wrong code must not disconnect anyone")
	}
}

func TestConfirmReset_FailedWriteLeavesSocketsAlone(t *testing.T) {
	// If the password never changed, the old credentials still work, so tearing
	// down the sockets would be pure disruption with no security gain.
	users := knownUser("user@example.com")
	users.updateErr = errors.New("users is unavailable")
	tokens := &resetTokenRepo{active: activeResetToken("111111")}
	var disconnected []uuid.UUID
	svc := newResetSvcWithDisconnect(users, tokens, &recordingMailer{}, &disconnected)

	if err := svc.ConfirmReset(context.Background(), "user@example.com", "111111", "newpassword"); !errors.Is(err, domain.ErrOTPInvalid) {
		t.Fatalf("err = %v, want domain.ErrOTPInvalid", err)
	}
	if len(disconnected) != 0 {
		t.Fatal("a failed password write must not disconnect anyone")
	}
}

func TestConfirmReset_RejectsATokenFromAnotherChannel(t *testing.T) {
	users := knownUser("user@example.com")
	// An email-verification token must never be spendable on a reset.
	tok := activeResetToken("111111")
	tok.Channel = "email"
	tokens := &resetTokenRepo{active: tok}
	svc := newResetSvc(users, tokens, &recordingMailer{})

	err := svc.ConfirmReset(context.Background(), "user@example.com", "111111", "newpassword")
	if !errors.Is(err, domain.ErrOTPInvalid) {
		t.Fatalf("err = %v, want domain.ErrOTPInvalid", err)
	}
}

// ============================================================
// Infrastructure faults must not become an existence oracle
//
// Every error site AFTER the user lookup is reachable only for an account that
// exists — they sit past the not-found and banned returns. A distinguishable
// status there would let a caller tell a registered address from an invented one,
// which is cheaper to exploit than the timing channel runAsync exists to close.
// ============================================================

func TestRequestReset_TokenCreateFailure_StillReturnsNil(t *testing.T) {
	users := knownUser("user@example.com")
	tokens := &resetTokenRepo{createErr: errors.New("verification_tokens is locked")}
	m := &recordingMailer{}

	if err := newResetSvc(users, tokens, m).RequestReset(context.Background(), "user@example.com"); err != nil {
		t.Fatalf("a write failure must not reach the caller, got %v", err)
	}
	if m.sentTo != "" {
		t.Fatal("no mail may be sent when the token was never stored")
	}
}

func TestRequestReset_TokenLookupFailure_StillReturnsNil(t *testing.T) {
	users := knownUser("user@example.com")
	tokens := &resetTokenRepo{findErr: errors.New("db down")}

	if err := newResetSvc(users, tokens, &recordingMailer{}).RequestReset(context.Background(), "user@example.com"); err != nil {
		t.Fatalf("a lookup failure must not reach the caller, got %v", err)
	}
}

func TestRequestReset_InfrastructureFaultIsIndistinguishableFromUnknownAddress(t *testing.T) {
	// The whole point, asserted directly: the caller cannot tell these apart.
	real := newResetSvc(
		knownUser("user@example.com"),
		&resetTokenRepo{createErr: errors.New("verification_tokens is locked")},
		&recordingMailer{},
	).RequestReset(context.Background(), "user@example.com")

	fake := newResetSvc(
		&resetUserRepo{byEmail: map[string]*domain.User{}},
		&resetTokenRepo{},
		&recordingMailer{},
	).RequestReset(context.Background(), "ghost@example.com")

	if real != nil || fake != nil {
		t.Fatalf("registered address returned %v, unknown returned %v — both must be nil", real, fake)
	}
}

func TestConfirmReset_TokenLookupFailure_ReturnsOTPInvalidNotADistinctError(t *testing.T) {
	users := knownUser("user@example.com")
	tokens := &resetTokenRepo{findErr: errors.New("db down")}

	err := newResetSvc(users, tokens, &recordingMailer{}).
		ConfirmReset(context.Background(), "user@example.com", "111111", "newpassword")

	if !errors.Is(err, domain.ErrOTPInvalid) {
		t.Fatalf("err = %v, want domain.ErrOTPInvalid — a 500 here would only appear for real accounts", err)
	}
	if users.updated != nil {
		t.Fatal("no password may be written when the token could not be read")
	}
}

func TestConfirmReset_PasswordWriteFailure_ReturnsOTPInvalid(t *testing.T) {
	users := knownUser("user@example.com")
	users.updateErr = errors.New("db down")
	tokens := &resetTokenRepo{active: activeResetToken("111111")}

	err := newResetSvc(users, tokens, &recordingMailer{}).
		ConfirmReset(context.Background(), "user@example.com", "111111", "newpassword")

	if !errors.Is(err, domain.ErrOTPInvalid) {
		t.Fatalf("err = %v, want domain.ErrOTPInvalid", err)
	}
	// The token was spent before the write was attempted, so it cannot be replayed.
	if tokens.retiredAll != 1 {
		t.Fatal("the token must be consumed before the password write is attempted")
	}
}

func TestConfirmReset_BannedUserCannotSetAPassword(t *testing.T) {
	// The single line between a banned account and a working password.
	users := knownUser("banned@example.com")
	users.byEmail["banned@example.com"].IsBanned = true
	tokens := &resetTokenRepo{active: activeResetToken("111111")}

	err := newResetSvc(users, tokens, &recordingMailer{}).
		ConfirmReset(context.Background(), "banned@example.com", "111111", "newpassword")

	if !errors.Is(err, domain.ErrOTPInvalid) {
		t.Fatalf("err = %v, want domain.ErrOTPInvalid", err)
	}
	if users.updated != nil {
		t.Fatal("a banned user must not come out of this with a usable password")
	}
	if len(tokens.markedUsed) != 0 || tokens.attempts != 0 {
		t.Fatal("a banned user must not consume the token or an attempt")
	}
}

// ============================================================
// RequestReset — a new code retires the previous one
// ============================================================

func TestRequestReset_PastCooldown_RetiresThePreviousCodeBeforeMintingANewOne(t *testing.T) {
	users := knownUser("user@example.com")
	previous := &domain.VerificationToken{
		ID:        uuid.New(),
		Channel:   "password_reset",
		CreatedAt: time.Now().Add(-2 * time.Minute), // past the 60s cooldown
		ExpiresAt: time.Now().Add(8 * time.Minute),  // but still inside its 10min TTL
	}
	tokens := &resetTokenRepo{active: previous}
	m := &recordingMailer{}

	if err := newResetSvc(users, tokens, m).RequestReset(context.Background(), "user@example.com"); err != nil {
		t.Fatalf("RequestReset() = %v, want nil", err)
	}

	if len(tokens.created) != 1 {
		t.Fatalf("created %d tokens, want 1", len(tokens.created))
	}
	// Without this sweep the previous code stays used=false and unexpired, but
	// FindActiveByUser only ever returns the newest row — so it is unspendable
	// while still looking valid to the person holding that first email.
	if tokens.retiredAllExcept != 1 {
		t.Fatal("requesting a new code must retire the outstanding ones")
	}
	// The survivor has to be the code we just minted. A sweep that spares the
	// wrong row would still increment the counter above.
	if tokens.retiredExceptID != tokens.created[0].ID {
		t.Fatalf("spared token %v, want the freshly minted %v", tokens.retiredExceptID, tokens.created[0].ID)
	}
}

func TestRequestReset_RetireFailure_StillMintsAndMailsTheNewCode(t *testing.T) {
	// This test used to assert the exact opposite — that a failed retire minted
	// nothing and mailed nothing. That was the defect written down as a contract:
	// it left the user with ZERO usable codes while /forgot still answered "we
	// sent you a code". The sweep is now a best-effort cleanup that runs AFTER the
	// mint, so losing it degrades to the previous code staying alive until its
	// TTL — annoying, and strictly better than locking the user out of recovery.
	users := knownUser("user@example.com")
	tokens := &resetTokenRepo{markAllUsedExceptErr: errors.New("verification_tokens is locked")}
	m := &recordingMailer{}

	// Same enumeration rule as every other post-lookup failure: this path is only
	// reachable for an account that exists, so it must not surface an error.
	if err := newResetSvc(users, tokens, m).RequestReset(context.Background(), "user@example.com"); err != nil {
		t.Fatalf("RequestReset() = %v, want nil", err)
	}
	if len(tokens.created) != 1 {
		t.Fatalf("created %d tokens, want 1 — a failed cleanup must not cost the user their code", len(tokens.created))
	}
	if m.sentTo != "user@example.com" {
		t.Fatalf("mailed %q, want the code to go out anyway", m.sentTo)
	}
}

func TestRequestReset_PadsBothTheKnownAndUnknownPathsToTheSameFloor(t *testing.T) {
	// The enumeration defence runAsync did not finish. Detaching the mail send
	// removed ~300-500ms from the registered path, but the DATABASE work stayed:
	// a real address costs GetByEmail + FindActiveByUser + Create + the sweep,
	// four round trips with two writes, against a single read for an invented one.
	// On a remote managed Postgres that is measurable. Both paths must therefore
	// leave through the same floor.
	//
	// The assertion is on the padded TOTAL, never on the sleep duration itself:
	// the sleep is exactly the complement of however long the work took, so
	// comparing the two sleeps directly would just re-measure the leak.
	var knownSlept, unknownSlept []time.Duration

	known := knownUser("user@example.com")
	if err := newResetSvcWithSleep(known, &resetTokenRepo{}, &recordingMailer{}, &knownSlept).
		RequestReset(context.Background(), "user@example.com"); err != nil {
		t.Fatalf("RequestReset(known) = %v, want nil", err)
	}

	unknown := knownUser("someone-else@example.com")
	if err := newResetSvcWithSleep(unknown, &resetTokenRepo{}, &recordingMailer{}, &unknownSlept).
		RequestReset(context.Background(), "nobody@example.com"); err != nil {
		t.Fatalf("RequestReset(unknown) = %v, want nil", err)
	}

	if len(knownSlept) != 1 {
		t.Fatalf("registered address padded %d times, want exactly 1", len(knownSlept))
	}
	if len(unknownSlept) != 1 {
		t.Fatalf("unknown address padded %d times, want exactly 1 — this is the path that "+
			"returns early, and an unpadded early return is the whole oracle", len(unknownSlept))
	}
}

func TestRequestReset_CreateFailure_LeavesTheExistingCodeAlone(t *testing.T) {
	// The ordering guarantee, stated from the other side. When the mint fails the
	// sweep must never have run, so whatever code the user is already holding
	// keeps working. Retiring first meant a transient Create error silently
	// stripped the user of every valid code — and let anyone who knew the address
	// deny recovery indefinitely by polling /forgot.
	users := knownUser("user@example.com")
	tokens := &resetTokenRepo{createErr: errors.New("verification_tokens is unavailable")}
	m := &recordingMailer{}

	if err := newResetSvc(users, tokens, m).RequestReset(context.Background(), "user@example.com"); err != nil {
		t.Fatalf("RequestReset() = %v, want nil", err)
	}
	if tokens.retiredAllExcept != 0 || tokens.retiredAll != 0 {
		t.Fatal("a failed mint must not retire anything — the user keeps the code they have")
	}
	if m.sentTo != "" {
		t.Fatal("no code was minted, so nothing may be mailed")
	}
}

func TestRequestReset_PerAccountDailyCap(t *testing.T) {
	// El unico freno por cuenta que existia era el cooldown de 60s: 1440 mails
	// por dia contra una sola direccion, sobre los 300/dia de Brevo que se
	// COMPARTEN con la verificacion de email.
	users := knownUser("user@example.com")
	tokens := &resetTokenRepo{countByUser: 3} // ya en el tope
	m := &recordingMailer{}

	// Devuelve nil igual que todo lo demas: cualquier diferencia observable seria
	// un oraculo de existencia de cuenta.
	if err := newResetSvc(users, tokens, m).RequestReset(context.Background(), "user@example.com"); err != nil {
		t.Fatalf("RequestReset() = %v, want nil", err)
	}
	if len(tokens.created) != 0 {
		t.Fatalf("acuno %d tokens, want 0 — el cap no freno nada", len(tokens.created))
	}
	if m.sentTo != "" {
		t.Fatal("no se acuno codigo, asi que no se puede mandar mail")
	}
}

func TestRequestReset_UnderThePerAccountCapStillWorks(t *testing.T) {
	users := knownUser("user@example.com")
	tokens := &resetTokenRepo{countByUser: 2} // uno por debajo
	m := &recordingMailer{}

	if err := newResetSvc(users, tokens, m).RequestReset(context.Background(), "user@example.com"); err != nil {
		t.Fatalf("RequestReset() = %v, want nil", err)
	}
	if len(tokens.created) != 1 {
		t.Fatalf("acuno %d tokens, want 1 — el cap frena de mas", len(tokens.created))
	}
	if m.sentTo != "user@example.com" {
		t.Fatalf("mailed %q, want user@example.com", m.sentTo)
	}
}

func TestRequestReset_CountFailureFailsClosed(t *testing.T) {
	// Un fallo del conteo no puede abrir la puerta: sin numero no hay tope.
	users := knownUser("user@example.com")
	tokens := &resetTokenRepo{countErr: errors.New("verification_tokens is unavailable")}
	m := &recordingMailer{}

	if err := newResetSvc(users, tokens, m).RequestReset(context.Background(), "user@example.com"); err != nil {
		t.Fatalf("RequestReset() = %v, want nil", err)
	}
	if len(tokens.created) != 0 || m.sentTo != "" {
		t.Fatal("si el conteo falla no se acuna ni se manda nada")
	}
}

func TestRequestReset_GlobalDailyReserve(t *testing.T) {
	// Un usuario POR DEBAJO de su cap igual queda frenado si el canal agoto la
	// reserva. Esa es la unica capa que garantiza que la verificacion de email no
	// se caiga para toda la plataforma por culpa de los resets.
	users := knownUser("user@example.com")
	tokens := &resetTokenRepo{countByUser: 0, countGlobal: 50}
	m := &recordingMailer{}

	if err := newResetSvc(users, tokens, m).RequestReset(context.Background(), "user@example.com"); err != nil {
		t.Fatalf("RequestReset() = %v, want nil", err)
	}
	if len(tokens.created) != 0 {
		t.Fatalf("acuno %d tokens, want 0 — la reserva global no freno nada", len(tokens.created))
	}
	if m.sentTo != "" {
		t.Fatal("reserva agotada: no se puede mandar mail")
	}
}

func TestRequestReset_FailedSendDoesNotBurnTheDailyQuota(t *testing.T) {
	// Un envio fallido no entrego nada, asi que su fila no puede gastar cupo.
	// Antes se marcaba usada: eso liberaba el cooldown pero CountSince ignora `used`
	// a proposito, con lo cual seguia contando. Tres caidas seguidas del proveedor
	// —el 401 de Brevo por Authorized IPs de la regla #24— dejaban al usuario sin
	// recuperacion 24h sin haber recibido un solo mail, y /forgot igual le decia
	// que le habia mandado un codigo.
	users := knownUser("user@example.com")
	tokens := &resetTokenRepo{}
	m := &recordingMailer{err: errors.New("brevo returned status 401")}

	if err := newResetSvc(users, tokens, m).RequestReset(context.Background(), "user@example.com"); err != nil {
		t.Fatalf("RequestReset() = %v, want nil", err)
	}
	if len(tokens.created) != 1 {
		t.Fatalf("acuno %d tokens, want 1", len(tokens.created))
	}
	if len(tokens.deletedIDs) != 1 {
		t.Fatalf("borro %d tokens tras el fallo de envio, want 1 — la fila sigue gastando cupo", len(tokens.deletedIDs))
	}
	if tokens.deletedIDs[0] != tokens.created[0].ID {
		t.Fatalf("borro %v, want el token recien acunado %v", tokens.deletedIDs[0], tokens.created[0].ID)
	}
	// MarkUsed ya no aplica: la fila deja de existir, no queda marcada.
	if len(tokens.markedUsed) != 0 {
		t.Fatal("un envio fallido borra la fila, no la marca usada — marcada seguiria contando para el cupo")
	}
}
