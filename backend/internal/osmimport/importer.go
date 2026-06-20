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
	"gorm.io/gorm"
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

// Result summarizes an import run.
type Result struct {
	Scanned  int
	Upserted int
	Skipped  int
}

// Importer pulls OSM vets and upserts them via the repository.
type Importer struct {
	repo       repository.VetRepository
	httpClient *http.Client
	endpoint   string
	logger     *zap.Logger
}

// New builds an Importer. Pass DefaultOverpassEndpoint unless overriding for tests.
func New(db *gorm.DB, client *http.Client, endpoint string) *Importer {
	logger, _ := zap.NewProduction()
	return &Importer{
		repo:       repository.NewVetRepository(db),
		httpClient: client,
		endpoint:   endpoint,
		logger:     logger,
	}
}

// Run fetches Uruguay vets from Overpass and upserts each into the vets table.
func (i *Importer) Run(ctx context.Context) (Result, error) {
	var res Result

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
			res.Skipped++
			continue
		}
		if err := i.repo.Upsert(ctx, vet); err != nil {
			i.logger.Warn("[osmimport] upsert failed",
				zap.String("osm_type", vet.OSMType), zap.Int64("osm_id", vet.OSMID), zap.Error(err))
			res.Skipped++
			continue
		}
		res.Upserted++
	}

	i.logger.Info("[osmimport] done",
		zap.Int("scanned", res.Scanned), zap.Int("upserted", res.Upserted), zap.Int("skipped", res.Skipped))
	return res, nil
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
		b, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("osmimport: overpass returned %d: %s", resp.StatusCode, string(b))
	}
	return io.ReadAll(resp.Body)
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
	website := firstNonEmpty(tags["website"], tags["contact:website"])

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

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}
