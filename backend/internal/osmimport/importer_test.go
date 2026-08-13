package osmimport

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"go.uber.org/zap"
	"lost-pets/internal/domain"
)

// TestFetch_SendsURLEncodedQueryWithUserAgent locks in the fix for the Overpass
// 406 Not Acceptable: the QL query must be URL-encoded in the "data" form field,
// and a non-default User-Agent must be set (Overpass rejects Go-http-client).
func TestFetch_SendsURLEncodedQueryWithUserAgent(t *testing.T) {
	var gotUA, gotContentType, gotBody string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotUA = r.Header.Get("User-Agent")
		gotContentType = r.Header.Get("Content-Type")
		buf, _ := io.ReadAll(r.Body)
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

// The website tag is world-editable and lands in an href on the map popup, so a
// javascript: or data: scheme would run in the visitor's page. Shelters get this
// checked at their own door (validOptionalHTTPSURL, shelter_dto.go); vets never
// had a door, because nobody types this value into one of our forms.
func TestMapElement_DropsWebsiteWithANonHTTPScheme(t *testing.T) {
	for _, raw := range []string{
		"javascript:alert(document.cookie)",
		"JavaScript:alert(1)", // scheme comparison must not be case sensitive
		"data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
		"//evil.example",      // protocol-relative: parses, but carries no scheme
		"vbscript:msgbox(1)",
	} {
		el := overpassElement{
			Type: "node", ID: 401, Lat: -34.9, Lon: -56.1,
			Tags: map[string]string{"website": raw},
		}
		vet, ok := mapElement(el)
		if !ok {
			t.Fatalf("%q: the element itself is fine, only its website is not", raw)
		}
		if vet.Website != "" {
			t.Errorf("%q survived into Website as %q", raw, vet.Website)
		}
	}
}

// A tag typed by a person carries stray whitespace, and url.Parse refuses it:
// " https://x.uy" reads as a path segment containing a colon. Dropping a good
// link over a space is data loss with no error anywhere.
func TestMapElement_TrimsWhitespaceAroundTheWebsite(t *testing.T) {
	el := overpassElement{
		Type: "node", ID: 403, Lat: -34.9, Lon: -56.1,
		Tags: map[string]string{"website": "  https://veterinaria.uy  "},
	}
	vet, _ := mapElement(el)
	if vet.Website != "https://veterinaria.uy" {
		t.Errorf("Website = %q, want the trimmed URL", vet.Website)
	}
}

// Dropping the unsafe value must not drop the usable one sitting next to it.
func TestMapElement_FallsBackToContactWebsiteWhenThePrimaryIsUnsafe(t *testing.T) {
	el := overpassElement{
		Type: "node", ID: 402, Lat: -34.9, Lon: -56.1,
		Tags: map[string]string{
			"website":         "javascript:alert(1)",
			"contact:website": "https://veterinaria.uy",
		},
	}
	vet, _ := mapElement(el)
	if vet.Website != "https://veterinaria.uy" {
		t.Errorf("Website = %q, want the safe contact tag", vet.Website)
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

// fakeVetRepo records what the importer asks of the repository. Counting calls is
// the point: these tests are about WHETHER the sweep runs, not about SQL.
type fakeVetRepo struct {
	activeBefore int64
	upsertErr    error
	sweptCutoff  *time.Time
	upserts      int
	// failFirst makes the first N upserts fail, so a test can model a PARTIAL
	// failure — the case where the threshold is satisfied and only guard 2 stands
	// between a stale row and deletion.
	failFirst int
}

func (f *fakeVetRepo) Upsert(_ context.Context, _ *domain.Vet) error {
	f.upserts++
	if f.failFirst > 0 && f.upserts <= f.failFirst {
		return errors.New("write failed")
	}
	return f.upsertErr
}

func (f *fakeVetRepo) FindNearby(_ context.Context, _, _, _ float64, _ int) ([]domain.VetNearbyResult, error) {
	return nil, nil
}

func (f *fakeVetRepo) SoftDeleteStaleBefore(_ context.Context, cutoff time.Time) (int64, error) {
	f.sweptCutoff = &cutoff
	return 3, nil
}

func (f *fakeVetRepo) CountActiveOSM(_ context.Context) (int64, error) {
	return f.activeBefore, nil
}

// overpassStub serves a fixed number of usable vet nodes.
func overpassStub(t *testing.T, elements int) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		els := make([]string, 0, elements)
		for i := 1; i <= elements; i++ {
			els = append(els, fmt.Sprintf(
				`{"type":"node","id":%d,"lat":-34.9,"lon":-56.1,"tags":{"name":"V%d"}}`, i, i))
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"elements":[` + strings.Join(els, ",") + `]}`))
	}))
}

func newTestImporter(repo *fakeVetRepo, endpoint string) *Importer {
	return &Importer{repo: repo, httpClient: &http.Client{}, endpoint: endpoint, logger: zap.NewNop()}
}

func TestRun_SweepsWhenTheRunLooksComplete(t *testing.T) {
	srv := overpassStub(t, 100)
	defer srv.Close()
	repo := &fakeVetRepo{activeBefore: 100}

	res, err := newTestImporter(repo, srv.URL).Run(context.Background(), RunOptions{})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if res.SweepSkipped != "" {
		t.Fatalf("sweep should have run, blocked by %q", res.SweepSkipped)
	}
	if repo.sweptCutoff == nil {
		t.Fatal("SoftDeleteStaleBefore was never called")
	}
	if res.Swept != 3 {
		t.Errorf("Swept = %d, want 3", res.Swept)
	}
}

// THE guard. Overpass can answer 200 with a short body and no error of any kind.
// Without the threshold, that response sweeps almost the whole table.
func TestRun_ThresholdBlocksSweepOnShortResponse(t *testing.T) {
	srv := overpassStub(t, 2) // 2 upserted against 100 already there
	defer srv.Close()
	repo := &fakeVetRepo{activeBefore: 100}

	res, err := newTestImporter(repo, srv.URL).Run(context.Background(), RunOptions{})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if res.SweepSkipped != "below_threshold" {
		t.Errorf("SweepSkipped = %q, want \"below_threshold\"", res.SweepSkipped)
	}
	if repo.sweptCutoff != nil {
		t.Error("the sweep ran on a response that lost 98% of the table")
	}
	if res.Swept != 0 {
		t.Errorf("Swept = %d, want 0", res.Swept)
	}
	// The guard cannot untrip itself, so the operator's only way to tell a
	// truncated response from a real shrinkage is comparing these two numbers
	// across runs. Reporting the block without its denominator hides that.
	if res.ActiveBefore != 100 {
		t.Errorf("ActiveBefore = %d, want 100 — the block is unreadable without it", res.ActiveBefore)
	}
}

// The threshold doubts the response. A human who has run the import twice and
// read the same number twice has evidence the response is honest, and until this
// existed their only exit was an UPDATE against the production database.
func TestRun_ForceSweepOverridesTheThreshold(t *testing.T) {
	srv := overpassStub(t, 2) // 2 upserted against 100 already there
	defer srv.Close()
	repo := &fakeVetRepo{activeBefore: 100}

	res, err := newTestImporter(repo, srv.URL).Run(context.Background(), RunOptions{ForceSweep: true})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if res.SweepSkipped != "" {
		t.Errorf("SweepSkipped = %q, want the sweep to have run", res.SweepSkipped)
	}
	if repo.sweptCutoff == nil {
		t.Error("the operator asked for the sweep explicitly and it still did not run")
	}
	if !res.SweepForced {
		t.Error("a forced sweep has to be legible afterwards, in the body and in the log")
	}
}

// An override that changed nothing must not be reported as one, or a routine
// import reads afterwards like an operator overruling a safety guard — and the
// log line that says so would be equally false.
//
// This one is a pin rather than a discovery: it was written after a review
// replaced the guard with a bare `res.SweepForced = opts.ForceSweep` and watched
// the whole suite stay green. Removing that conjunct now fails HERE.
func TestRun_ForceSweepIsNotReportedWhenTheRunClearedTheThresholdAnyway(t *testing.T) {
	srv := overpassStub(t, 100) // 100 upserted against 100 already there
	defer srv.Close()
	repo := &fakeVetRepo{activeBefore: 100}

	res, err := newTestImporter(repo, srv.URL).Run(context.Background(), RunOptions{ForceSweep: true})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if res.SweepSkipped != "" {
		t.Fatalf("SweepSkipped = %q, this run clears the threshold on its own", res.SweepSkipped)
	}
	if repo.sweptCutoff == nil {
		t.Error("the sweep should have run on its own merits")
	}
	if res.SweepForced {
		t.Error("nothing was overridden: this run cleared the threshold without help")
	}
}

// This is the line that matters, and it is not symmetry: the threshold doubts
// OSM, but upsert_failures doubts US. Sweeping while our own writes are failing
// retires clinics that are alive upstream — and no operator pressing a button
// can know that from the outside, so the button must not be able to reach it.
func TestRun_ForceSweepStillRespectsUpsertFailures(t *testing.T) {
	srv := overpassStub(t, 100)
	defer srv.Close()
	repo := &fakeVetRepo{activeBefore: 100, upsertErr: errors.New("connection reset")}

	res, err := newTestImporter(repo, srv.URL).Run(context.Background(), RunOptions{ForceSweep: true})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if res.SweepSkipped != "upsert_failures" {
		t.Errorf("SweepSkipped = %q, want \"upsert_failures\"", res.SweepSkipped)
	}
	if repo.sweptCutoff != nil {
		t.Error("forcing reached the guard that protects against our own failed writes")
	}
	if res.SweepForced {
		t.Error("nothing was forced: the run was blocked by the other guard")
	}
}

// A failed upsert leaves a live row with a stale last_synced_at, which the sweep
// would read as "OSM dropped it". It did not — our write failed.
func TestRun_UpsertFailureBlocksSweep(t *testing.T) {
	srv := overpassStub(t, 100)
	defer srv.Close()
	repo := &fakeVetRepo{activeBefore: 100, upsertErr: errors.New("connection reset")}

	res, err := newTestImporter(repo, srv.URL).Run(context.Background(), RunOptions{})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if res.SweepSkipped != "upsert_failures" {
		t.Errorf("SweepSkipped = %q, want \"upsert_failures\"", res.SweepSkipped)
	}
	if repo.sweptCutoff != nil {
		t.Error("the sweep ran after every write failed")
	}
	if res.UpsertFailed != 100 || res.Upserted != 0 {
		t.Errorf("counters wrong: upserted=%d failed=%d", res.Upserted, res.UpsertFailed)
	}
}

// An element with no coordinates was never in the table, so it must NOT block a
// sweep — otherwise one malformed OSM way disables cleanup permanently.
func TestRun_MissingCoordsDoesNotBlockSweep(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"elements":[
			{"type":"node","id":1,"lat":-34.9,"lon":-56.1,"tags":{"name":"Ok"}},
			{"type":"way","id":2,"tags":{"name":"NoGeo"}}
		]}`))
	}))
	defer srv.Close()
	repo := &fakeVetRepo{activeBefore: 1}

	res, err := newTestImporter(repo, srv.URL).Run(context.Background(), RunOptions{})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if res.SkippedNoCoords != 1 || res.UpsertFailed != 0 {
		t.Errorf("counters wrong: no_coords=%d failed=%d", res.SkippedNoCoords, res.UpsertFailed)
	}
	if res.SweepSkipped != "" {
		t.Errorf("a coordinate-less element blocked the sweep: %q", res.SweepSkipped)
	}
}

