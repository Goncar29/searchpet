# La ficha dice cuándo se vio por última vez al animal — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que la ficha de una mascota `lost` o `stray` muestre cuándo se la vio por última vez, en relativo y en fecha exacta, para que un avistamiento viejo deje de verse idéntico a uno fresco.

**Architecture:** El backend expone `last_seen_at` ya resuelto (`last_reported_at`, o `created_at` si es null) y **sólo** para los estados donde la pregunta significa algo. El cliente no calcula caducidad, no replica el COALESCE y no sabe a qué estados aplica: si el campo viene, lo formatea. Así `domain.StraySightingTTL` sigue siendo la única definición del plazo.

**Tech Stack:** Go 1.25 + GORM (backend), React + Vite (web), React Native/Expo (mobile), i18next con pluralización `{{count}}`, Vitest (web/shared) y Jest (mobile).

**Spec:** `docs/superpowers/specs/2026-09-07-pet-last-seen-on-detail-design.md`
**Rama:** `feat/pet-last-seen`, sobre `main` = `23992a9`

---

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `backend/internal/domain/pet_status.go` | **Modificar** — sumar `LastSeenRelevantStatuses`, la sexta allowlist |
| `backend/internal/domain/models.go` | **Modificar** — sumar el método `Pet.LastSeen()` |
| `backend/tests/pet_last_seen_test.go` | **Crear** — la allowlist, el fallback y el acuerdo Go↔SQL |
| `backend/internal/dto/pet_dto.go` | **Modificar** — campo `LastSeenAt` + una línea en el mapper |
| `backend/internal/dto/pet_dto_test.go` | **Modificar** — emite / no emite según el estado |
| `frontend/packages/shared/types/index.ts` | **Modificar** — `last_seen_at?: string` en `Pet` |
| `frontend/packages/shared/utils/lastSeen.ts` | **Crear** — cómputo puro + formateo, espeja `petAge.ts` |
| `frontend/packages/shared/utils/lastSeen.test.ts` | **Crear** — bordes de unidad, hoy, ayer, ausencia |
| `frontend/packages/shared/i18n/locales/{es,en,pt}.json` | **Modificar** — bloque `pets.lastSeen` |
| `frontend/packages/web/src/pages/PetDetailPage.tsx` | **Modificar** — el bloque entre datos y descripción |
| `frontend/packages/web/src/pages/PetDetailPage.test.tsx` | **Modificar** — muestra / no muestra |
| `frontend/packages/mobile/app/pet/[id].tsx` | **Modificar** — misma posición relativa |
| `frontend/packages/mobile/__tests__/pet-detail.test.tsx` | **Modificar o crear** — muestra / no muestra |

**Por qué `lastSeen.ts` es archivo nuevo y no un agregado a `petAge.ts`:** son dos preguntas distintas (cuándo nació / cuándo se lo vio) y no comparten una sola línea de lógica. Juntarlas sólo porque las dos derivan de una fecha haría un archivo que cambia por dos motivos.

---

## Task 1: La allowlist de estados

**Files:**
- Modify: `backend/internal/domain/pet_status.go` (después de `PublicProfileVisibleStatuses`)
- Test: `backend/tests/pet_last_seen_test.go` (crear)

- [ ] **Step 1: Escribir el test que falla**

Crear `backend/tests/pet_last_seen_test.go`:

```go
package tests

import (
	"testing"
	"time"

	"lost-pets/internal/domain"
)

// La allowlist tiene que decir que SÍ a los dos estados que se están buscando y
// que NO a los otros cinco. Las dos mitades importan: un test que sólo afirme la
// presencia pasaría con la lista invertida.
func TestLastSeenRelevantStatuses_SoloLosQueSeEstanBuscando(t *testing.T) {
	relevantes := map[string]bool{}
	for _, s := range domain.LastSeenRelevantStatuses {
		relevantes[s] = true
	}

	for _, s := range []string{domain.PetStatusLost, domain.PetStatusStray} {
		if !relevantes[s] {
			t.Errorf("%q debería estar en LastSeenRelevantStatuses", s)
		}
	}
	for _, s := range []string{
		domain.PetStatusRegistered,
		domain.PetStatusFound,
		domain.PetStatusArchived,
		domain.PetStatusAdoption,
		domain.PetStatusAdopted,
	} {
		if relevantes[s] {
			t.Errorf("%q NO debería estar: 'visto por última vez' no significa nada ahí", s)
		}
	}
}
```

- [ ] **Step 2: Correr el test y verificar que NO COMPILA**

```bash
cd backend && go test ./tests/ -run TestLastSeenRelevantStatuses -count=1
```

Esperado: `undefined: domain.LastSeenRelevantStatuses`

- [ ] **Step 3: Implementar**

En `backend/internal/domain/pet_status.go`, inmediatamente después del cierre de `PublicProfileVisibleStatuses`:

