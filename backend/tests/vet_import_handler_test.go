package tests

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/gin-gonic/gin"
	"lost-pets/internal/handler"
	"lost-pets/internal/osmimport"
)

type fakeImporter struct {
	res  osmimport.Result
	err  error
	// gotOpts records what the handler passed down, which is the only way to tell
	// "the body reached the importer" from "the handler ignored it".
	gotOpts osmimport.RunOptions
	started chan struct{} // closed on entry when non-nil
	release chan struct{} // blocks Run until closed when non-nil
	// startOnce guards the close(started) signal. The handler test re-enters
	// Run a third time (after the flag clears) to prove the endpoint unlocks;
	// without this guard that third call would close an already-closed
	// channel and panic — unrelated to whether the handler itself is correct.
	startOnce sync.Once
}

func (f *fakeImporter) Run(_ context.Context, opts osmimport.RunOptions) (osmimport.Result, error) {
	f.gotOpts = opts
	if f.started != nil {
		f.startOnce.Do(func() { close(f.started) })
		<-f.release
	}
	return f.res, f.err
}

func vetImportRouter(imp handler.VetImporter) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/api/admin/vets/import", handler.NewVetImportHandler(imp).Import)
	return r
}

func TestVetImportHandler_ReturnsTheRunResult(t *testing.T) {
	imp := &fakeImporter{res: osmimport.Result{
		Scanned: 183, Upserted: 183, Swept: 1,
	}}
	w := httptest.NewRecorder()
	vetImportRouter(imp).ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/api/admin/vets/import", nil))

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", w.Code, w.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("bad json: %v", err)
	}
	if body["upserted"] != float64(183) || body["swept"] != float64(1) {
		t.Errorf("body = %v", body)
	}
	// Absent, not zero: a run that swept cleanly must not look blocked.
	if _, present := body["sweep_skipped"]; present {
		t.Errorf("sweep_skipped leaked into a clean run: %v", body)
	}
}

func TestVetImportHandler_BlockedSweepIsVisibleInTheBody(t *testing.T) {
	imp := &fakeImporter{res: osmimport.Result{
		Scanned: 2, Upserted: 2, SweepSkipped: "below_threshold", ActiveBefore: 183,
	}}
	w := httptest.NewRecorder()
	vetImportRouter(imp).ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/api/admin/vets/import", nil))

	var body map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	if body["sweep_skipped"] != "below_threshold" {
		t.Errorf("the operator cannot see why nothing was deleted: %v", body)
	}
	// The reason alone does not explain the block: "2 upserted" only reads as too
	// few against the number it was measured against. Without the denominator the
	// operator cannot tell a truncated Overpass response from a real shrinkage,
	// and those two have opposite next steps.
	if body["active_before"] != float64(183) {
		t.Errorf("active_before missing from a blocked run, so the block cannot be diagnosed: %v", body)
	}
}

func TestVetImportHandler_ForceSweepTravelsFromTheBody(t *testing.T) {
	imp := &fakeImporter{res: osmimport.Result{Scanned: 2, Upserted: 2, Swept: 1, SweepForced: true}}
	req := httptest.NewRequest(http.MethodPost, "/api/admin/vets/import",
		strings.NewReader(`{"force_sweep":true,"expected_upserted":140}`))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	vetImportRouter(imp).ServeHTTP(w, req)

	if !imp.gotOpts.ForceSweep {
		t.Error("the operator asked to force the sweep and the handler dropped it")
	}
	// The flag without the number is an override with nothing behind it: the
	// importer would refuse it, so dropping this field here turns the button into
	// a no-op with no error anywhere.
	if imp.gotOpts.ExpectedUpserted != 140 {
		t.Errorf("ExpectedUpserted = %d, want the 140 the operator approved",
			imp.gotOpts.ExpectedUpserted)
	}
	var body map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	// A deletion pass that only happened because a human overrode a safety guard
	// must not read afterwards like an ordinary import.
	if body["sweep_forced"] != true {
		t.Errorf("sweep_forced missing from a forced run: %v", body)
	}
}

