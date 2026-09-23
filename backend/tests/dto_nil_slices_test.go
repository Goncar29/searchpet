package tests

// Un slice nil de Go se serializa como `null`, no como `[]`. Es el bug que tumbó
// `/admin/impact` entero el 2026-09-16 (PR #249): `pets_by_type` viajaba `null`
// con la base sin mascotas y el frontend hacía `.map()` sobre eso.
//
// Ese arreglo cerró UN campo. Este archivo cierra la CLASE en la capa de DTOs,
// que es donde se arma casi todo el JSON de la API.
//
// El invariante: **un mapper con la entrada vacía produce `[]`, nunca `null`.**
//
// Son dos mitades y las dos hacen falta:
//
//   - `TestDTO_MappersVaciosNoProducenSlicesNil` afirma el invariante llamando a
//     cada mapper de verdad con entrada vacía.
//   - `TestDTO_TodoMapperExportadoEstaCubierto` barre `internal/dto` con el AST y
//     exige que cada func exportada esté en la tabla o en la allowlist. Sin esta
//     mitad, la tabla envejece sola: un mapper nuevo no rompe nada, simplemente
//     no se mira — el modo de falla de toda lista curada.
//
// El barrido NO filtra por prefijo de nombre (`To*`/`Map*`) a propósito: un
// guard que decide qué mirar por cómo se llama la cosa queda ciego justo ante lo
// que no siguió la convención.

import (
	"encoding/json"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
)

// dtoPackageDir es la ruta al paquete que se barre, relativa a este archivo.
const dtoPackageDir = "../internal/dto"

// respuestasDesdeVacio llama a cada mapper exportado de `internal/dto` con la
// entrada vacía —el escenario que rompió producción— y devuelve lo que se
// serializaría. Las claves son los nombres de las funcs y el barrido de abajo
// las compara contra el paquete real.
//
// Se cubren TODOS los mappers, no sólo los que devuelven listas: un objeto
// suelto puede traer un array adentro (`PetResponse.photos`), y ahí el `null`
// rompe igual.
var respuestasDesdeVacio = map[string]func() any{
	// --- listas ---
	"ToAbuseReportListResponse":             func() any { return dto.ToAbuseReportListResponse(nil) },
	"ToAdminAuditLogResponses":              func() any { return dto.ToAdminAuditLogResponses(nil) },
	"ToAdminShelterListResponse":            func() any { return dto.ToAdminShelterListResponse(nil) },
	"ToFosterHomeChangeLogListResponse":     func() any { return dto.ToFosterHomeChangeLogListResponse(nil) },
	"ToFosterHomeListResponse":              func() any { return dto.ToFosterHomeListResponse(nil) },
	"ToFosterHomeModerationLogListResponse": func() any { return dto.ToFosterHomeModerationLogListResponse(nil) },
	"ToGroupListResponse":                   func() any { return dto.ToGroupListResponse(nil) },
	"ToLocationAlertResponseList":           func() any { return dto.ToLocationAlertResponseList(nil) },
	"ToMemberListResponse":                  func() any { return dto.ToMemberListResponse(nil) },
	"ToMessageListResponse":                 func() any { return dto.ToMessageListResponse(nil) },
	"ToMyFosterHomeListResponse":            func() any { return dto.ToMyFosterHomeListResponse(nil) },
	"ToPetListResponse":                     func() any { return dto.ToPetListResponse(nil) },
	"ToPhotoListResponse":                   func() any { return dto.ToPhotoListResponse(nil) },
	"ToReportListResponse":                  func() any { return dto.ToReportListResponse(nil) },
	"ToShelterListResponse":                 func() any { return dto.ToShelterListResponse(nil) },
	"ToStoryListResponse":                   func() any { return dto.ToStoryListResponse(nil) },
	"ToStoryListResponseWithLikes":          func() any { return dto.ToStoryListResponseWithLikes(nil, nil) },
	"ToStrayCandidateList":                  func() any { return dto.ToStrayCandidateList(nil) },
	"ToVetListResponse":                     func() any { return dto.ToVetListResponse(nil) },

	// --- objetos sueltos (pueden traer un array adentro) ---
	"MapReviewToResponse":                func() any { return dto.MapReviewToResponse(&domain.UserReview{}) },
	"ToAbuseReportResponse":              func() any { return dto.ToAbuseReportResponse(&domain.ReportAbuse{}) },
	"ToAdminAuditLogListResponse":        func() any { return dto.ToAdminAuditLogListResponse(nil, 0, 1, 20) },
	"ToAdminShelterResponse":             func() any { return dto.ToAdminShelterResponse(&domain.Shelter{}) },
	"ToBlockedUserResponse":              func() any { return dto.ToBlockedUserResponse(&domain.BlockedUser{}) },
	"ToFosterHomeChangeLogResponse":      func() any { return dto.ToFosterHomeChangeLogResponse(&domain.FosterHomeChangeLog{}) },
	"ToFosterHomeModerationLogResponse":  func() any { return dto.ToFosterHomeModerationLogResponse(&domain.FosterHomeModerationLog{}) },
	"ToFosterHomeResponse":               func() any { return dto.ToFosterHomeResponse(&domain.FosterHome{}) },
	"ToGenerateShareLinkResponse":        func() any { return dto.ToGenerateShareLinkResponse("tok", "https://x.test", time.Now()) },
	"ToGroupResponse":                    func() any { return dto.ToGroupResponse(&domain.LocalGroup{}) },
	"ToLocationAlertResponse":            func() any { return dto.ToLocationAlertResponse(&domain.LocationAlert{}) },
	"ToMemberResponse":                   func() any { return dto.ToMemberResponse(&domain.GroupMember{}) },
	"ToMessageResponse":                  func() any { return dto.ToMessageResponse(&domain.Message{}) },
	"ToMyFosterHomeResponse":             func() any { return dto.ToMyFosterHomeResponse(&domain.FosterHome{}) },
	"ToMyShelterResponse":                func() any { return dto.ToMyShelterResponse(&domain.Shelter{}) },
	"ToPetResponse":                      func() any { return dto.ToPetResponse(&domain.Pet{}) },
	"ToPhotoResponse":                    func() any { return dto.ToPhotoResponse(&domain.Photo{}) },
	"ToReportResponse":                   func() any { return dto.ToReportResponse(&domain.Report{}) },
	"ToShareLinkPublicResponse":          func() any { return dto.ToShareLinkPublicResponse(&domain.ShareLink{}) },
	"ToShelterResponse":                  func() any { return dto.ToShelterResponse(&domain.Shelter{}) },
	"ToStoryResponse":                    func() any { return dto.ToStoryResponse(&domain.SuccessStory{}) },
	"ToStoryResponseWithLike":            func() any { return dto.ToStoryResponseWithLike(&domain.SuccessStory{}, false) },
	"ToUserResponse":                     func() any { return dto.ToUserResponse(&domain.User{}) },
	"ToVetResponse":                      func() any { return dto.ToVetResponse(domain.VetNearbyResult{}) },
}