```go
// LastSeenRelevantStatuses son los estados en los que "visto por última vez"
// significa algo: los dos en los que hay una búsqueda abierta.
//
// Queda afuera `registered` (no se está buscando), `found` y `adopted` (la
// historia ya cerró) y `adoption` (nunca se perdió). Mostrar la frase ahí sería
// ruido, y en `registered` además sugeriría una búsqueda que nadie abrió.
//
// EXPLÍCITA y no derivada, igual que las otras cinco de este archivo: si mañana
// se agrega un estado hay que decidir si entra, y el default —quedar afuera— es
// el que no afirma nada.
var LastSeenRelevantStatuses = []string{PetStatusLost, PetStatusStray}
```

- [ ] **Step 4: Correr el test y verificar que PASA**

```bash
cd backend && go test ./tests/ -run TestLastSeenRelevantStatuses -count=1
```

Esperado: `ok`

- [ ] **Step 5: Commit**

```bash
git add backend/internal/domain/pet_status.go backend/tests/pet_last_seen_test.go
git commit -m "feat(domain): allowlist de estados donde 'visto por ultima vez' aplica"
```

---

## Task 2: El método `Pet.LastSeen()`

**Files:**
- Modify: `backend/internal/domain/models.go` (al final del archivo)
- Test: `backend/tests/pet_last_seen_test.go`

- [ ] **Step 1: Escribir el test que falla**

Agregar al final de `backend/tests/pet_last_seen_test.go`:

```go
// El fallback a CreatedAt NO es un default de conveniencia: un animal sin
// reportes SÍ fue visto — alguien lo publicó porque lo vio. Es además el único
// caso hoy ciego en la ficha, así que si el fallback no está, el cambio entero
// no sirve para el escenario que lo motivó.
func TestPetLastSeen_UsaElReporteYCaeAlAlta(t *testing.T) {
	alta := time.Date(2026, 1, 10, 12, 0, 0, 0, time.UTC)
	visto := time.Date(2026, 5, 3, 9, 30, 0, 0, time.UTC)

	conReporte := &domain.Pet{Status: domain.PetStatusStray, CreatedAt: alta, LastReportedAt: &visto}
	if got := conReporte.LastSeen(); got == nil || !got.Equal(visto) {
		t.Errorf("con reporte esperaba %v, obtuve %v", visto, got)
	}

	sinReporte := &domain.Pet{Status: domain.PetStatusStray, CreatedAt: alta}
	if got := sinReporte.LastSeen(); got == nil || !got.Equal(alta) {
		t.Errorf("sin reporte esperaba el alta %v, obtuve %v", alta, got)
	}
}

// Un estado fuera de la allowlist devuelve nil, y eso es lo que hace que el
// cliente no tenga que conocer la lista: si no viene el campo, no muestra nada.
func TestPetLastSeen_NilFueraDeLaAllowlist(t *testing.T) {
	visto := time.Date(2026, 5, 3, 9, 30, 0, 0, time.UTC)
	for _, s := range []string{
		domain.PetStatusRegistered,
		domain.PetStatusFound,
		domain.PetStatusArchived,
		domain.PetStatusAdoption,
		domain.PetStatusAdopted,
	} {
		p := &domain.Pet{Status: s, CreatedAt: visto, LastReportedAt: &visto}
		if got := p.LastSeen(); got != nil {
			t.Errorf("status %q: esperaba nil, obtuve %v", s, got)
		}
	}
}
```

- [ ] **Step 2: Correr y verificar que NO COMPILA**

```bash
cd backend && go test ./tests/ -run TestPetLastSeen -count=1
```

Esperado: `p.LastSeen undefined`

- [ ] **Step 3: Implementar**

Al final de `backend/internal/domain/models.go`:

```go
// LastSeen devuelve cuándo se vio por última vez a este animal, o nil si la
// pregunta no aplica a su estado.
//
// El fallback a CreatedAt no es un default de conveniencia: un animal sin
// reportes SÍ fue visto — alguien lo publicó porque lo vio. Tratar el NULL como
// "sin información" dejaría en blanco justo el caso que hoy es ciego en la
// ficha: el callejero que nadie volvió a reportar.
//
// OJO: este fallback existe TAMBIÉN en SQL, dentro de straySightingNotExpired
// (`COALESCE(pets.last_reported_at, pets.created_at)`). Son dos definiciones de
// la misma regla en dos lenguajes y no se pueden unificar —filtrar exige el SQL,
// exponer exige el Go—, así que lo que las mantiene juntas es un test de
// ACUERDO: TestPetLastSeen_CoincideConElCoalesceDelScope. Si tocás una, mirá la
// otra.
func (p *Pet) LastSeen() *time.Time {
	relevante := false
	for _, s := range LastSeenRelevantStatuses {
		if p.Status == s {
			relevante = true
			break
		}
	}
	if !relevante {
		return nil
	}
	if p.LastReportedAt != nil {
		return p.LastReportedAt
	}
	return &p.CreatedAt
}
```

- [ ] **Step 4: Correr y verificar que PASA**

```bash
cd backend && go test ./tests/ -run TestPetLastSeen -count=1
```

Esperado: `ok`

- [ ] **Step 5: Commit**

```bash
git add backend/internal/domain/models.go backend/tests/pet_last_seen_test.go
git commit -m "feat(domain): Pet.LastSeen resuelve el reporte o cae al alta"
```

---

## Task 3: El test de acuerdo entre Go y SQL

Es el test que el spec pide y el que evita el modo de falla invisible: que la ficha afirme una fecha distinta de la que decide si la mascota se ve o no.

