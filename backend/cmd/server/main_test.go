package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

// These tests run the real server binary.
//
// Why exec and not a unit test: mailer.RequireConfigured is already covered by
// pure unit tests, and those prove the FUNCTION is correct. They cannot prove
// main() calls it. Deleting the call site leaves every one of them green while
// the guard silently stops existing — which is the exact failure mode the guard
// was written to eliminate, reintroduced one level up.
//
// Before this file the wiring was verified by a human running the binary by
// hand. That is a real verification, but it is not repeatable and CI never
// performs it.
//
// No database is required, and that is not a convenience — it is the assertion.
// main() runs the mailer check BEFORE database.Connect, so a misconfigured
// production deploy dies without waking Neon's compute. If someone moves the
// check below the database wiring, TestServerBinary_ProduccionSinMailer stops
// passing for the right reason: it would hang or fail on the database instead
// of reporting the mailer.

const (
	// An address nothing listens on: the development case is expected to get
	// PAST the mailer check and fail at the database, and it must do so
	// immediately and deterministically rather than by timing out.
	unroutableDatabaseURL = "postgres://x:x@127.0.0.1:1/x?sslmode=disable"

	binaryRunTimeout = 60 * time.Second
)

// buildServerBinary compiles cmd/server into a temp dir and returns its path.
func buildServerBinary(t *testing.T) string {
	t.Helper()

	name := "searchpet-server"
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	binary := filepath.Join(t.TempDir(), name)

	cmd := exec.Command("go", "build", "-o", binary, ".")
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("building the server binary failed: %v\n%s", err, out)
	}
	return binary
}

// runServer starts the built binary with a controlled environment and returns
// its combined output plus whether it exited non-zero.
//
// The working directory is an empty temp dir on purpose: config.Load calls
// godotenv.Load, which reads a .env from the current directory. Running from
// the package directory would let a developer's real .env supply the very
// credentials the test is asserting are absent — the test would pass for a
// reason that has nothing to do with the code.
func runServer(t *testing.T, binary, environment string, extraEnv ...string) (string, bool) {
	t.Helper()

	// Explicit empty values, appended last so they win over anything inherited
	// from the developer's shell.
	env := append(os.Environ(),
		"ENVIRONMENT="+environment,
		"DATABASE_URL="+unroutableDatabaseURL,
		"JWT_SECRET=test-secret",
		"BREVO_API_KEY=",
		"MAIL_FROM_EMAIL=",
	)
	env = append(env, extraEnv...)

	cmd := exec.Command(binary)
	cmd.Env = env
	cmd.Dir = t.TempDir()

	done := make(chan struct{})
	var out []byte
	var err error
	go func() {
		out, err = cmd.CombinedOutput()
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(binaryRunTimeout):
		_ = cmd.Process.Kill()
		t.Fatalf("the server binary did not exit within %s", binaryRunTimeout)
	}

	return string(out), err != nil
}

// TestServerBinary_ProduccionSinMailer is the wiring guard: it fails if main()
// stops calling mailer.RequireConfigured, or if the returned error stops
// reaching a fatal exit.
func TestServerBinary_ProduccionSinMailer(t *testing.T) {
	output, failed := runServer(t, buildServerBinary(t), "production")

	if !failed {
		t.Fatalf("production without mailer credentials must exit non-zero; it did not.\nOutput:\n%s", output)
	}
	// Naming the variable is what makes the crash actionable for an operator.
	if !strings.Contains(output, "BREVO_API_KEY") {
		t.Errorf("the failure must name the missing variable.\nOutput:\n%s", output)
	}
	// The ordering assertion: dying before any database work is the reason the
	// check sits where it does.
	if strings.Contains(output, "Error conectando a la base de datos") {
		t.Errorf("the mailer check must run BEFORE database.Connect, but the binary reached the database first.\nOutput:\n%s", output)
	}
}

// TestServerBinary_DevelopmentSinMailerArranca pins the other half. Without it
// this file would pass against a guard that refuses every environment — and
// that guard would break local development, `make seed` and the e2e suite, all
// of which boot without Brevo credentials deliberately.
func TestServerBinary_DevelopmentSinMailerArranca(t *testing.T) {
	output, _ := runServer(t, buildServerBinary(t), "development")

	if strings.Contains(output, "Configuración de mailer inválida") {
		t.Fatalf("development must only warn about the missing mailer, never refuse to boot.\nOutput:\n%s", output)
	}
	// Reaching the database proves it got past the mailer check rather than
	// never having run it.
	if !strings.Contains(output, "Error conectando a la base de datos") {
		t.Errorf("development should continue past the mailer check and fail at the database.\nOutput:\n%s", output)
	}
}

// TestServerBinary_ProductionConMayuscula covers the case config.IsProduction
// exists for. Before it, pkg/logger and internal/app compared case-sensitively
// while the mailer did not, so this value produced a boot that was production
// for one subsystem and development for the others.
func TestServerBinary_ProductionConMayuscula(t *testing.T) {
	output, failed := runServer(t, buildServerBinary(t), "Production")

	if !failed {
		t.Fatalf("Production must be recognised as production and refuse to boot.\nOutput:\n%s", output)
	}

	// Assert the MAILER message specifically, not just "it died".
	//
	// This assertion earned its precision: the first version of this test
	// checked only for a non-zero exit plus a JSON fatal line, and it passed
	// with the guard call deleted from main() — because the binary then reached
	// the database and died there, which is also non-zero and also a JSON
	// fatal. A test that any crash satisfies measures nothing.
	if !strings.Contains(output, "Configuración de mailer inválida") {
		t.Errorf("Production must be refused by the MAILER guard, not by whatever fails next.\nOutput:\n%s", output)
	}

	// zap's production encoder emits JSON; the development one emits console
	// text. Asserting the ENCODER is what proves the logger agrees with the
	// mailer about this value. The mailer half already behaved correctly before
	// config.IsProduction existed, so it alone would prove nothing about the
	// unification — the logger is the call site that used to disagree.
	if !strings.Contains(output, `"level":"fatal"`) {
		t.Errorf("the production logger (JSON encoder) should be active for this value.\nOutput:\n%s", output)
	}
}
