//go:build e2e

package e2e_test

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
)

// El marcador del mapa muestra la foto de la mascota, pero la API nunca la
// mandaba: `ReportPetResponse` era {id,name,type} y `FindNearby` sólo hacía
// `Preload("Pet")`. El pin caía siempre al respaldo sin foto.
//
// ESTE TEST TIENE QUE SER e2e Y NO UNITARIO, y ese es el punto. El mapper nunca
// estuvo roto: con un `domain.Report` armado a mano —fotos incluidas— siempre
// devolvió lo correcto. Lo que faltaba era el PRELOAD, y un `Preload` ausente
// sólo se ve contra una base de verdad. Es la regla #34 otra vez: los mocks no
// tienen relaciones, así que no pueden dejar de cargarlas.
func TestNearby_MandaLaFotoDeLaMascota(t *testing.T) {
	baseURL, db, cleanup := startTestServerWithDB(t)
	defer cleanup()

	token, email := registerAndLogin(t, baseURL)
	petID := createPet(t, baseURL, token, "Firulais")

	// Raza y color los usa el subtítulo del popup, y tampoco viajaban.
	if err := db.Model(&domain.Pet{}).Where("id = ?", petID).
		Updates(map[string]any{"breed": "Labrador", "color": "Negro"}).Error; err != nil {
		t.Fatalf("no se pudo setear raza/color: %v", err)
	}

	// El usuario entero y no un Scan a uuid.UUID sobre la columna cruda: el
	// driver entrega el id como string y Scan intenta meterlo en un [16]byte.
	var uploader domain.User
	if err := db.Where("email = ?", email).First(&uploader).Error; err != nil {
		t.Fatalf("no se pudo leer el usuario: %v", err)
	}
	uploaderID := uploader.ID

	// DOS fotos, y la PRIMARIA se inserta SEGUNDA. Con una sola, el test pasaría
	// igual tomando "la primera que venga": no distinguiría elegir la primaria de
	// elegir cualquiera.
	fotos := []domain.Photo{
		{PetID: uuid.MustParse(petID), URL: "https://res.cloudinary.com/x/image/upload/v1/secundaria.webp", PublicID: "secreto-secundaria", UploadedBy: uploaderID, IsPrimary: false},
		{PetID: uuid.MustParse(petID), URL: "https://res.cloudinary.com/x/image/upload/v1/principal.webp", PublicID: "secreto-principal", UploadedBy: uploaderID, IsPrimary: true},
	}
	for i := range fotos {
		if err := db.Create(&fotos[i]).Error; err != nil {
			t.Fatalf("no se pudo sembrar la foto %d: %v", i, err)
		}
	}

	reportBody, _ := json.Marshal(map[string]interface{}{
		"pet_id":    petID,
		"status":    "lost",
		"latitude":  -34.9011,
		"longitude": -56.1645,
	})
	req, _ := http.NewRequest(http.MethodPost, baseURL+"/api/reports", bytes.NewReader(reportBody))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("create report: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create report: want 201, got %d", resp.StatusCode)
	}

	params := url.Values{}
	params.Set("lat", "-34.9011")
	params.Set("lng", "-56.1645")
	params.Set("radius", "5000")

	nearbyResp, err := http.Get(baseURL + "/api/reports/nearby?" + params.Encode())
	if err != nil {
		t.Fatalf("nearby: %v", err)
	}
	defer nearbyResp.Body.Close()
	if nearbyResp.StatusCode != http.StatusOK {
		t.Fatalf("nearby: want 200, got %d", nearbyResp.StatusCode)
	}

	crudo, err := io.ReadAll(nearbyResp.Body)
	if err != nil {
		t.Fatalf("nearby: no se pudo leer el cuerpo: %v", err)
	}

	var nearby struct {
		Data []struct {
			Pet struct {
				Name   string `json:"name"`
				Breed  string `json:"breed"`
				Color  string `json:"color"`
				Photos []struct {
					URL       string `json:"url"`
					IsPrimary bool   `json:"is_primary"`
				} `json:"photos"`
			} `json:"pet"`
		} `json:"data"`
	}
	if err := json.Unmarshal(crudo, &nearby); err != nil {
		t.Fatalf("nearby: decode: %v", err)
	}
	if len(nearby.Data) != 1 {
		t.Fatalf("want 1 reporte, got %d", len(nearby.Data))
	}

	pet := nearby.Data[0].Pet
	if len(pet.Photos) != 1 {
		t.Fatalf("el mapa necesita UNA foto por marcador, got %d", len(pet.Photos))
	}
	if !pet.Photos[0].IsPrimary {
		t.Errorf("want la foto PRIMARIA, got una secundaria")
	}
	if !strings.HasSuffix(pet.Photos[0].URL, "principal.webp") {
		t.Errorf("want la url de la primaria, got %q", pet.Photos[0].URL)
	}
	if pet.Breed != "Labrador" || pet.Color != "Negro" {
		t.Errorf("want raza/color en la respuesta, got %q/%q", pet.Breed, pet.Color)
	}

	// El public_id de Cloudinary NO se expone. `domain.Photo` lo marca `json:"-"`,
	// pero eso protege al MODELO: acá se comprueba lo que de verdad sale por el
	// cable, que es lo único que ve un atacante.
	if strings.Contains(string(crudo), "secreto-") {
		t.Error("el public_id de Cloudinary se filtro en la respuesta")
	}
}

// Sin fotos la respuesta trae una lista VACIA y nunca `null`. Con `null`, cada
// consumidor tendria que distinguir "sin fotos" de "no vino el campo", y son lo
// mismo.
func TestNearby_SinFotosMandaListaVacia(t *testing.T) {
	baseURL, cleanup := startTestServer(t)
	defer cleanup()

	token, _ := registerAndLogin(t, baseURL)
	petID := createPet(t, baseURL, token, "SinFoto")

	reportBody, _ := json.Marshal(map[string]interface{}{
		"pet_id":    petID,
		"status":    "lost",
		"latitude":  -34.9011,
		"longitude": -56.1645,
	})
	req, _ := http.NewRequest(http.MethodPost, baseURL+"/api/reports", bytes.NewReader(reportBody))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("create report: %v", err)
	}
	defer resp.Body.Close()

	params := url.Values{}
	params.Set("lat", "-34.9011")
	params.Set("lng", "-56.1645")
	params.Set("radius", "5000")

	nearbyResp, err := http.Get(baseURL + "/api/reports/nearby?" + params.Encode())
	if err != nil {
		t.Fatalf("nearby: %v", err)
	}
	defer nearbyResp.Body.Close()

	crudo, _ := io.ReadAll(nearbyResp.Body)
	if strings.Contains(string(crudo), `"photos":null`) {
		t.Error(`want "photos":[], got "photos":null`)
	}
}