**Files:**
- Test: `backend/tests/pet_last_seen_test.go`

- [ ] **Step 1: Escribir el test que falla**

Agregar al final de `backend/tests/pet_last_seen_test.go`. Necesita los imports `"lost-pets/internal/domain"`, `"lost-pets/tests/testdb"` y `"github.com/google/uuid"`:

```go
// Go y SQL tienen que resolver la MISMA fecha.
//
// `Pet.LastSeen()` y el COALESCE de straySightingNotExpired son la misma regla
// escrita dos veces. Una divergencia sería invisible mirándolas por separado:
// los dos valores seguirían pareciendo razonables, mientras la ficha muestra una
// fecha distinta de la que decidió si la mascota aparece en el feed.
//
// Va contra Postgres real y no contra un mock a propósito: lo que se compara es
// el resultado de una expresión SQL, y un mock no tiene expresiones.
func TestPetLastSeen_CoincideConElCoalesceDelScope(t *testing.T) {
	db := testdb.SetupTestDB(t)

	alta := time.Date(2026, 1, 10, 12, 0, 0, 0, time.UTC)
	visto := time.Date(2026, 5, 3, 9, 30, 0, 0, time.UTC)

	casos := []struct {
		nombre string
		pet    domain.Pet
	}{
		{"con reporte", domain.Pet{ID: uuid.New(), Name: "Con", Type: "perro", Status: domain.PetStatusStray, CreatedAt: alta, LastReportedAt: &visto}},
		{"sin reporte", domain.Pet{ID: uuid.New(), Name: "Sin", Type: "perro", Status: domain.PetStatusStray, CreatedAt: alta}},
		{"perdida sin reporte", domain.Pet{ID: uuid.New(), Name: "Perdida", Type: "gato", Status: domain.PetStatusLost, CreatedAt: alta}},
	}

	for _, c := range casos {
		pet := c.pet
		if err := db.Create(&pet).Error; err != nil {
			t.Fatalf("%s: creando: %v", c.nombre, err)
		}

		// La MISMA expresión que usa straySightingNotExpired.
		var desdeSQL time.Time
		err := db.Raw(
			"SELECT COALESCE(pets.last_reported_at, pets.created_at) FROM pets WHERE pets.id = ?",
			pet.ID,
		).Scan(&desdeSQL).Error
		if err != nil {
			t.Fatalf("%s: consultando: %v", c.nombre, err)
		}

		desdeGo := pet.LastSeen()
		if desdeGo == nil {
			t.Fatalf("%s: LastSeen() dio nil para un estado de la allowlist", c.nombre)
		}
		if !desdeGo.UTC().Round(time.Millisecond).Equal(desdeSQL.UTC().Round(time.Millisecond)) {
			t.Errorf("%s: Go dice %v y SQL dice %v — las dos definiciones divergieron",
				c.nombre, desdeGo.UTC(), desdeSQL.UTC())
		}
	}
}
```

- [ ] **Step 2: Correr y verificar que PASA**

```bash
cd backend && DATABASE_URL="postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable" JWT_SECRET=test-secret go test ./tests/ -run TestPetLastSeen_CoincideConElCoalesce -count=1 -timeout 30m
```

Esperado: `ok`. Si dice `SKIP`, falta `DATABASE_URL` y el test no corrió.

- [ ] **Step 3: Verificarlo EN ROJO**

Un test de acuerdo que nadie vio fallar no prueba que detecte la divergencia. En `models.go`, cambiar temporalmente el fallback de `LastSeen()`:

```go
	if p.LastReportedAt != nil {
		return p.LastReportedAt
	}
	falso := p.CreatedAt.Add(48 * time.Hour) // MUTANTE, revertir
	return &falso
```

Correr el mismo comando del Step 2.
Esperado: **FAIL** en los casos "sin reporte" y "perdida sin reporte", con `Go dice ... y SQL dice ...`.

Revertir el mutante y volver a correr: `ok`.

- [ ] **Step 4: Commit**

```bash
git add backend/tests/pet_last_seen_test.go
git commit -m "test(domain): el COALESCE de Go y el de SQL tienen que coincidir"
```

---

## Task 4: El campo en la respuesta HTTP

**Files:**
- Modify: `backend/internal/dto/pet_dto.go:151` (struct) y `ToPetResponse`
- Test: `backend/internal/dto/pet_dto_test.go`

- [ ] **Step 1: Escribir el test que falla**

Agregar al final de `backend/internal/dto/pet_dto_test.go`:

```go
// Las dos mitades. Sólo la primera pasaría con la allowlist invertida, y sólo la
// segunda pasaría con el campo nunca poblado.
func TestToPetResponse_LastSeenAt_SoloEnLostYStray(t *testing.T) {
	visto := time.Date(2026, 5, 3, 9, 30, 0, 0, time.UTC)

	for _, s := range []string{domain.PetStatusLost, domain.PetStatusStray} {
		pet := &domain.Pet{Status: s, LastReportedAt: &visto}
		resp := dto.ToPetResponse(pet)
		if resp.LastSeenAt == nil {
			t.Errorf("status %q: esperaba last_seen_at, vino nil", s)
		} else if !resp.LastSeenAt.Equal(visto) {
			t.Errorf("status %q: esperaba %v, vino %v", s, visto, *resp.LastSeenAt)
		}
	}

	for _, s := range []string{
		domain.PetStatusRegistered,
		domain.PetStatusFound,
		domain.PetStatusArchived,
		domain.PetStatusAdoption,
		domain.PetStatusAdopted,
	} {
		pet := &domain.Pet{Status: s, LastReportedAt: &visto}
		if resp := dto.ToPetResponse(pet); resp.LastSeenAt != nil {
			t.Errorf("status %q: no debería exponer last_seen_at, vino %v", s, *resp.LastSeenAt)
		}
	}
}
```

- [ ] **Step 2: Correr y verificar que NO COMPILA**

```bash
cd backend && go test ./internal/dto/ -run TestToPetResponse_LastSeenAt -count=1
```

Esperado: `resp.LastSeenAt undefined`

- [ ] **Step 3: Implementar**

En `backend/internal/dto/pet_dto.go`, dentro de `PetResponse`, después de `ReporterContactPublic`:

```go
	// LastSeenAt es cuándo se vio a este animal por última vez, YA RESUELTO: es
	// LastReportedAt, o CreatedAt cuando todavía no tiene ningún reporte.
	//
	// Se emite sólo para domain.LastSeenRelevantStatuses. Con `omitempty` el
	// cliente no necesita conocer esa lista: si el campo viene lo muestra, y si
	// no viene no muestra nada. Ni el umbral de caducidad, ni el fallback, ni la
	// lista de estados salen de acá.
	//
	// Viaja la FECHA y no el texto, igual que la edad y por el mismo motivo: un
	// "hace 4 meses" calculado en el servidor se congela en el instante de la
	// respuesta, y obligaría al backend a pluralizar en tres idiomas.
	LastSeenAt *time.Time `json:"last_seen_at,omitempty"`
```

Y en `ToPetResponse`, justo antes del `return resp` final:

```go
	// El estado y el fallback los decide el dominio, no este mapper.
	resp.LastSeenAt = pet.LastSeen()
```

- [ ] **Step 4: Correr y verificar que PASA**

```bash
cd backend && go test ./internal/dto/ -count=1
```

Esperado: `ok` (toda la suite del paquete, no sólo el test nuevo)

- [ ] **Step 5: Commit**

```bash
git add backend/internal/dto/pet_dto.go backend/internal/dto/pet_dto_test.go
git commit -m "feat(api): PetResponse expone last_seen_at para lost y stray"
```

---

## Task 5: El tipo compartido

**Files:**
- Modify: `frontend/packages/shared/types/index.ts` (interface `Pet`)

- [ ] **Step 1: Agregar el campo**

En `frontend/packages/shared/types/index.ts`, dentro de `interface Pet`, después de `reporter?: PetReporter;`:

```ts
  /**
   * Cuándo se vio por última vez a este animal, ya resuelto por el backend
   * (su último reporte, o su alta si todavía no tiene ninguno).
   *
   * Llega SÓLO en `lost` y `stray`. Su ausencia no es un error: significa que la
   * pregunta no aplica a ese estado. No derivar caducidad de acá — el plazo vive
   * en el backend y el cliente sólo muestra el hecho.
   */
  last_seen_at?: string;
```

- [ ] **Step 2: Verificar que compila**

```bash
cd frontend/packages/web && pnpm run build
```

Esperado: build exitoso (agregar un campo opcional no rompe nada).

- [ ] **Step 3: Commit**

```bash
git add frontend/packages/shared/types/index.ts
git commit -m "feat(shared): el tipo Pet lleva last_seen_at"
```

---

## Task 6: El helper compartido

**Files:**
- Create: `frontend/packages/shared/utils/lastSeen.ts`
- Test: `frontend/packages/shared/utils/lastSeen.test.ts`

- [ ] **Step 1: Escribir el test que falla**

