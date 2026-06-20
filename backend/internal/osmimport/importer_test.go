package osmimport

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"go.uber.org/zap"
)

// TestFetch_SendsURLEncodedQueryWithUserAgent locks in the fix for the Overpass
// 406 Not Acceptable: the QL query must be URL-encoded in the "data" form field,
// and a non-default User-Agent must be set (Overpass rejects Go-http-client).
func TestFetch_SendsURLEncodedQueryWithUserAgent(t *testing.T) {
	var gotUA, gotContentType, gotBody string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotUA = r.Header.Get("User-Agent")
		gotContentType = r.Header.Get("Content-Type")
		buf := make([]byte, r.ContentLength)
		_, _ = r.Body.Read(buf)
		gotBody = string(buf)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"elements":[]}`))
	}))
	defer srv.Close()

	imp := &Importer{httpClient: srv.Client(), endpoint: srv.URL, logger: zap.NewNop()}
	if _, err := imp.fetch(context.Background()); err != nil {
		t.Fatalf("fetch returned error: %v", err)
	}

	if gotContentType != "application/x-www-form-urlencoded" {
		t.Errorf("Content-Type = %q", gotContentType)
	}
	if gotUA == "" || strings.HasPrefix(gotUA, "Go-http-client") {
		t.Errorf("User-Agent must be a non-default identifying UA, got %q", gotUA)
	}
	// URL-encoded form body: starts with data= and the QL brackets are percent-encoded.
	if !strings.HasPrefix(gotBody, "data=") || !strings.Contains(gotBody, "%5Bout%3Ajson%5D") {
		t.Errorf("body is not URL-encoded form data: %q", gotBody)
	}
}

func TestMapElement_NodeWithTags(t *testing.T) {
	el := overpassElement{
		Type: "node", ID: 100, Lat: -34.9, Lon: -56.1,
		Tags: map[string]string{
			"name":             "Puntovet",
			"addr:street":      "Av. Brasil",
			"addr:housenumber": "2500",
			"phone":            "+598 2 700 0000",
			"opening_hours":    "Mo-Fr 09:00-18:00",
		},
	}
	vet, ok := mapElement(el)
	if !ok {
		t.Fatal("expected ok=true for a node with coords")
	}
	if vet.OSMType != "node" || vet.OSMID != 100 {
		t.Errorf("bad natural key: %s/%d", vet.OSMType, vet.OSMID)
	}
	if vet.Name != "Puntovet" {
		t.Errorf("name = %q", vet.Name)
	}
	if vet.Address != "Av. Brasil 2500" {
		t.Errorf("address = %q, want 'Av. Brasil 2500'", vet.Address)
	}
	if vet.Phone != "+598 2 700 0000" {
		t.Errorf("phone = %q", vet.Phone)
	}
	if vet.Source != "osm" || vet.LastSyncedAt.IsZero() {
		t.Errorf("source/last_synced not set: %q %v", vet.Source, vet.LastSyncedAt)
	}
}

func TestMapElement_WayUsesCenter(t *testing.T) {
	el := overpassElement{
		Type: "way", ID: 200,
		Center: &overpassCenter{Lat: -34.8, Lon: -56.2},
		Tags:   map[string]string{"name": "Clinic"},
	}
	vet, ok := mapElement(el)
	if !ok {
		t.Fatal("expected ok=true for a way with center")
	}
	if vet.Latitude != -34.8 || vet.Longitude != -56.2 {
		t.Errorf("way center not used: %v,%v", vet.Latitude, vet.Longitude)
	}
}

func TestMapElement_SkipsMissingCoords(t *testing.T) {
	el := overpassElement{Type: "way", ID: 300, Tags: map[string]string{"name": "NoGeo"}}
	if _, ok := mapElement(el); ok {
		t.Error("expected ok=false when no coords available")
	}
}

func TestMapElement_PhoneFallbackToContactTag(t *testing.T) {
	el := overpassElement{
		Type: "node", ID: 400, Lat: -34.9, Lon: -56.1,
		Tags: map[string]string{"contact:phone": "099 123 456", "contact:website": "https://x.uy"},
	}
	vet, _ := mapElement(el)
	if vet.Phone != "099 123 456" {
		t.Errorf("phone fallback failed: %q", vet.Phone)
	}
	if vet.Website != "https://x.uy" {
		t.Errorf("website fallback failed: %q", vet.Website)
	}
}

func TestParseOverpass_DecodesElements(t *testing.T) {
	body := []byte(`{"elements":[
		{"type":"node","id":1,"lat":-34.9,"lon":-56.1,"tags":{"name":"A"}},
		{"type":"way","id":2,"center":{"lat":-34.8,"lon":-56.2},"tags":{"name":"B"}}
	]}`)
	els, err := parseOverpass(body)
	if err != nil {
		t.Fatalf("parseOverpass: %v", err)
	}
	if len(els) != 2 {
		t.Fatalf("expected 2 elements, got %d", len(els))
	}
}