// respuestasConUnItem cubre la otra mitad del recorrido: con la entrada vacía
// TODOS los slices quedan en largo 0, así que la rama que entra a los elementos
// de una lista nunca llega a correr. Un array nulo ANIDADO dentro de un elemento
// —el caso que rompe una lista con datos— se escaparía.
//
// Es cobertura aditiva y NO la gobierna el barrido: que envejezca resta
// profundidad, nunca produce un verde falso. La tabla de arriba es la que el
// barrido obliga a mantener completa.
var respuestasConUnItem = map[string]func() any{
	"ToFosterHomeListResponse": func() any { return dto.ToFosterHomeListResponse([]domain.FosterHome{{}}) },
	"ToPetListResponse":        func() any { return dto.ToPetListResponse([]domain.Pet{{}}) },
	"ToReportListResponse":     func() any { return dto.ToReportListResponse([]domain.Report{{}}) },
	"ToStoryListResponse":      func() any { return dto.ToStoryListResponse([]domain.SuccessStory{{}}) },
}

// noSonRespuestas son las funcs exportadas de `internal/dto` que NO arman un
// cuerpo de respuesta, con el motivo escrito al lado. Sin el motivo esto sería
// una lista de excepciones que crece sola, que es peor que no tener barrido: da
// la sensación de estar al día mientras deja de cubrir.
var noSonRespuestas = map[string]string{
	"ToRegisterFosterHomeDomain": "request → entidad de dominio; nunca se serializa a JSON de vuelta",
	"ToCreateShelterDomain":      "request → entidad de dominio; nunca se serializa a JSON de vuelta",
	"ToUpdateShelterDomain":      "request → entidad de dominio; nunca se serializa a JSON de vuelta",
	"ToRegisterShelterDomain":    "request → entidad de dominio; nunca se serializa a JSON de vuelta",
	"ScrubOwnerPhoneForViewer":   "muta un *PetResponse ya armado (borra owner.phone); no arma ni devuelve un cuerpo de respuesta, así que no hay nada que llamar con entrada vacía",
}