Crear `frontend/packages/shared/utils/lastSeen.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeLastSeen } from './lastSeen';

const ahora = new Date(2026, 8, 7); // 7 de septiembre de 2026

describe('computeLastSeen', () => {
  it('devuelve null sin fecha', () => {
    expect(computeLastSeen(undefined, ahora)).toBeNull();
    expect(computeLastSeen('', ahora)).toBeNull();
  });

  it('devuelve null ante una fecha que no parsea', () => {
    expect(computeLastSeen('no-es-una-fecha', ahora)).toBeNull();
  });

  it('hoy es 0 días', () => {
    expect(computeLastSeen('2026-09-07T08:00:00Z', ahora)).toEqual({ unit: 'day', value: 0 });
  });

  it('ayer es 1 día', () => {
    expect(computeLastSeen('2026-09-06T08:00:00Z', ahora)).toEqual({ unit: 'day', value: 1 });
  });

  it('29 días siguen siendo días', () => {
    expect(computeLastSeen('2026-08-09T08:00:00Z', ahora)).toEqual({ unit: 'day', value: 29 });
  });

  it('30 días ya son un mes', () => {
    expect(computeLastSeen('2026-08-08T08:00:00Z', ahora)).toEqual({ unit: 'month', value: 1 });
  });

  it('cuatro meses', () => {
    expect(computeLastSeen('2026-05-03T08:00:00Z', ahora)).toEqual({ unit: 'month', value: 4 });
  });

  it('365 días ya son un año', () => {
    expect(computeLastSeen('2025-09-07T08:00:00Z', ahora)).toEqual({ unit: 'year', value: 1 });
  });

  // Una fecha futura es alcanzable: relojes desfasados entre el server y el
  // device. "hace -3 días" es peor que decir "hoy".
  it('una fecha futura se trata como hoy', () => {
    expect(computeLastSeen('2026-12-01T08:00:00Z', ahora)).toEqual({ unit: 'day', value: 0 });
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

```bash
cd frontend/packages/web && pnpm vitest run --config vitest.shared.config.ts lastSeen
```

Esperado: FAIL — `Failed to resolve import "./lastSeen"`

- [ ] **Step 3: Implementar**

Crear `frontend/packages/shared/utils/lastSeen.ts`:

```ts
// Deriva "cuánto hace que se vio a este animal" desde la fecha que manda el
// backend en `last_seen_at`.
//
// Espeja la forma de petAge.ts a propósito: un cómputo PURO y estructurado
// (`computeLastSeen`) separado del formateo traducido (`formatLastSeen`). La
// separación no es ceremonia — el cómputo se puede testear con fechas fijas sin
// montar i18n, que es donde están todos los bordes.
//
// Lo que este archivo NO hace, y es deliberado: no sabe nada de caducidad. El
// plazo de 90 días vive en domain.StraySightingTTL y no cruza al cliente. Acá
// sólo se muestra un hecho; el juicio "esto venció" no se emite nunca, porque
// sugeriría que el animal ya no está — que es justo lo que no sabemos.

export type LastSeenUnit = 'year' | 'month' | 'day';

export interface LastSeenAmount {
  unit: LastSeenUnit;
  value: number;
}

const DIA_MS = 86_400_000;

/**
 * Cuánto hace que se lo vio, o null si no hay fecha o no parsea.
 *
 * Los cortes son 30 días para pasar a meses y 365 para pasar a años. Son
 * aproximaciones a propósito: el consumidor de este dato quiere saber si algo
 * está fresco o viejo, no cuántos días exactos pasaron.
 */
export function computeLastSeen(
  iso: string | undefined,
  now: Date = new Date()
): LastSeenAmount | null {
  if (!iso) return null;
  const visto = new Date(iso);
  if (Number.isNaN(visto.getTime())) return null;

  // Se compara por día de calendario y no por instante: si no, algo visto
  // "ayer a las 23:00" mirado hoy a las 08:00 daría 0 días y diría "hoy".
  const aDia = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const dias = Math.floor((aDia(now) - aDia(visto)) / DIA_MS);

  // Una fecha futura es alcanzable con relojes desfasados entre server y
  // device. "hace -3 días" es peor que decir "hoy".
  if (dias <= 0) return { unit: 'day', value: 0 };
  if (dias < 30) return { unit: 'day', value: dias };
  if (dias < 365) return { unit: 'month', value: Math.floor(dias / 30) };
  return { unit: 'year', value: Math.floor(dias / 365) };
}

/**
 * El texto ya traducido, en sus dos formas, o null si no hay fecha.
 *
 * Devuelve las dos porque hay dos lectores: el relativo responde "¿esto está
 * fresco?" de un vistazo, y la fecha exacta responde "¿coincide con el día que
 * se me escapó?" — que es literalmente el usuario para el que existe el plazo de
 * 90 días.
 *
 * Recibe `t` en vez de importar i18next: `shared/` es agnóstico de web y mobile.
 * La pluralización va por `{{count}}`, igual que petAge.ts, y NO por
 * Intl.RelativeTimeFormat: Hermes no lo trae.
 */
export function formatLastSeen(
  t: (key: string, options?: Record<string, unknown>) => string,
  iso: string | undefined,
  locale: string,
  now: Date = new Date()
): { relative: string; absolute: string } | null {
  const amount = computeLastSeen(iso, now);
  if (!amount || !iso) return null;

  let cuando: string;
  if (amount.unit === 'day' && amount.value === 0) {
    cuando = t('pets:lastSeen.today');
  } else if (amount.unit === 'day' && amount.value === 1) {
    cuando = t('pets:lastSeen.yesterday');
  } else {
    cuando = t('pets:lastSeen.ago', {
      time: t(`pets:lastSeen.${amount.unit}s`, { count: amount.value }),
    });
  }

  return {
    relative: t('pets:lastSeen.line', { when: cuando }),
    absolute: new Date(iso).toLocaleDateString(locale, {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }),
  };
}
```

- [ ] **Step 4: Correr y verificar que PASA**

```bash
cd frontend/packages/web && pnpm vitest run --config vitest.shared.config.ts lastSeen
```

Esperado: 9 tests en verde.

- [ ] **Step 5: Commit**

```bash
git add frontend/packages/shared/utils/lastSeen.ts frontend/packages/shared/utils/lastSeen.test.ts
git commit -m "feat(shared): helper que deriva cuanto hace que se vio al animal"
```

---

## Task 7: Las claves i18n

**Files:**
- Modify: `frontend/packages/shared/i18n/locales/es.json`, `en.json`, `pt.json`

- [ ] **Step 1: Agregar el bloque en los tres locales**

En cada archivo, dentro del objeto `pets`, inmediatamente después del bloque `"age": { ... }`:

`es.json`:
```json
    "lastSeen": {
      "line": "Visto por última vez {{when}}",
      "today": "hoy",
      "yesterday": "ayer",
      "ago": "hace {{time}}",
      "days_one": "{{count}} día",
      "days_other": "{{count}} días",
      "months_one": "{{count}} mes",
      "months_other": "{{count}} meses",
      "years_one": "{{count}} año",
      "years_other": "{{count}} años"
    }
