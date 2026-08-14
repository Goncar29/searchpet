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
//
// It models one thing on purpose, because the guard is about it: which rows the
// run REFRESHED. An upsert of a clinic we never had is a write that refreshes
// nothing, so it must not shrink the stale set — and an earlier version of this
// fake returned a fixed 3 from the sweep, which made that distinction impossible
// to see and let a bound measured on writes look correct for months.
type fakeVetRepo struct {
	activeBefore int64
	upsertErr    error
	sweptCutoff  *time.Time
	upserts      int
	// failFirst makes the first N upserts fail, so a test can model a PARTIAL
	// failure — the case where the threshold is satisfied and only guard 2 stands
	// between a stale row and deletion.
	failFirst int
	// knownIDs are the osm_ids the table already holds. Leave it nil and every
	// successful upsert counts as refreshing one existing row, which is the
	// ordinary case; set it to model a response carrying clinics that are new to
	// us, where writes and refreshes stop being the same number.
	knownIDs  map[int64]bool
	refreshed int
	// staleErr makes the pre-sweep count fail, which is a guard input going
	// missing rather than the run failing.
	staleErr error
}

func (f *fakeVetRepo) Upsert(_ context.Context, vet *domain.Vet) error {
	f.upserts++
	if f.failFirst > 0 && f.upserts <= f.failFirst {
		return errors.New("write failed")
	}
	if f.upsertErr != nil {
		return f.upsertErr
	}
	if f.knownIDs == nil || f.knownIDs[vet.OSMID] {
		f.refreshed++
	}
	return nil
}

// stale is what both repository counting methods answer, so they can never
// disagree here for a reason the real ones would not share.
func (f *fakeVetRepo) stale() int64 {
	refreshed := int64(f.refreshed)
	if refreshed > f.activeBefore {
		refreshed = f.activeBefore
	}
	return f.activeBefore - refreshed
}

func (f *fakeVetRepo) CountStaleBefore(_ context.Context, _ time.Time) (int64, error) {
	if f.staleErr != nil {
		return 0, f.staleErr
	}
	return f.stale(), nil
}

func (f *fakeVetRepo) FindNearby(_ context.Context, _, _, _ float64, _ int) ([]domain.VetNearbyResult, error) {
	return nil, nil
}