func TestDTO_MappersVaciosNoProducenSlicesNil(t *testing.T) {
	afirmarSinSlicesNil(t, respuestasDesdeVacio)
}

// TestDTO_MappersConUnItemNoProducenSlicesNilAnidados ejerce la rama del
// recorrido que entra a los elementos de una lista. Ver `respuestasConUnItem`.
func TestDTO_MappersConUnItemNoProducenSlicesNilAnidados(t *testing.T) {
	afirmarSinSlicesNil(t, respuestasConUnItem)
}

func afirmarSinSlicesNil(t *testing.T, casos map[string]func() any) {
	t.Helper()

	nombres := make([]string, 0, len(casos))
	for n := range casos {
		nombres = append(nombres, n)
	}
	sort.Strings(nombres)

	for _, nombre := range nombres {
		construir := casos[nombre]
		t.Run(nombre, func(t *testing.T) {
			valor := llamarSinPanicar(t, nombre, construir)

			var fallas []string
			buscarSlicesNil(reflect.ValueOf(valor), nombre, "", 0, &fallas)
			if len(fallas) == 0 {
				return
			}

			// El JSON crudo en el mensaje: la distinción entre `[]` y `null`
			// sólo existe ahí. Deserializar `null` sobre un `[]T` da un slice
			// nil cuyo `len()` también es 0, así que un assert sobre la struct
			// pasaría con el bug puesto.
			crudo, err := json.Marshal(valor)
			if err != nil {
				crudo = []byte(fmt.Sprintf("<no serializable: %v>", err))
			}
			t.Errorf("%s produce slices nil, que viajan como `null` y no como `[]`:\n  %s\njson: %s",
				nombre, strings.Join(fallas, "\n  "), crudo)
		})
	}
}

// TestDTO_TodoMapperExportadoEstaCubierto es la mitad que impide que la tabla
// envejezca. Barre el paquete real y falla en las DOS direcciones: una func
// nueva sin cubrir, y una entrada que nombra una func que ya no existe.
func TestDTO_TodoMapperExportadoEstaCubierto(t *testing.T) {
	enElPaquete := funcsExportadasDe(t, dtoPackageDir)
	if len(enElPaquete) == 0 {
		t.Fatalf("el barrido no encontró una sola func exportada en %s; si el paquete se movió, este guard dejó de mirar cualquier cosa", dtoPackageDir)
	}

	for _, nombre := range enElPaquete {
		_, cubierta := respuestasDesdeVacio[nombre]
		_, exenta := noSonRespuestas[nombre]
		if !cubierta && !exenta {
			t.Errorf("%s no está cubierta: agregala a `respuestasDesdeVacio` si arma un cuerpo de respuesta, o a `noSonRespuestas` con el motivo escrito", nombre)
		}
	}

	// Anti-envejecimiento: una tabla o una allowlist que nombra funcs borradas
	// ya no cubre lo que dice cubrir.
	presente := make(map[string]bool, len(enElPaquete))
	for _, n := range enElPaquete {
		presente[n] = true
	}
	for nombre := range respuestasDesdeVacio {
		if !presente[nombre] {
			t.Errorf("`respuestasDesdeVacio` nombra a %s, que ya no existe en %s — sacala", nombre, dtoPackageDir)
		}
	}
	for nombre := range noSonRespuestas {
		if !presente[nombre] {
			t.Errorf("`noSonRespuestas` nombra a %s, que ya no existe en %s — sacala", nombre, dtoPackageDir)
		}
	}
}

// TestDTO_WalkerDistingueOmitempty verifica la regla de decisión del propio
// recorrido, porque hoy NINGÚN DTO tiene `omitempty` sobre un slice: esa rama
// no la ejerce ningún caso de las tablas de arriba, y un error ahí fallaría
// APROBANDO — eximiría campos que sí deberían marcarse.
//
// Las dos mitades, porque testear sólo la negativa no distingue "la regla
// funciona" de "el recorrido no mira nada".
func TestDTO_WalkerDistingueOmitempty(t *testing.T) {
	type fixture struct {
		SinTag      []string `json:"sin_tag"`
		ConOmit     []string `json:"con_omit,omitempty"`
		Ignorado    []string `json:"-"`
		noExportado []string
	}

	var fallas []string
	buscarSlicesNil(reflect.ValueOf(fixture{}), "fixture", "", 0, &fallas)

	quiero := []string{"fixture.sin_tag → nil"}
	if !reflect.DeepEqual(fallas, quiero) {
		t.Errorf("el recorrido tiene que marcar sólo el slice nil SIN omitempty\n  quiero: %v\n  tengo:  %v", quiero, fallas)
	}
	_ = fixture{}.noExportado
}