```

`en.json`:
```json
    "lastSeen": {
      "line": "Last seen {{when}}",
      "today": "today",
      "yesterday": "yesterday",
      "ago": "{{time}} ago",
      "days_one": "{{count}} day",
      "days_other": "{{count}} days",
      "months_one": "{{count}} month",
      "months_other": "{{count}} months",
      "years_one": "{{count}} year",
      "years_other": "{{count}} years"
    }
```

`pt.json`:
```json
    "lastSeen": {
      "line": "Visto pela última vez {{when}}",
      "today": "hoje",
      "yesterday": "ontem",
      "ago": "há {{time}}",
      "days_one": "{{count}} dia",
      "days_other": "{{count}} dias",
      "months_one": "{{count}} mês",
      "months_other": "{{count}} meses",
      "years_one": "{{count}} ano",
      "years_other": "{{count}} anos"
    }
```

> La clave `ago` existe separada de `line` porque el orden cambia entre idiomas:
> en español el "hace" va adelante y en inglés el "ago" va atrás. Componer el
> texto en el código en vez de en la traducción forzaría un orden.

- [ ] **Step 2: Verificar que los tres JSON parsean y tienen las mismas claves**

```bash
cd frontend/packages/shared/i18n/locales && node -e "
const es=require('./es.json'), en=require('./en.json'), pt=require('./pt.json');
const k=o=>Object.keys(o.pets.lastSeen).sort().join(',');
console.log('es:',k(es)); console.log('en:',k(en)); console.log('pt:',k(pt));
console.log('IGUALES=', k(es)===k(en) && k(es)===k(pt));
"
```

Esperado: `IGUALES= true`

- [ ] **Step 3: Commit**

```bash
git add frontend/packages/shared/i18n/locales/
git commit -m "feat(i18n): claves de 'visto por ultima vez' en es, en y pt"
```

---

## Task 8: La ficha web

**Files:**
- Modify: `frontend/packages/web/src/pages/PetDetailPage.tsx`
- Test: `frontend/packages/web/src/pages/PetDetailPage.test.tsx`

- [ ] **Step 1: Escribir el test que falla**

Agregar a `frontend/packages/web/src/pages/PetDetailPage.test.tsx`, reusando el `petResult` y el helper de render que el archivo ya tiene.

> **Este test NO puede verificar el texto traducido, y hay que saberlo antes de
> escribirlo.** El archivo mockea `react-i18next` con `t: (key) => key`
> (línea 9), así que lo que llega al DOM son las claves crudas, no
> "Visto por última vez hace 4 meses". Lo que este test afirma es la
> **decisión de renderizar**: que el bloque aparece cuando el campo viene y
> desaparece cuando no. El texto real lo cubren los tests del helper (Task 6) y
> los plurales el de Task 10, contra los locales de verdad.

```tsx
it('muestra el bloque de última vista cuando el backend manda la fecha', async () => {
  petResult = {
    data: { ...petBase, status: 'stray', last_seen_at: '2026-05-03T09:30:00Z' },
    isLoading: false,
  };
  renderPage();
  expect(await screen.findByTestId('last-seen')).toBeInTheDocument();
});

