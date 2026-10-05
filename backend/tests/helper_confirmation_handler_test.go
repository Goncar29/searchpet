package tests

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
	"lost-pets/internal/handler"
	"lost-pets/internal/service"
)

func helperPetRouter(h *handler.PetHandler, userID uuid.UUID) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	auth := r.Group("/api/pets")
	auth.Use(injectUserID(userID))
	auth.PUT("/:id", h.UpdatePet)
	auth.PATCH("/:id/found", h.MarkAsFound)
	auth.GET("/:id/helper-candidates", h.GetHelperCandidates)
	return r
}

func doJSON(r *gin.Engine, method, path, body string) *httptest.ResponseRecorder {
	var rd *bytes.Reader
	if body == "" {
		rd = bytes.NewReader(nil)
	} else {
		rd = bytes.NewReader([]byte(body))
	}
	req := httptest.NewRequest(method, path, rd)
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func errorCode(t *testing.T, w *httptest.ResponseRecorder) string {
	t.Helper()
	var body struct {
		Code string `json:"code"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode error body %q: %v", w.Body.String(), err)
	}
	return body.Code
}

func TestPetHandler_MarkAsFound_HelperIDsBody(t *testing.T) {
	user := uuid.New()
	pet := newTestPet(user)
	helperID := uuid.New().String()

	t.Run("empty body reaches the service with a nil list", func(t *testing.T) {
		svc := &mockPetService{markAsFoundFn: func(_, _ string) (*domain.Pet, error) { return pet, nil }}
		w := doJSON(helperPetRouter(handler.NewPetHandler(svc, nil), user), http.MethodPatch, "/api/pets/"+pet.ID.String()+"/found", "")
		if w.Code != http.StatusOK {
			t.Fatalf("want 200, got %d: %s", w.Code, w.Body.String())
		}
		if svc.markAsFoundHelperIDs != nil {
			t.Fatalf("no body must mean nil, got %v", *svc.markAsFoundHelperIDs)
		}
	})

	t.Run("an empty list stays non-nil (nobody helped)", func(t *testing.T) {
		svc := &mockPetService{markAsFoundFn: func(_, _ string) (*domain.Pet, error) { return pet, nil }}
		w := doJSON(helperPetRouter(handler.NewPetHandler(svc, nil), user), http.MethodPatch, "/api/pets/"+pet.ID.String()+"/found", `{"helper_ids":[]}`)
		if w.Code != http.StatusOK {
			t.Fatalf("want 200, got %d: %s", w.Code, w.Body.String())
		}
		if svc.markAsFoundHelperIDs == nil || len(*svc.markAsFoundHelperIDs) != 0 {
			t.Fatalf("[] must reach the service as a non-nil empty list, got %v", svc.markAsFoundHelperIDs)
		}
	})

	t.Run("ids are passed through", func(t *testing.T) {
		svc := &mockPetService{markAsFoundFn: func(_, _ string) (*domain.Pet, error) { return pet, nil }}
		w := doJSON(helperPetRouter(handler.NewPetHandler(svc, nil), user), http.MethodPatch, "/api/pets/"+pet.ID.String()+"/found", `{"helper_ids":["`+helperID+`"]}`)
		if w.Code != http.StatusOK {
			t.Fatalf("want 200, got %d: %s", w.Code, w.Body.String())
		}
		if svc.markAsFoundHelperIDs == nil || len(*svc.markAsFoundHelperIDs) != 1 || (*svc.markAsFoundHelperIDs)[0] != helperID {
			t.Fatalf("ids not forwarded: %v", svc.markAsFoundHelperIDs)
		}
	})

	t.Run("malformed JSON is 400", func(t *testing.T) {
		svc := &mockPetService{}
		w := doJSON(helperPetRouter(handler.NewPetHandler(svc, nil), user), http.MethodPatch, "/api/pets/"+pet.ID.String()+"/found", `{"helper_ids":`)
		if w.Code != http.StatusBadRequest {
			t.Fatalf("want 400, got %d", w.Code)
		}
	})

	for _, tc := range []struct {
		err  error
		code string
	}{
		{domain.ErrHelperIDsRequired, "helper_ids_required"},
		{domain.ErrInvalidHelpers, "invalid_helpers"},
	} {
		tc := tc
		t.Run("maps "+tc.code+" to 400, not 500", func(t *testing.T) {
			svc := &mockPetService{markAsFoundFn: func(_, _ string) (*domain.Pet, error) { return nil, tc.err }}
			w := doJSON(helperPetRouter(handler.NewPetHandler(svc, nil), user), http.MethodPatch, "/api/pets/"+pet.ID.String()+"/found", "")
			if w.Code != http.StatusBadRequest {
				t.Fatalf("want 400, got %d: %s", w.Code, w.Body.String())
			}
			if got := errorCode(t, w); got != tc.code {
				t.Fatalf("want code %s, got %s", tc.code, got)
			}
		})
	}
}

func TestPetHandler_UpdatePet_MapsHelperErrorsTo400(t *testing.T) {
	user := uuid.New()
	for _, tc := range []struct {
		err  error
		code string
	}{
		{domain.ErrHelperIDsRequired, "helper_ids_required"},
		{domain.ErrInvalidHelpers, "invalid_helpers"},
	} {
		tc := tc
		t.Run(tc.code, func(t *testing.T) {
			var gotReq dto.UpdatePetRequest
			svc := &mockPetService{updatePetFn: func(_, _ string, req dto.UpdatePetRequest) (*domain.Pet, error) {
				gotReq = req
				return nil, tc.err
			}}
			w := doJSON(helperPetRouter(handler.NewPetHandler(svc, nil), user), http.MethodPut, "/api/pets/"+uuid.New().String(), `{"status":"found","helper_ids":[]}`)
			if w.Code != http.StatusBadRequest {
				t.Fatalf("want 400, got %d: %s", w.Code, w.Body.String())
			}
			if got := errorCode(t, w); got != tc.code {
				t.Fatalf("want code %s, got %s", tc.code, got)
			}
			if gotReq.HelperIDs == nil {
				t.Fatal("helper_ids must be bound into UpdatePetRequest")
			}
		})
	}
}

func TestReportHandler_CreateReport_MapsHelperErrorsTo400(t *testing.T) {
	reporter := uuid.New()
	for _, tc := range []struct {
		err  error
		code string
	}{
		{domain.ErrHelperIDsRequired, "helper_ids_required"},
		{domain.ErrInvalidHelpers, "invalid_helpers"},
	} {
		tc := tc
		t.Run(tc.code, func(t *testing.T) {
			var gotReq service.CreateReportRequest
			svc := &mockReportService{createReportFn: func(_ string, req service.CreateReportRequest) (*domain.Report, error) {
				gotReq = req
				return nil, tc.err
			}}
			r := setupReportRouter(handler.NewReportHandler(svc, nil), reporter)
			w := doJSON(r, http.MethodPost, "/api/reports", `{"pet_id":"`+uuid.New().String()+`","status":"found","latitude":-34.9,"longitude":-56.1,"helper_ids":[]}`)
			if w.Code != http.StatusBadRequest {
				t.Fatalf("want 400, got %d: %s", w.Code, w.Body.String())
			}
			if got := errorCode(t, w); got != tc.code {
				t.Fatalf("want code %s, got %s", tc.code, got)
			}
			if gotReq.HelperIDs == nil {
				t.Fatal("helper_ids must be bound into CreateReportRequest")
			}
		})
	}
}

func TestPetHandler_GetHelperCandidates(t *testing.T) {
	owner := uuid.New()
	petID := uuid.New().String()
	cand := domain.HelperCandidate{ID: uuid.New(), Name: "Ana", ProfilePhotoURL: "https://img/a.webp"}

	t.Run("owner gets 200 with the candidates", func(t *testing.T) {
		svc := &mockPetService{helperCandidatesFn: func(userID, id string) ([]domain.HelperCandidate, error) {
			if userID != owner.String() || id != petID {
				t.Errorf("unexpected args %s %s", userID, id)
			}
			return []domain.HelperCandidate{cand}, nil
		}}
		w := doJSON(helperPetRouter(handler.NewPetHandler(svc, nil), owner), http.MethodGet, "/api/pets/"+petID+"/helper-candidates", "")
		if w.Code != http.StatusOK {
			t.Fatalf("want 200, got %d: %s", w.Code, w.Body.String())
		}
		var got []map[string]interface{}
		if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
			t.Fatal(err)
		}
		if len(got) != 1 || got[0]["id"] != cand.ID.String() || got[0]["name"] != "Ana" {
			t.Fatalf("bad body: %s", w.Body.String())
		}
		if _, leaked := got[0]["email"]; leaked {
			t.Fatal("candidates must never carry an email")
		}
	})

	t.Run("no candidates is an empty array, not null", func(t *testing.T) {
		svc := &mockPetService{}
		w := doJSON(helperPetRouter(handler.NewPetHandler(svc, nil), owner), http.MethodGet, "/api/pets/"+petID+"/helper-candidates", "")
		if w.Code != http.StatusOK || bytes.TrimSpace(w.Body.Bytes())[0] != '[' || string(bytes.TrimSpace(w.Body.Bytes())) != "[]" {
			t.Fatalf("want 200 [], got %d %s", w.Code, w.Body.String())
		}
	})

	t.Run("non-owner gets 403", func(t *testing.T) {
		svc := &mockPetService{helperCandidatesFn: func(string, string) ([]domain.HelperCandidate, error) {
			return nil, domain.ErrForbidden
		}}
		w := doJSON(helperPetRouter(handler.NewPetHandler(svc, nil), uuid.New()), http.MethodGet, "/api/pets/"+petID+"/helper-candidates", "")
		if w.Code != http.StatusForbidden {
			t.Fatalf("want 403, got %d", w.Code)
		}
	})

	t.Run("unknown pet gets 404 and a failure 500", func(t *testing.T) {
		svc := &mockPetService{helperCandidatesFn: func(string, string) ([]domain.HelperCandidate, error) {
			return nil, domain.ErrPetNotFound
		}}
		w := doJSON(helperPetRouter(handler.NewPetHandler(svc, nil), owner), http.MethodGet, "/api/pets/"+petID+"/helper-candidates", "")
		if w.Code != http.StatusNotFound {
			t.Fatalf("want 404, got %d", w.Code)
		}
		svc = &mockPetService{helperCandidatesFn: func(string, string) ([]domain.HelperCandidate, error) {
			return nil, errors.New("boom")
		}}
		w = doJSON(helperPetRouter(handler.NewPetHandler(svc, nil), owner), http.MethodGet, "/api/pets/"+petID+"/helper-candidates", "")
		if w.Code != http.StatusInternalServerError {
			t.Fatalf("want 500, got %d", w.Code)
		}
	})
}
