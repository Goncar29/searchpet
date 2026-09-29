package notification

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"testing"
)

// FIREBASE_KEY must be a service account. option.WithCredentialsJSON accepted
// any credential type (deprecated for that reason), and its replacement,
// WithAuthCredentialsJSON(option.ServiceAccount, ...), does not check the type
// either: it switches to the new auth library, which drops it. So
// NewFirebaseClient checks the type itself and falls back to the no-op client.

func serviceAccountJSON(t *testing.T) string {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	der, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	b, err := json.Marshal(map[string]string{
		"type":           "service_account",
		"project_id":     "searchpet-test",
		"private_key_id": "test",
		"private_key":    string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der})),
		"client_email":   "fcm@searchpet-test.iam.gserviceaccount.com",
		"client_id":      "1",
		"token_uri":      "https://oauth2.googleapis.com/token",
	})
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestNewFirebaseClient_ServiceAccountGivesTheRealClient(t *testing.T) {
	client, err := NewFirebaseClient(serviceAccountJSON(t))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if _, ok := client.(*FirebaseClient); !ok {
		t.Fatalf("got %T, want *FirebaseClient", client)
	}
}

func TestNewFirebaseClient_OtherCredentialTypeFallsBackToNoop(t *testing.T) {
	// A project ID from the environment, so the only thing that can reject
	// this credential is its type, not a missing project.
	t.Setenv("GOOGLE_CLOUD_PROJECT", "searchpet-test")
	authorizedUser := `{"type":"authorized_user","client_id":"1","client_secret":"s","refresh_token":"r"}`

	client, err := NewFirebaseClient(authorizedUser)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if _, ok := client.(*noopNotificationClient); !ok {
		t.Fatalf("got %T, want *noopNotificationClient: a non-service-account credential must not be accepted", client)
	}
}

func TestNewFirebaseClient_InvalidJSONFallsBackToNoop(t *testing.T) {
	client, err := NewFirebaseClient("{not json")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if _, ok := client.(*noopNotificationClient); !ok {
		t.Fatalf("got %T, want *noopNotificationClient", client)
	}
}