// La mitad negativa, y es la que atrapa el modo de falla real: un bloque que se
// renderiza siempre con texto vacío no se ve como un error, se ve como un hueco.
it('no muestra nada cuando el backend no manda last_seen_at', async () => {
  petResult = {
    data: { ...petBase, status: 'found', last_seen_at: undefined },
    isLoading: false,
  };
  renderPage();
  await screen.findByText(petBase.name);
  expect(screen.queryByTestId('last-seen')).not.toBeInTheDocument();
});
```

> Sobre el requisito del spec *"que web y mobile muestren el mismo texto"*: con
> `t` mockeado en las dos plataformas, **ningún test de pantalla puede
> afirmarlo**. Lo que lo garantiza es estructural — las dos fichas llaman al
> MISMO `formatLastSeen` y no arman texto por su cuenta. Los tests de pantalla
> lo protegen indirectamente: si alguien reemplaza la llamada por una
> concatenación local, `last-seen` sigue apareciendo pero el helper deja de
> tener consumidores, y eso se ve en el diff. No inventar un test que finja
> comparar textos que el arnés no puede producir.

- [ ] **Step 2: Correr y verificar que falla**

```bash
cd frontend/packages/web && pnpm vitest run PetDetailPage
```

Esperado: FAIL — no encuentra `last-seen`.

- [ ] **Step 3: Implementar**

En `PetDetailPage.tsx`, agregar el import:

```tsx
import { formatLastSeen } from '@shared/utils/lastSeen';
```

Después de la declaración de `descriptionCard`, agregar:

```tsx
  // Cuándo se lo vio por última vez. `null` cuando el backend no manda el campo
  // —o sea cuando la pregunta no aplica al estado— y entonces no se renderiza
  // NADA: igual que factCards y descriptionCard, un wrapper que sobrevive a su
  // propio contenido igual aporta su margen y deja un hueco sin explicación.
  //
  // Las dos formas juntas y en dos líneas: el relativo se lee de un vistazo y la
  // fecha es consulta, así que la jerarquía vertical dice cuál es cuál.
  const vistoPorUltimaVez = formatLastSeen(t, pet.last_seen_at, i18n.language);
  const lastSeenCard = vistoPorUltimaVez ? (
    <div
      data-testid="last-seen"
      className="mb-6 flex items-start gap-3 rounded-2xl border border-gray-100 bg-white p-4 dark:border-gray-800 dark:bg-gray-900"
    >
      <Icon name="visibility" className="mt-0.5 shrink-0 text-primary" />
      <div>
        <p className="font-medium text-gray-900 dark:text-gray-100">{vistoPorUltimaVez.relative}</p>
        <p className="text-sm text-gray-500 dark:text-gray-400">{vistoPorUltimaVez.absolute}</p>
      </div>
    </div>
  ) : null;
```

Y renderizarlo en las **dos** ramas del cuerpo, entre `factCards` y `descriptionCard`:

```tsx
                {factCards}
                {lastSeenCard}
                {descriptionCard}
```

> La rama de adopción (`isAdoptionListing`) también lo incluye por simetría de
> estructura, pero **nunca lo va a mostrar**: `adoption` y `adopted` están fuera
> de `LastSeenRelevantStatuses`, así que el backend no manda el campo y
> `lastSeenCard` es `null`. Ponerlo igual evita que la próxima persona que lea
> las dos ramas se pregunte por qué difieren.

- [ ] **Step 4: Correr y verificar que PASA**

```bash
cd frontend/packages/web && pnpm vitest run PetDetailPage && pnpm run build
```

Esperado: tests en verde y build exitoso. El build importa: vitest no chequea tipos.

- [ ] **Step 5: Commit**

```bash
git add frontend/packages/web/src/pages/PetDetailPage.tsx frontend/packages/web/src/pages/PetDetailPage.test.tsx
git commit -m "feat(web): la ficha muestra cuando se vio por ultima vez al animal"
```

---

## Task 9: La ficha mobile

**Files:**
- Modify: `frontend/packages/mobile/app/pet/[id].tsx`
- Test: `frontend/packages/mobile/__tests__/pet-detail.test.tsx`

- [ ] **Step 1: Escribir el test que falla**

Agregar al archivo de test de la ficha (si no existe, crearlo siguiendo el patrón de `__tests__/post.test.tsx`, que mockea `@shared/hooks` hook por hook):

```tsx
it('muestra cuándo se vio por última vez a un callejero', async () => {
  mockPet({ status: 'stray', last_seen_at: '2026-05-03T09:30:00Z' });
  const { findByTestId } = render(<PetDetailScreen />);
  expect(await findByTestId('last-seen')).toBeTruthy();
});

it('no muestra nada cuando el backend no manda last_seen_at', async () => {
  mockPet({ status: 'found', last_seen_at: undefined });
  const { queryByTestId, findByText } = render(<PetDetailScreen />);
  await findByText('Negrita');
  expect(queryByTestId('last-seen')).toBeNull();
});
```

- [ ] **Step 2: Correr y verificar que falla**

```bash
cd frontend/packages/mobile && pnpm test:run pet-detail
```

Esperado: FAIL — no encuentra `last-seen`.
**Nunca `pnpm test`**: es `jest --watchAll` y no termina jamás.

- [ ] **Step 3: Implementar**

En `frontend/packages/mobile/app/pet/[id].tsx`, junto al import de `formatPetAge` (línea 23):

```tsx
import { formatLastSeen } from '@shared/utils/lastSeen';
```

Junto a `edadTexto` (línea 90):

```tsx
  // null cuando el backend no manda el campo — o sea cuando la pregunta no
  // aplica a ese estado. Ver el comentario equivalente en la ficha web.
  const vistoPorUltimaVez = formatLastSeen(t, pet.last_seen_at, i18n.language);
```

Y en el JSX, después de la grilla de datos y antes del bloque de descripción (el que abre con `<Text style={styles.sectionTitle}>{t('pet_detail:description')}</Text>`, línea 323):

```tsx
        {vistoPorUltimaVez && (
          <View style={styles.lastSeen} testID="last-seen">
            <Text style={styles.lastSeenRelative}>{vistoPorUltimaVez.relative}</Text>
            <Text style={styles.lastSeenAbsolute}>{vistoPorUltimaVez.absolute}</Text>
          </View>
        )}
