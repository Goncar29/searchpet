// Package osmimport fetches veterinary POIs from the OpenStreetMap Overpass API
// and upserts them into the vets table. It is a one-off, idempotent batch job
// (see cmd/import-vets). Querying Overpass is rate-respectful: a handful of
// requests per run, never per user request.
package osmimport

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"go.uber.org/zap"
	"lost-pets/internal/domain"
	"lost-pets/internal/repository"
)

// DefaultOverpassEndpoint is the public Overpass API interpreter.
const DefaultOverpassEndpoint = "https://overpass-api.de/api/interpreter"

// uruguayVetQuery selects every amenity=veterinary node/way inside Uruguay.
// `out center tags` gives ways a representative lat/lng.
const uruguayVetQuery = `[out:json][timeout:120];
area["ISO3166-1"="UY"][admin_level=2]->.uy;
(
  node["amenity"="veterinary"](area.uy);
  way["amenity"="veterinary"](area.uy);
);
out center tags;`

type overpassCenter struct {
	Lat float64 `json:"lat"`
	Lon float64 `json:"lon"`
}

type overpassElement struct {
	Type   string            `json:"type"`
	ID     int64             `json:"id"`
	Lat    float64           `json:"lat"`
	Lon    float64           `json:"lon"`
	Center *overpassCenter   `json:"center"`
	Tags   map[string]string `json:"tags"`
}

type overpassResponse struct {
	Elements []overpassElement `json:"elements"`
}

// sweepMinRatio is the share of the existing OSM rows a run must re-upsert before
// it is allowed to delete anything. It defends the ugly failure mode: Overpass
// answering 200 with a short body and no error, which a blind sweep would read as
// "OpenStreetMap dropped almost every vet in Uruguay".
//
// 0.8 is judgement, not measurement — the real run re-upserts ~100%. If it ever
// blocks a legitimate import, that is the number to revisit, and revisiting it
// means looking at what OSM actually did, not at this file.
const sweepMinRatio = 0.8

// belowThreshold is the ONLY place the ratio is evaluated. Two copies of this
// comparison drift, and here the drift would be silent in the worst possible
// shape: the sweep running under one rule while the response reports it as
// forced under another, which makes sweep_forced lie about the one thing it
// exists to record. Same defect the two hardcoded 5000s caused in the map layer
// (PR #153) — the rule lives in one function, and the call sites ask it.
//
// The count is deliberately unnamed as to WHICH number it is: sweepReason applies
// the same ratio to Scanned and to Upserted, and the difference between those two
// answers is what separates "OSM shrank" from "we dropped rows".
func belowThreshold(count int, activeBefore int64) bool {
	return float64(count) < sweepMinRatio*float64(activeBefore)
}

// forceApplies reports whether the operator's override may take effect for THIS
// run — the only place that question is answered, for the same reason
// belowThreshold is the only place the ratio is evaluated.
//
// The override is a decision about an outcome the operator READ, and pressing
// the button starts a fresh run that can return anything. So it is granted
// against a number: a run that brings back at least what was approved is the run
// the approval was about, and one that comes back short is not, no matter what
// the caller asked for.
//
// The number is Upserted, because that is what the guard it unlocks measures. An
// override pinned to anything else would approve one quantity while disabling a
// check on another — the same shape as the defect it was written to fix. It also
// closes the truncated-response case on its own: Upserted can never exceed
// Scanned, so a response cut down to a handful of elements cannot reach a pin
// granted for a hundred.
//
// A floor rather than an equality: OSM can gain a clinic between two runs, and an
// override that silently does nothing gets pressed again instead of read.
func forceApplies(opts RunOptions, upserted int) bool {
	return opts.ForceSweep && opts.ExpectedUpserted > 0 && upserted >= opts.ExpectedUpserted
}