// An empty table has nothing to sweep and must not trip the threshold.
func TestRun_EmptyTableStillSweeps(t *testing.T) {
	srv := overpassStub(t, 5)
	defer srv.Close()
	repo := &fakeVetRepo{activeBefore: 0}

	res, err := newTestImporter(repo, srv.URL).Run(context.Background(), RunOptions{})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if res.SweepSkipped != "" {
		t.Errorf("first-ever import blocked its own sweep: %q", res.SweepSkipped)
	}
}

// The scenario guard 2 exists for, and the one the all-failures test cannot reach:
// almost everything succeeds, so the threshold is satisfied and waves the run
// through. The single row whose write failed is still in the table with a stale
// last_synced_at — sweeping now would retire a clinic that is alive in OSM, and
// nothing else would stop it.
func TestRun_PartialUpsertFailureBlocksSweepEvenAboveThreshold(t *testing.T) {
	srv := overpassStub(t, 100)
	defer srv.Close()
	repo := &fakeVetRepo{activeBefore: 100, failFirst: 1}

	res, err := newTestImporter(repo, srv.URL).Run(context.Background(), RunOptions{})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if res.Upserted != 99 || res.UpsertFailed != 1 {
		t.Fatalf("wrong scenario: upserted=%d failed=%d", res.Upserted, res.UpsertFailed)
	}
	// 99 >= 0.8 * 100, so the threshold is NOT what blocks this one.
	if res.SweepSkipped != "upsert_failures" {
		t.Errorf("SweepSkipped = %q, want \"upsert_failures\"", res.SweepSkipped)
	}
	if repo.sweptCutoff != nil {
		t.Error("swept with a live vet holding a stale timestamp")
	}
}