// llamarSinPanicar aísla el panic de un mapper para que se reporte como una
// falla legible en vez de llevarse puesta la corrida entera.
func llamarSinPanicar(t *testing.T, nombre string, construir func() any) (valor any) {
	t.Helper()
	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("%s paniqueó con la entrada vacía: %v", nombre, r)
		}
	}()
	return construir()
}

// profundidadMaxima acota el recorrido. Con entradas vacías no hay ciclos
// posibles (los punteros vienen nil), pero un tope barato evita que un dato
// inesperado cuelgue la suite.
const profundidadMaxima = 12

// buscarSlicesNil recorre el valor y acumula la ruta de cada slice o map nil que
// se serializaría como `null`.
//
// `omitempty` NO es una violación: con ese tag el campo desaparece del JSON en
// vez de viajar nulo. Es una decisión distinta y legítima — el frontend recibe
// `undefined`, no `null`.
func buscarSlicesNil(v reflect.Value, ruta, tag string, profundidad int, fallas *[]string) {
	if profundidad > profundidadMaxima || !v.IsValid() {
		return
	}

	switch v.Kind() {
	case reflect.Pointer, reflect.Interface:
		if v.IsNil() {
			return
		}
		buscarSlicesNil(v.Elem(), ruta, tag, profundidad+1, fallas)

	case reflect.Slice, reflect.Map:
		if v.IsNil() {
			if !strings.Contains(tag, ",omitempty") {
				*fallas = append(*fallas, ruta+" → nil")
			}
			return
		}
		// Recorrer los elementos: un array con datos puede traer adentro otro
		// array nulo.
		if v.Kind() == reflect.Slice {
			for i := 0; i < v.Len(); i++ {
				buscarSlicesNil(v.Index(i), fmt.Sprintf("%s[%d]", ruta, i), "", profundidad+1, fallas)
			}
			return
		}
		for _, k := range v.MapKeys() {
			buscarSlicesNil(v.MapIndex(k), fmt.Sprintf("%s[%v]", ruta, k.Interface()), "", profundidad+1, fallas)
		}

	case reflect.Struct:
		// time.Time y uuid.UUID se serializan como escalares; entrar ahí sólo
		// daría ruido.
		switch v.Type() {
		case reflect.TypeOf(time.Time{}), reflect.TypeOf(uuid.UUID{}):
			return
		}
		tipo := v.Type()
		for i := 0; i < tipo.NumField(); i++ {
			campo := tipo.Field(i)
			if !campo.IsExported() {
				continue
			}
			jsonTag := campo.Tag.Get("json")
			nombre := strings.Split(jsonTag, ",")[0]
			if nombre == "-" {
				continue
			}
			if nombre == "" {
				nombre = campo.Name
			}
			buscarSlicesNil(v.Field(i), ruta+"."+nombre, jsonTag, profundidad+1, fallas)
		}
	}
}

// funcsExportadasDe devuelve los nombres de las funciones exportadas de nivel
// superior (no métodos) del paquete en `dir`, leyendo el AST.
func funcsExportadasDe(t *testing.T, dir string) []string {
	t.Helper()

	fset := token.NewFileSet()
	paquetes, err := parser.ParseDir(fset, filepath.FromSlash(dir), func(fi fs.FileInfo) bool {
		return !strings.HasSuffix(fi.Name(), "_test.go")
	}, 0)
	if err != nil {
		t.Fatalf("parseando %s: %v", dir, err)
	}

	var nombres []string
	for _, paquete := range paquetes {
		for _, archivo := range paquete.Files {
			for _, decl := range archivo.Decls {
				fn, ok := decl.(*ast.FuncDecl)
				if !ok || fn.Recv != nil || !fn.Name.IsExported() {
					continue
				}
				nombres = append(nombres, fn.Name.Name)
			}
		}
	}
	sort.Strings(nombres)
	return nombres
}