// Result summarizes an import run.
type Result struct {
	Scanned  int
	Upserted int
	// SkippedNoCoords counts OSM elements with no usable coordinates. A handful do
	// NOT block the sweep: a clinic we cannot place on a map is one we cannot show
	// either, so retiring it is the honest outcome. A systematic wave of them does
	// block it, under mapping_failures — see sweepReason.
	//
	// Note what that costs, because it is not "these rows were never ours": a way
	// imported earlier WITH a center that comes back without one (broken geometry
	// upstream) is still listed in OSM and still gets swept. Soft delete makes it
	// self-healing — the next run with a usable center resurrects it through
	// Upsert — which is why this is acceptable rather than guarded against.
	SkippedNoCoords int
	// UpsertFailed counts rows whose write failed. These ARE in the table with a
	// stale last_synced_at, so a sweep would delete a vet that is alive in OSM.
	// Keeping this separate from SkippedNoCoords is what lets guard 2 be correct.
	UpsertFailed int
	// Swept counts rows soft-deleted because OSM no longer lists them.
	Swept int
	// SweepSkipped names the guard that blocked the sweep, or "" when it ran.
	SweepSkipped string
	// SweepForced is true when the operator overrode the threshold and the sweep
	// then actually ran. A deletion pass that happened because a human insisted
	// has to stay legible afterwards — in the response and in the log.
	SweepForced bool
	// SweepForceIgnored is true when an override was requested and the threshold
	// blocked the run anyway, because this run did not reach the number it was
	// granted for. Without it a dropped override looks byte-identical to one that
	// was never sent, and "the button did nothing" reads as an invitation to press
	// it again — which re-pins the approval to the run that just came back short.
	SweepForceIgnored bool
	// ActiveBefore is how many live OSM rows existed when the run started — the
	// denominator of the threshold guard. It travels all the way to the response
	// on purpose: without it an operator reads "140 saved, 0 retired" and cannot
	// see the 183 that blocked the sweep, which is the one number that explains
	// the outcome.
	ActiveBefore int64
}

// RunOptions carries the caller's overrides. It is a struct rather than a bare
// bool so that call sites read as `Run(ctx, RunOptions{})` instead of
// `Run(ctx, false)`, where the reader has to go look up what false meant.
type RunOptions struct {
	// ForceSweep lets the sweep proceed even when this run re-upserted too few
	// rows to clear sweepMinRatio. It exists because that guard cannot untrip
	// itself: activeBefore comes from the table, and a blocked sweep never
	// changes it, so a genuine upstream shrinkage blocks every future run with
	// identical inputs. The operator who has run the import twice and read the
	// same number twice holds evidence the process cannot get on its own.
	//
	// It reaches ONLY the threshold, and that asymmetry is the whole design: the
	// threshold doubts OpenStreetMap, which a human can go and check. The other
	// two guards doubt US — our writes (upsert_failures) and our mapping
	// (mapping_failures) — and no operator can see either from the panel, so
	// neither is theirs to overrule.
	ForceSweep bool
	// ExpectedUpserted is how many elements the operator saw the blocked run bring
	// back from OpenStreetMap — the number the threshold measured, not what we
	// then saved from it. It
	// is what turns the override from a blank cheque into a decision about a
	// specific outcome: forcing starts a NEW run, so the numbers that justified
	// pressing the button describe a run that is already over. Without this pin,
	// a third response that comes back truncated would sweep under an approval
	// granted for a different one — with the threshold guard, written for exactly
	// that response, switched off.
	//
	// Zero means no evidence, and no evidence means no override (see forceApplies).
	ExpectedUpserted int
}

// Importer pulls OSM vets and upserts them via the repository.
type Importer struct {
	repo       repository.VetRepository
	httpClient *http.Client
	endpoint   string
	logger     *zap.Logger
}

// New builds an Importer. Pass DefaultOverpassEndpoint unless overriding for tests.
// It takes the repository rather than a *gorm.DB so the HTTP handler can drive the
// same importer the CLI does, without either one owning a database handle.
func New(repo repository.VetRepository, client *http.Client, endpoint string, log *zap.Logger) *Importer {
	return &Importer{
		repo:       repo,
		httpClient: client,
		endpoint:   endpoint,
		logger:     log,
	}
}