func (f *fakeVetRepo) SoftDeleteStaleBefore(_ context.Context, cutoff time.Time) (int64, error) {
	f.sweptCutoff = &cutoff
	return f.stale(), nil
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

// overpassStubNoCoords serves ways with no center — elements OSM lists as
// veterinary clinics and mapElement cannot place. It models the systematic case:
// Overpass dropping centers, or someone deleting `out center` from the query.
func overpassStubNoCoords(t *testing.T, elements int) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		els := make([]string, 0, elements)
		for i := 1; i <= elements; i++ {
			els = append(els, fmt.Sprintf(`{"type":"way","id":%d,"tags":{"name":"V%d"}}`, i, i))
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
	// 100 refreshed out of 103 held: three clinics left OpenStreetMap, which is
	// ordinary drift and well inside the bound. The 3 is the number the sweep
	// actually takes, not a stub constant — the fake derives it from what the run
	// refreshed, so this assertion means something.
	repo := &fakeVetRepo{activeBefore: 103}

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

	res, err := newTestImporter(repo, srv.URL).Run(context.Background(),
		// 2 refreshed out of 100, so 98 rows would go. The operator read that number
		// and approved it as the ceiling.
		RunOptions{ForceSweep: true, MaxRetired: 98})
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

// THE reason the override carries a number instead of a bare bool, and the reason
// that number is a CEILING. Forcing starts a NEW run — new Overpass fetch, new
// upserts — so what the operator read and approved belongs to the PREVIOUS one.
// The dangerous sequence is short: two runs agree that 140 clinics should go, the
// operator concludes the shrinkage is real and presses force, and THAT third
// response comes back truncated at 12 elements, which leaves 171 rows stale.
//
// The ceiling refuses it without anyone having to anticipate it: a truncated
// response always retires MORE, so it can only ever exceed what was approved.
func TestRun_ForceSweepDoesNotCoverARunTheOperatorNeverSaw(t *testing.T) {
	srv := overpassStub(t, 12) // the truncated response nobody approved
	defer srv.Close()
	repo := &fakeVetRepo{activeBefore: 183}

	res, err := newTestImporter(repo, srv.URL).Run(context.Background(),
		RunOptions{ForceSweep: true, MaxRetired: 140}) // at most 140 may go
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if res.SweepSkipped != "below_threshold" {
		t.Errorf("SweepSkipped = %q: at most 140 were approved and this run would retire %d",
			res.SweepSkipped, res.WouldRetire)
	}
	if repo.sweptCutoff != nil {
		t.Error("a truncated response swept the table under an override approved for another run")
	}
	if res.SweepForced {
		t.Error("nothing was forced: the run would retire more than the ceiling allows")
	}
}

// A run that would retire FEWER rows than approved still sweeps: the ceiling is a
// bound, not an equality check. Requiring an exact match would make a legitimate
// override fail whenever OSM gained a clinic between the two runs, and an operator
// whose override silently does nothing presses it again rather than reading a
// number.
func TestRun_ForceSweepAppliesWhenTheRunRetiresLessThanApproved(t *testing.T) {
	srv := overpassStub(t, 145)
	defer srv.Close()
	repo := &fakeVetRepo{activeBefore: 183}

	res, err := newTestImporter(repo, srv.URL).Run(context.Background(),
		RunOptions{ForceSweep: true, MaxRetired: 140})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if res.SweepSkipped != "" {
		t.Errorf("SweepSkipped = %q: retiring %d is well inside the 140 approved",
			res.SweepSkipped, res.WouldRetire)
	}
	if !res.SweepForced {
		t.Error("the sweep only happened because of the override and must say so")
	}
}

// Fail closed on an override with no evidence attached. A caller that sets the
// flag and omits the number is either an older client or a hand-made request, and
// in both cases nobody looked at a run — which is the whole condition the flag is
// supposed to encode.
func TestRun_ForceSweepWithoutTheApprovedNumberDoesNothing(t *testing.T) {
	srv := overpassStub(t, 2)
	defer srv.Close()
	repo := &fakeVetRepo{activeBefore: 100}

	res, err := newTestImporter(repo, srv.URL).Run(context.Background(), RunOptions{ForceSweep: true})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if res.SweepSkipped != "below_threshold" {
		t.Errorf("SweepSkipped = %q: an override with no evidence is not an override", res.SweepSkipped)
	}
	if repo.sweptCutoff != nil {
		t.Error("a bare force_sweep:true swept the table with nothing backing it")
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
	// 50 elements against 100 active puts the RESPONSE below the threshold, so the
	// override is genuinely LIVE for this run — it is granted for the 50 the
	// operator saw and the run brings back exactly 50. Half the writes then fail.
	// Without that setup the threshold would never trip, the override would be
	// inert, and this test would pass for a reason that has nothing to do with the
	// guard it is named after.
	srv := overpassStub(t, 50)
	defer srv.Close()
	repo := &fakeVetRepo{activeBefore: 100, failFirst: 25}

	res, err := newTestImporter(repo, srv.URL).Run(context.Background(),
		// 25 refreshed out of 100 held, so 75 would go and the ceiling covers them:
		// the override is genuinely LIVE here, which is what makes this test about
		// upsert_failures instead of about an override that could not apply anyway.
		RunOptions{ForceSweep: true, MaxRetired: 75})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if res.Scanned != 50 || res.Upserted != 25 || res.UpsertFailed != 25 {
		t.Fatalf("wrong scenario: scanned=%d upserted=%d failed=%d",
			res.Scanned, res.Upserted, res.UpsertFailed)
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

// The threshold has to doubt OPENSTREETMAP, and only OpenStreetMap. Measuring it
// against Upserted mixed in a failure of ours: SkippedNoCoords lowers Upserted
// too, so a systematic mapping regression — Overpass dropping centers, or `out
// center` disappearing from the query — trips below_threshold with a number that
// REPEATS run after run. That repetition is exactly the signal the confirmation
// tells the operator to read as "the drop is real, force it", and forcing there
// retires clinics that OSM still lists. Scanned is what OSM said; Upserted is
// what we managed to keep.
func TestRun_MappingFailuresBlockSweepUnderTheirOwnReason(t *testing.T) {
	srv := overpassStubNoCoords(t, 100) // OSM listed 100, we can place none of them
	defer srv.Close()
	repo := &fakeVetRepo{activeBefore: 100}

	res, err := newTestImporter(repo, srv.URL).Run(context.Background(), RunOptions{})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if res.Scanned != 100 || res.Upserted != 0 || res.SkippedNoCoords != 100 {
		t.Fatalf("wrong scenario: scanned=%d upserted=%d no_coords=%d",
			res.Scanned, res.Upserted, res.SkippedNoCoords)
	}
	if res.SweepSkipped != "mapping_failures" {
		t.Errorf("SweepSkipped = %q, want \"mapping_failures\": OSM listed enough, WE lost them",
			res.SweepSkipped)
	}
	if repo.sweptCutoff != nil {
		t.Error("the sweep ran while our own mapping was dropping every element")
	}
}

// And it must not be the operator's to overrule, for the same reason
// upsert_failures is not: from the panel, a run that lost its rows to our mapping
// looks identical to one where OSM genuinely shrank. The number they would be
// approving is stable across runs precisely BECAUSE the fault is ours.
func TestRun_MappingFailuresCannotBeForced(t *testing.T) {
	srv := overpassStubNoCoords(t, 100)
	defer srv.Close()
	repo := &fakeVetRepo{activeBefore: 100}

	res, err := newTestImporter(repo, srv.URL).Run(context.Background(),
		RunOptions{ForceSweep: true, MaxRetired: 100})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if res.SweepSkipped != "mapping_failures" {
		t.Errorf("SweepSkipped = %q: forcing reached a guard that doubts our own code",
			res.SweepSkipped)
	}
	if repo.sweptCutoff != nil {
		t.Error("the override retired clinics OpenStreetMap still lists")
	}
	if res.SweepForced {
		t.Error("nothing was forced: the run was blocked by the other guard")
	}
}

// The count feeds a guard, so failing to get it must refuse the sweep — not
// discard the run. Aborting throws away a Result whose 183 upserts already
// committed, and the handler maps any error to 502 vet_import_upstream_failed,
// which names Overpass for a database blip: the operator reads "the import could
// not be completed" and never learns the writes landed.
func TestRun_AFailedStaleCountBlocksTheSweepWithoutLosingTheRun(t *testing.T) {
	srv := overpassStub(t, 100)
	defer srv.Close()
	repo := &fakeVetRepo{activeBefore: 100, staleErr: errors.New("connection reset by peer")}

	res, err := newTestImporter(repo, srv.URL).Run(context.Background(), RunOptions{})
	if err != nil {
		t.Fatalf("Run returned an error and threw away 100 committed upserts: %v", err)
	}
	if res.Upserted != 100 {
		t.Errorf("Upserted = %d: the run's own outcome was lost", res.Upserted)
	}
	if res.SweepSkipped != "stale_count_failed" {
		t.Errorf("SweepSkipped = %q, want \"stale_count_failed\"", res.SweepSkipped)
	}
	if repo.sweptCutoff != nil {
		t.Error("swept without knowing how many rows it would take")
	}
}

// And it must not be overridable: the operator cannot approve a ceiling on a
// number nobody could read.
func TestRun_AFailedStaleCountCannotBeForced(t *testing.T) {
	srv := overpassStub(t, 100)
	defer srv.Close()
	repo := &fakeVetRepo{activeBefore: 100, staleErr: errors.New("connection reset by peer")}

	res, err := newTestImporter(repo, srv.URL).Run(context.Background(),
		RunOptions{ForceSweep: true, MaxRetired: 100})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if res.SweepSkipped != "stale_count_failed" || repo.sweptCutoff != nil {
		t.Errorf("forcing reached a guard that fired because we could not measure: %q",
			res.SweepSkipped)
	}
}

// Issue #156. The bound promises that no run retires more than a fifth of the
// table unless a human asked, and measuring it on Upserted only approximates
// that: Upserted counts WRITES, and the upsert of a clinic we never had refreshes
// nothing while still padding the number the guard reads.
//
// Scenario: we hold 183, OSM has grown, and Overpass returns a truncated 150 of
// which 30 are new to us. 150 clears 0.8*183 on writes, but only 120 existing
// rows were refreshed, so 63 live clinics — 34% — would go away unforced.
func TestRun_TheBoundCountsRowsRetiredNotWritesMade(t *testing.T) {
	known := make(map[int64]bool, 120)
	for i := int64(1); i <= 120; i++ {
		known[i] = true
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		els := make([]string, 0, 150)
		for i := 1; i <= 120; i++ { // already ours
			els = append(els, fmt.Sprintf(
				`{"type":"node","id":%d,"lat":-34.9,"lon":-56.1,"tags":{"name":"V%d"}}`, i, i))
		}
		for i := 1000; i <= 1029; i++ { // new in OSM since the last run
			els = append(els, fmt.Sprintf(
				`{"type":"node","id":%d,"lat":-34.9,"lon":-56.1,"tags":{"name":"N%d"}}`, i, i))
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"elements":[` + strings.Join(els, ",") + `]}`))
	}))
	defer srv.Close()
	repo := &fakeVetRepo{activeBefore: 183, knownIDs: known}

	res, err := newTestImporter(repo, srv.URL).Run(context.Background(), RunOptions{})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if res.Upserted != 150 {
		t.Fatalf("wrong scenario: upserted=%d", res.Upserted)
	}
	if res.SweepSkipped != "below_threshold" {
		t.Errorf("SweepSkipped = %q: 150 writes cleared the guard while 63 live rows go away",
			res.SweepSkipped)
	}
	if max := (1 - sweepMinRatio) * float64(res.ActiveBefore); float64(res.Swept) > max {
		t.Errorf("retired %d of %d rows, the bound allows %.0f — no guard, no operator",
			res.Swept, res.ActiveBefore, max)
	}
}

// The number the operator is asked to approve has to be the number the guard
// used, so it travels to the response even on a clean run — same reason
// ActiveBefore does.
func TestRun_ReportsHowManyRowsTheRunWouldRetire(t *testing.T) {
	srv := overpassStub(t, 100)
	defer srv.Close()
	repo := &fakeVetRepo{activeBefore: 103}

	res, err := newTestImporter(repo, srv.URL).Run(context.Background(), RunOptions{})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if res.WouldRetire != 3 {
		t.Errorf("WouldRetire = %d, want 3", res.WouldRetire)
	}
}

// A rejected override must not be indistinguishable from one that was never
// sent. Both produce sweep_skipped: below_threshold and no sweep_forced, so the
// panel would show the operator the exact same screen — and the natural reading
// of "the button did nothing" is to press it again, which re-pins the approval to
// whatever the LAST run brought back. Two clicks and a matching third response
// walk the sweep in through the door this guard is holding shut.
func TestRun_ARejectedOverrideSaysSoInTheResult(t *testing.T) {
	srv := overpassStub(t, 12)
	defer srv.Close()
	repo := &fakeVetRepo{activeBefore: 183}

	res, err := newTestImporter(repo, srv.URL).Run(context.Background(),
		RunOptions{ForceSweep: true, MaxRetired: 140})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if res.SweepSkipped != "below_threshold" || res.SweepForced {
		t.Fatalf("wrong scenario: skipped=%q forced=%v", res.SweepSkipped, res.SweepForced)
	}
	if !res.SweepForceIgnored {
		t.Error("the override was asked for and dropped, and the result does not say so")
	}
}

// A request with the flag and no number never was an override — forceApplies
// says so — so reporting it as one refused makes the panel tell the operator
// that "this run saved less than what you approved" when nothing was approved.
// The flag means "your override was evaluated and came up short", and that
// sentence needs an override to have existed.
func TestRun_AForceWithNoEvidenceIsNotReportedAsARefusedOverride(t *testing.T) {
	srv := overpassStub(t, 12)
	defer srv.Close()
	repo := &fakeVetRepo{activeBefore: 183}

	res, err := newTestImporter(repo, srv.URL).Run(context.Background(),
		RunOptions{ForceSweep: true}) // flag, no number
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if res.SweepSkipped != "below_threshold" {
		t.Fatalf("wrong scenario: %q", res.SweepSkipped)
	}
	if res.SweepForceIgnored {
		t.Error("reported as a refused override, but no override was ever made")
	}
}

// And it must stay quiet otherwise, or every ordinary blocked run would tell the
// operator an override was refused when none was ever requested.
func TestRun_AnUnforcedBlockDoesNotClaimAnOverrideWasIgnored(t *testing.T) {
	srv := overpassStub(t, 12)
	defer srv.Close()
	repo := &fakeVetRepo{activeBefore: 183}

	res, err := newTestImporter(repo, srv.URL).Run(context.Background(), RunOptions{})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if res.SweepForceIgnored {
		t.Error("nobody asked to force this run")
	}
}

// The promise sweepMinRatio makes is about the TABLE: no run retires more than a
// fifth of it unless a human said so. Two ratios in series do not keep that
// promise — they multiply. Scanned >= 0.8*activeBefore and Upserted >= 0.8*Scanned
// only give Upserted >= 0.64*activeBefore, so a run can retire ~36% with every
// guard satisfied and nothing to force. The UI copy still promises 20%.
func TestRun_NoRunRetiresMoreThanTheRatioWithoutBeingForced(t *testing.T) {
	// 147 elements against 183 active, 29 of them unplaceable: each ratio passes on
	// its own (147 >= 146.4 and 118 >= 117.6) while 65 live rows go away.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		els := make([]string, 0, 147)
		for i := 1; i <= 118; i++ {
			els = append(els, fmt.Sprintf(
				`{"type":"node","id":%d,"lat":-34.9,"lon":-56.1,"tags":{"name":"V%d"}}`, i, i))
		}
		for i := 119; i <= 147; i++ {
			els = append(els, fmt.Sprintf(`{"type":"way","id":%d,"tags":{"name":"V%d"}}`, i, i))
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"elements":[` + strings.Join(els, ",") + `]}`))
	}))
	defer srv.Close()
	repo := &fakeVetRepo{activeBefore: 183}

	res, err := newTestImporter(repo, srv.URL).Run(context.Background(), RunOptions{})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if res.Scanned != 147 || res.Upserted != 118 {
		t.Fatalf("wrong scenario: scanned=%d upserted=%d", res.Scanned, res.Upserted)
	}
	if res.SweepSkipped != "below_threshold" {
		t.Errorf("SweepSkipped = %q: 118 survivors out of 183 retires 35%% of the table unasked",
			res.SweepSkipped)
	}
	if repo.sweptCutoff != nil {
		t.Error("the sweep retired a third of the table with no guard and no operator")
	}
}

// The hole the first version of mapping_failures left open: the operator forces
// past the threshold, and the run they unlocked then loses almost everything to
// OUR mapping. They approved 100 elements coming back from OSM; they did not
// approve keeping 5 of them. The guard that exists for exactly this must not be
// switched off as a side effect of unlocking the other one.
func TestRun_MappingFailuresStillBlockAForcedRun(t *testing.T) {
	// 100 elements against 183 active trips the threshold, so the override is
	// live; 95 of them come back without a center.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		els := make([]string, 0, 100)
		for i := 1; i <= 5; i++ {
			els = append(els, fmt.Sprintf(
				`{"type":"node","id":%d,"lat":-34.9,"lon":-56.1,"tags":{"name":"V%d"}}`, i, i))
		}
		for i := 6; i <= 100; i++ {
			els = append(els, fmt.Sprintf(`{"type":"way","id":%d,"tags":{"name":"V%d"}}`, i, i))
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"elements":[` + strings.Join(els, ",") + `]}`))
	}))
	defer srv.Close()
	repo := &fakeVetRepo{activeBefore: 183}

	res, err := newTestImporter(repo, srv.URL).Run(context.Background(),
		// 5 refreshed out of 183, so 178 would go and the ceiling covers them — the
		// override is live, and mapping_failures still has to stop it.
		RunOptions{ForceSweep: true, MaxRetired: 178})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if res.Scanned != 100 || res.Upserted != 5 {
		t.Fatalf("wrong scenario: scanned=%d upserted=%d", res.Scanned, res.Upserted)
	}
	if res.SweepSkipped != "mapping_failures" {
		t.Errorf("SweepSkipped = %q: forcing the threshold switched off the guard that doubts our mapping",
			res.SweepSkipped)
	}
	if repo.sweptCutoff != nil {
		t.Error("the sweep retired ~178 clinics OpenStreetMap still lists")
	}
}

// The forced exit must stay usable for the case it was built for. A genuine
// upstream shrinkage brings back FEWER elements, so Scanned falls with Upserted
// and the gap that defines mapping_failures never opens.
func TestRun_ForcingARealShrinkageIsNotMistakenForAMappingFailure(t *testing.T) {
	srv := overpassStub(t, 12) // OSM really does list only 12 now
	defer srv.Close()
	repo := &fakeVetRepo{activeBefore: 183}

	res, err := newTestImporter(repo, srv.URL).Run(context.Background(),
		// 12 refreshed out of 183, so 171 go away — that is what was approved.
		RunOptions{ForceSweep: true, MaxRetired: 171})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if res.SweepSkipped != "" {
		t.Errorf("SweepSkipped = %q: the operator's exit stopped working", res.SweepSkipped)
	}
	if !res.SweepForced {
		t.Error("the sweep only happened because of the override and must say so")
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
//
// The proportion is the test. mapping_failures fires on a RATIO, so this has to
// be modelled at the scale the ratio was chosen for: one loss out of 101 is the
// stray way this is about. An earlier version used one good element and one
// broken one, which is a 50% loss rate dressed up as "a stray way" — it asserted
// that losing half a response is fine, which is the opposite of the invariant.
func TestRun_MissingCoordsDoesNotBlockSweep(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		els := make([]string, 0, 101)
		for i := 1; i <= 100; i++ {
			els = append(els, fmt.Sprintf(
				`{"type":"node","id":%d,"lat":-34.9,"lon":-56.1,"tags":{"name":"Ok%d"}}`, i, i))
		}
		els = append(els, `{"type":"way","id":999,"tags":{"name":"NoGeo"}}`)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"elements":[` + strings.Join(els, ",") + `]}`))
	}))
	defer srv.Close()
	repo := &fakeVetRepo{activeBefore: 100}

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