// A dropped override is invisible to the operator unless it survives the mapper.
// The importer sets the flag and the panel renders it, but between those two the
// value has to cross toVetImportResponse — and deleting it there leaves the whole
// Go suite green AND the web test green, because that one mocks the client. Same
// shape as the Retry-After header that curl could read and the browser could not:
// the value exists and nobody proves it reaches the consumer.
func TestVetImportHandler_ARejectedOverrideReachesTheBody(t *testing.T) {
	imp := &fakeImporter{res: osmimport.Result{
		Scanned: 12, Upserted: 12, SweepSkipped: "below_threshold",
		ActiveBefore: 183, SweepForceIgnored: true,
	}}
	req := httptest.NewRequest(http.MethodPost, "/api/admin/vets/import",
		strings.NewReader(`{"force_sweep":true,"expected_upserted":140}`))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	vetImportRouter(imp).ServeHTTP(w, req)

	var body map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	if body["sweep_force_ignored"] != true {
		t.Errorf("the override was dropped and the panel cannot tell: %v", body)
	}
}

// And absent, not false, on a run nobody forced — otherwise every ordinary block
// carries a field whose only job is to say something happened.
func TestVetImportHandler_AnOrdinaryBlockCarriesNoIgnoredFlag(t *testing.T) {
	imp := &fakeImporter{res: osmimport.Result{
		Scanned: 12, Upserted: 12, SweepSkipped: "below_threshold", ActiveBefore: 183,
	}}
	w := httptest.NewRecorder()
	vetImportRouter(imp).ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/api/admin/vets/import", nil))

	var body map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	if _, present := body["sweep_force_ignored"]; present {
		t.Errorf("sweep_force_ignored leaked into a run nobody forced: %v", body)
	}
}

// The body is optional, so anything unreadable has to land on the guarded run.
// Failing open here would turn a typo into a deletion.
func TestVetImportHandler_AnUnreadableBodyDoesNotForceAnything(t *testing.T) {
	for _, body := range []string{"", "{", `{"force_sweep":"yes"}`, `{"forceSweep":true}`} {
		imp := &fakeImporter{res: osmimport.Result{Scanned: 2, Upserted: 2}}
		req := httptest.NewRequest(http.MethodPost, "/api/admin/vets/import", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		vetImportRouter(imp).ServeHTTP(w, req)

		if imp.gotOpts.ForceSweep {
			t.Errorf("body %q forced the sweep", body)
		}
		if imp.gotOpts.ExpectedUpserted != 0 {
			t.Errorf("body %q carried an approved number into the run: %d",
				body, imp.gotOpts.ExpectedUpserted)
		}
		if w.Code != http.StatusOK {
			t.Errorf("body %q: status = %d, want the run to proceed guarded", body, w.Code)
		}
	}
}

func TestVetImportHandler_UpstreamFailureIs502(t *testing.T) {
	imp := &fakeImporter{err: errors.New("overpass returned 504")}
	w := httptest.NewRecorder()
	vetImportRouter(imp).ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/api/admin/vets/import", nil))

	if w.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, want 502", w.Code)
	}
	var body map[string]string
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	if body["code"] != "vet_import_upstream_failed" {
		t.Errorf("code = %q", body["code"])
	}
	// The upstream error text can carry the endpoint and internals; it belongs in
	// the log, not in a response body.
	if body["message"] == "overpass returned 504" {
		t.Error("raw upstream error reached the client")
	}
}

func TestVetImportHandler_SecondConcurrentRunIs409(t *testing.T) {
	imp := &fakeImporter{started: make(chan struct{}), release: make(chan struct{})}
	router := vetImportRouter(imp)

	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		w := httptest.NewRecorder()
		router.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/api/admin/vets/import", nil))
	}()

	<-imp.started // first run is inside Run and holding the flag

	w := httptest.NewRecorder()
	router.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/api/admin/vets/import", nil))
	if w.Code != http.StatusConflict {
		t.Fatalf("second run status = %d, want 409", w.Code)
	}
	var body map[string]string
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	if body["code"] != "vet_import_running" {
		t.Errorf("code = %q", body["code"])
	}

	close(imp.release)
	wg.Wait()

	// The flag must clear, or one run poisons the endpoint until the next deploy.
	w = httptest.NewRecorder()
	router.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/api/admin/vets/import", nil))
	if w.Code != http.StatusOK {
		t.Errorf("endpoint stayed locked after the run finished: %d", w.Code)
	}
}