// Run fetches Uruguay vets from Overpass, upserts each into the vets table, and
// then soft-deletes the rows this run did not touch — but only if the run passes
// all three guards (see sweepReason).
func (i *Importer) Run(ctx context.Context, opts RunOptions) (Result, error) {
	var res Result

	// Captured BEFORE the fetch: every successful upsert writes a later
	// last_synced_at, so whatever stays behind this instant is what OSM no
	// longer lists.
	cutoff := time.Now()

	activeBefore, err := i.repo.CountActiveOSM(ctx)
	if err != nil {
		return res, fmt.Errorf("osmimport: count active: %w", err)
	}
	res.ActiveBefore = activeBefore

	body, err := i.fetch(ctx)
	if err != nil {
		return res, err
	}
	elements, err := parseOverpass(body)
	if err != nil {
		return res, err
	}

	for _, el := range elements {
		res.Scanned++
		vet, ok := mapElement(el)
		if !ok {
			i.logger.Warn("[osmimport] skipping element without usable coords",
				zap.String("type", el.Type), zap.Int64("id", el.ID))
			res.SkippedNoCoords++
			continue
		}
		if err := i.repo.Upsert(ctx, vet); err != nil {
			i.logger.Warn("[osmimport] upsert failed",
				zap.String("osm_type", vet.OSMType), zap.Int64("osm_id", vet.OSMID), zap.Error(err))
			res.UpsertFailed++
			continue
		}
		res.Upserted++
	}

	res.SweepSkipped = sweepReason(res, activeBefore, opts)
	if res.SweepSkipped == "" {
		// Recorded only when the override actually changed the outcome: a forced
		// flag on a run that would have swept anyway would misreport a routine
		// import as an operator overriding a safety guard.
		res.SweepForced = forceApplies(opts, res.Upserted) && belowThreshold(res.Upserted, activeBefore)
		if res.SweepForced {
			i.logger.Warn("[osmimport] sweeping below the threshold because the caller forced it",
				zap.Int("upserted", res.Upserted), zap.Int("expected_upserted", opts.ExpectedUpserted),
				zap.Int64("active_before", activeBefore))
		}
		swept, err := i.repo.SoftDeleteStaleBefore(ctx, cutoff)
		if err != nil {
			return res, fmt.Errorf("osmimport: sweep: %w", err)
		}
		res.Swept = int(swept)
	} else {
		// Only the threshold can drop an override; the other two never accept one,
		// so reporting them as "your force was ignored" would be false.
		res.SweepForceIgnored = opts.ForceSweep && res.SweepSkipped == "below_threshold"
		i.logger.Warn("[osmimport] sweep skipped",
			zap.String("reason", res.SweepSkipped),
			zap.Bool("force_ignored", res.SweepForceIgnored),
			zap.Int("upserted", res.Upserted), zap.Int64("active_before", activeBefore))
	}

	i.logger.Info("[osmimport] done",
		zap.Int("scanned", res.Scanned), zap.Int("upserted", res.Upserted),
		zap.Int("skipped_no_coords", res.SkippedNoCoords), zap.Int("upsert_failed", res.UpsertFailed),
		zap.Int("swept", res.Swept), zap.String("sweep_skipped", res.SweepSkipped),
		zap.Bool("sweep_forced", res.SweepForced))
	return res, nil
}

// sweepReason returns "" when the run earned the right to delete rows, or the name
// of the guard that blocked it.
//
// Three guards, in the order a diagnosis is useful rather than the order they
// were written: the two that doubt US come first, so a run whose rows went
// missing through our own writes or our own mapping is NAMED for that, instead
// of being reported as an OpenStreetMap shrinkage the operator is invited to
// override. The last one is the only one they can override.
//
// The ordering is load-bearing for a second reason. below_threshold is the
// promise "no run retires more than a fifth of the table unasked", and it has to
// be the LAST word, measured on what actually survives (Upserted) against the
// table. An earlier version moved it onto Scanned so that our mapping losses
// could not trip it; that split the promise into two ratios in series, and
// ratios in series multiply — Scanned >= 0.8*activeBefore with
// Upserted >= 0.8*Scanned only yields Upserted >= 0.64*activeBefore, so a run
// retired 35% of the table with every guard satisfied. Separating the CAUSES is
// what that change was for, and mapping_failures below does it; the bound stays
// where it always was.
func sweepReason(res Result, activeBefore int64, opts RunOptions) string {
	// Our writes failed, so those rows kept an old timestamp while still existing
	// in OSM. Sweeping now would delete live clinics.
	//
	// force does NOT reach this branch, and the order is not what protects it —
	// the check below simply never runs when this one returns. An operator can
	// verify what OpenStreetMap says by looking; they cannot see that our own
	// upserts failed, so this is not theirs to overrule.
	if res.UpsertFailed > 0 {
		return "upsert_failures"
	}
	// We lost too much of what the response DID contain — every element that
	// mapElement could not place (a way with no center). Measured against Scanned,
	// because the question is what share of OSM's answer WE dropped, which has
	// nothing to do with how big the table is. One broken way is ordinary and must
	// not trap the sweep, so it is the same ratio rather than "any skip at all";
	// at real scale one loss out of 183 is nowhere near the line.
	//
	// Ahead of below_threshold on purpose. Both can be true at once, and when they
	// are, the FIRST answer is the one the panel shows: reporting a mapping
	// regression as an OpenStreetMap shrinkage hands the operator the override
	// button for a problem that is ours, which is the whole failure this guard was
	// added to close.
	//
	// Not forcible, and not for symmetry. A mapping regression produces a number
	// that REPEATS run after run — because the fault is ours and deterministic —
	// and repetition is exactly what the confirmation dialog teaches the operator
	// to read as "the drop is real, go ahead". They would be approving the one
	// thing they cannot see from that screen.
	if belowThreshold(res.Upserted, int64(res.Scanned)) {
		return "mapping_failures"
	}
	// Too few rows survive this run to retire the rest of the table — the bound on
	// how much one import may delete, measured on what actually survives against
	// what we hold. Everything above has already been ruled out, so whatever is
	// missing here is missing because OpenStreetMap no longer lists it.
	//
	// This guard cannot untrip itself: activeBefore is what the table holds, and a
	// blocked sweep changes nothing, so a LEGITIMATE drop below the ratio (an
	// upstream retagging campaign, say) would block every future run with
	// identical inputs, forever. RunOptions.ForceSweep is that exit, and it is
	// deliberately the operator's to pull rather than something the process
	// decides for itself: the evidence that the response is honest — having run
	// it twice and read the same number twice — lives with the human.
	//
	// forceApplies, not opts.ForceSweep: the flag alone would hand the exit to a
	// run the operator never saw, which is the failure this guard exists for.
	if belowThreshold(res.Upserted, activeBefore) && !forceApplies(opts, res.Upserted) {
		return "below_threshold"
	}
	return ""
}