```

Agregar a `StyleSheet.create`. Los nombres de `COLORS` están verificados contra
`mobile/constants/index.ts` — **no existen `surface` ni `text`**, que son los que
uno escribiría por inercia:

```tsx
  lastSeen: {
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 12,
    borderRadius: 12,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  lastSeenRelative: { fontSize: 15, fontWeight: '600', color: COLORS.textPrimary },
  lastSeenAbsolute: { fontSize: 13, color: COLORS.textSecondary, marginTop: 2 },
```

- [ ] **Step 4: Correr y verificar que PASA**

```bash
cd frontend/packages/mobile && pnpm test:run
```

Esperado: toda la suite en verde, no sólo el test nuevo.

- [ ] **Step 5: Commit**

```bash
git add frontend/packages/mobile/app/pet/\[id\].tsx frontend/packages/mobile/__tests__/
git commit -m "feat(mobile): la ficha muestra cuando se vio por ultima vez al animal"
```

---

## Task 10: Verificar la pluralización en el runtime real

El spec lo marca como el único riesgo abierto: `formatPetAge` usa `{{count}}` y funciona hoy en mobile, pero el `Intl.PluralRules` de i18next va dentro de un try/catch, así que "los plurales andan" no prueba por sí solo que el motor los tenga.

**Files:**
- Modify: `frontend/packages/mobile/__tests__/i18n.plurals.test.ts`

Ese archivo **ya existe y es exactamente para esto**: inicializa i18next con los
locales REALES, justamente porque el arnés de pantallas devuelve la clave y
ningún test de pantalla puede ver que una forma plural no resuelve. Su
encabezado documenta el bug que lo originó: el sufijo `_plural` murió en i18next
v21, este proyecto está en **v26** (categorías `_one`/`_other`, que son las que
usan las claves de la Task 7), y `home:results_plural` vivió roto sin que nada
fallara.

- [ ] **Step 1: Agregar el caso al test existente**

Sumar `'pets:lastSeen.days'` y `'pets:lastSeen.months'` a la lista de casos del
`it('la frase, no sólo el número, cambia entre singular y plural')`, siguiendo la
forma que el archivo ya usa.

> **Comparar el SUSTANTIVO y no la cadena entera.** Está escrito en el propio
> test y es la parte que se re-deriva mal: con el plural roto, "1 día" y
> "2 día" **ya difieren por el dígito**, así que un `uno !== varios` pasa feliz
> con el bug puesto. Quien escribió ese test lo comprobó restaurando el defecto.

- [ ] **Step 2: Correr y verificar que pasa**

```bash
cd frontend/packages/mobile && pnpm test:run i18n.plurals
```

Esperado: verde. Si sale la clave cruda (`lastSeen.days`), el namespace no
resuelve — revisar la regla #12: el separador es `:`, nunca `.`.

- [ ] **Step 3: Verificarlo EN ROJO**

Cambiar temporalmente `days_other` a `"{{count}} día"` en `shared/i18n/locales/es.json`
y volver a correr.
Esperado: **FAIL**, porque el sustantivo dejó de cambiar. Revertir.

- [ ] **Step 4: Comprobarlo en un device o emulador**

Los pasos anteriores corren bajo Jest en Node, que tiene `Intl` completo. **Hermes no**, y el `Intl.PluralRules` de i18next va dentro de un try/catch, así que un verde en Jest no prueba que el motor los tenga.

Abrir la ficha de un callejero con al menos un reporte y leer la línea. Es el único chequeo que ve Hermes de verdad.

El riesgo está acotado por precedente vivo —`formatPetAge` usa `{{count}}` y hoy funciona en esta misma pantalla— pero acotado no es verificado.

Si la forma plural sale mal **sólo en el device**, el arreglo es reemplazar `_one`/`_other` por claves explícitas sin `count` (`"day": "1 día"`, `"days": "{{n}} días"`) y decidir el singular en el helper.

- [ ] **Step 5: Registrar el resultado en el PR**

Si funcionó, el spec queda confirmado. Si no, documentar el reemplazo y por qué.

---

## Task 11: Suite completa y PR

- [ ] **Step 1: Backend completo, por exit code**

```bash
cd backend && DATABASE_URL="postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable" JWT_SECRET=test-secret go test ./... -count=1 -timeout 30m > /tmp/bt.log 2>&1; echo "EXIT=$?"
```

Esperado: `EXIT=0`. **Nunca juzgar por un grep sobre la salida** — un pipe con buffer o una corrida que no ocurrió imprimen lo mismo que un verde.

- [ ] **Step 2: Web completo**

```bash
cd frontend/packages/web && pnpm test:run && pnpm run build
```

- [ ] **Step 3: Mobile completo**

```bash
cd frontend/packages/mobile && pnpm test:run
```

- [ ] **Step 4: Abrir el PR**

Seguir la skill `searchpet-pr`. El cuerpo tiene que incluir **`Closes #221` en inglés** — GitHub no reconoce las palabras de cierre en español, y ya pasó con el #230.

Marcar en el cuerpo lo que quedó verificado en device (Task 10).

---

## Lo que este plan NO hace

- No toca `straySightingNotExpired` ni el plazo de 90 días.
- No introduce ninguna noción de "vencido" en el cliente.
- No agrega el dato a las tarjetas del feed ni al listado. Sólo la ficha.
- No resuelve el issue #218.