// fetch POSTs the Overpass QL query and returns the raw response body.
// The query must be sent URL-encoded as the "data" form field; sending it raw
// makes Overpass reject the request with 406 Not Acceptable.
func (i *Importer) fetch(ctx context.Context) ([]byte, error) {
	form := url.Values{}
	form.Set("data", uruguayVetQuery)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, i.endpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, fmt.Errorf("osmimport: build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	// Overpass/Apache rejects the default Go user agent (Go-http-client) with
	// 406; it also asks for an identifying UA by etiquette.
	req.Header.Set("User-Agent", "SearchPet/1.0 (lost-pets app; OSM veterinary import; +https://github.com/Goncar29/searchpet)")

	resp, err := i.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("osmimport: overpass request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		return nil, fmt.Errorf("osmimport: overpass returned %d: %s", resp.StatusCode, string(b))
	}
	// Defensive ceiling: Uruguay's payload is a few hundred KB; cap at 50 MB
	// so a wrong endpoint / malformed response can't exhaust memory.
	return io.ReadAll(io.LimitReader(resp.Body, 50<<20))
}

func parseOverpass(body []byte) ([]overpassElement, error) {
	var parsed overpassResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return nil, fmt.Errorf("osmimport: parse response: %w", err)
	}
	return parsed.Elements, nil
}

// mapElement converts an Overpass element into a domain.Vet. Returns ok=false
// when no usable coordinates are present (e.g. a way without a center).
func mapElement(el overpassElement) (*domain.Vet, bool) {
	lat, lng := el.Lat, el.Lon
	if lat == 0 && lng == 0 && el.Center != nil {
		lat, lng = el.Center.Lat, el.Center.Lon
	}
	if lat == 0 && lng == 0 {
		return nil, false
	}

	tags := el.Tags
	if tags == nil {
		tags = map[string]string{}
	}

	phone := firstNonEmpty(tags["phone"], tags["contact:phone"])
	// Each candidate is checked on its own so an unusable primary tag falls back
	// to a usable contact one instead of taking both down.
	website := firstNonEmpty(safeWebsite(tags["website"]), safeWebsite(tags["contact:website"]))

	return &domain.Vet{
		OSMType:      el.Type,
		OSMID:        el.ID,
		Name:         tags["name"],
		Latitude:     lat,
		Longitude:    lng,
		Address:      composeAddress(tags),
		Phone:        phone,
		Website:      website,
		OpeningHours: tags["opening_hours"],
		Source:       "osm",
		LastSyncedAt: time.Now(),
	}, true
}

func composeAddress(tags map[string]string) string {
	street := tags["addr:street"]
	num := tags["addr:housenumber"]
	switch {
	case street != "" && num != "":
		return street + " " + num
	case street != "":
		return street
	default:
		return ""
	}
}

// safeWebsite keeps a website tag only when it is an http(s) URL with a host.
//
// This value is world-editable — anyone can retag a clinic in OpenStreetMap —
// and it ends up in an href on the map popup, where a javascript: or data:
// scheme would execute in the visitor's page. It is filtered HERE, at the seam
// where third-party data enters, rather than at each renderer: the row feeds a
// public endpoint (GET /api/vets/nearby) with more than one consumer, and a
// filter at the door covers the ones nobody has written yet.
//
// Shelter URLs already get this at their own door (validOptionalHTTPSURL in
// shelter_dto.go, on both the create and the update path). Vets had no door,
// because no human ever types this value into one of our forms.
func safeWebsite(raw string) string {
	// OSM tags are typed by people, so a stray space is ordinary. Without this the
	// URL fails to parse — " https://x.uy" reads as a path segment containing a
	// colon — and a perfectly good link disappears with no error anywhere.
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	u, err := url.Parse(raw)
	// url.Parse lowercases the scheme, so "JavaScript:" is caught here too, and a
	// protocol-relative "//host" parses cleanly with an empty scheme.
	if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") {
		return ""
	}
	return raw
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}
