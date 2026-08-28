# Re-envío de un hogar suspendido — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el dueño de un hogar transitorio suspendido pueda corregirlo, verlo por qué lo suspendieron, y devolverlo a la cola de revisión guardando — igual que ya funciona con `rejected`.

**Architecture:** No hay mecanismo nuevo. Se extiende a `suspended` la rama de resubmit que ya existe para `rejected` en `foster_home_service.go`, se persiste el motivo de la suspensión en el mismo campo que el rechazo, y se borra el error que queda inalcanzable. El frontend deja de congelar el formulario y cambia el texto.

**Tech Stack:** Go 1.25 + Gin (servicio, handler, dominio), React + TypeScript + Vitest, i18next.

**Spec:** `docs/superpowers/specs/2026-08-27-foster-home-suspension-resubmit-design.md`

---

## Estructura de archivos

| archivo | responsabilidad en este cambio |
|---|---|
| `backend/internal/service/foster_home_service.go` | las tres condiciones: el guard que se va, el resubmit que se extiende, el motivo que se persiste |
| `backend/internal/domain/errors.go` | borrar `ErrFosterHomeSuspended` y su código |
| `backend/internal/handler/foster_home_handler.go` | borrar el `case` inalcanzable |
| `backend/tests/foster_home_service_test.go` | invertir el test del congelado; extender el del motivo |
| `frontend/packages/shared/i18n/locales/{es,en,pt}.json` | borrar `errors.foster_home_suspended` |
| `frontend/packages/web/src/i18n/locales/{es,en,pt}.json` | `mine.resubmit`, `mine.resubmitHint`; reescribir `mine.statusSuspended`; borrar `mine.suspendedFrozen` |
| `frontend/packages/web/src/pages/MyFosterHomePage.tsx` | el guard de submit, el fieldset, el botón, el motivo y la pista |
| `frontend/packages/web/src/pages/MyFosterHomePage.test.tsx` | invertir el test del congelado; borrar el de las fotos |
| `frontend/packages/mobile/i18n/locales/{es,en,pt}.json` | las mismas claves, en la copia propia de mobile |
| `frontend/packages/mobile/app/foster-homes/mine.tsx` | el mismo cambio que la web: los dos `return`, el `editable`/`disabled`, el motivo, el cartel y el botón |
| `frontend/packages/mobile/__tests__/foster-home-mine.test.tsx` | **nuevo** — la pantalla no tiene tests |

## Comandos

```bash
# Backend, con la base de TESTS (nunca la de desarrollo — borra el seed)
cd backend && DATABASE_URL="postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable" \
  go test ./tests/ -run TestEditSuspended -count=1 > /tmp/out.log 2>&1; echo "EXIT=$?"

# Frontend
cd frontend/packages/web && pnpm vitest run src/pages/MyFosterHomePage.test.tsx
cd frontend/packages/web && pnpm test:run > /tmp/web.log 2>&1; echo "EXIT=$?"
cd frontend/packages/web && pnpm exec tsc --noEmit -p tsconfig.json
```

**Se verifica con el EXIT CODE, nunca con un grep sobre la salida** (regla #41).

---

### Task 1: Un hogar suspendido que se edita vuelve a la cola

**Files:**
- Modify: `backend/tests/foster_home_service_test.go` (el test `TestEditSuspended_IsFrozen`, hoy en la línea 188)
- Modify: `backend/internal/service/foster_home_service.go` (el guard, hoy en 101-104, y la rama de resubmit, hoy en 147-151)

- [ ] **Step 1: Invertir el test que afirma el congelado**

Reemplazar la función `TestEditSuspended_IsFrozen` entera por ésta. El nombre
cambia: el viejo afirmaba lo contrario de lo que ahora queremos, y dejarlo con
ese nombre sería peor que borrarlo.

```go
func TestEditSuspended_VuelveAPending(t *testing.T) {
	ctx := context.Background()
	ownerID, userRepo := newVerifiedUser()
	fhRepo := newFakeFHRepo()
	svc := service.NewFosterHomeService(fhRepo, userRepo, &fakeAuditRepo{}, nil)

	fh := &domain.FosterHome{City: "Montevideo", HousingType: "house", AnimalTypes: []string{"dog"}, Capacity: 2, Description: "desc"}
	if err := svc.RegisterOwn(ctx, ownerID.String(), fh); err != nil {
		t.Fatalf("RegisterOwn failed: %v", err)
	}
	fhID := fhRepo.created.ID.String()
	adminID := uuid.New().String()

	if _, err := svc.Approve(ctx, adminID, fhID); err != nil {
		t.Fatalf("Approve failed: %v", err)
	}
	if _, err := svc.Suspend(ctx, adminID, fhID, "fraude"); err != nil {
		t.Fatalf("Suspend failed: %v", err)
	}

	// Suspender significa "esto está mal, arreglalo": el dueño corrige y su
	// hogar vuelve a la cola por su cuenta, igual que un rejected.
	city := "Salto"
	got, err := svc.UpdateMine(ctx, ownerID.String(), &dto.UpdateMyFosterHomeRequest{City: &city})
	if err != nil {
		t.Fatalf("UpdateMine failed: %v", err)
	}
	if got.Status != domain.FosterHomeStatusPending {
		t.Errorf("expected status pending, got %q", got.Status)
	}
	if got.City != "Salto" {
		t.Errorf("expected the edit to apply, got city %q", got.City)
	}
	// El motivo se limpia: ya no describe el estado actual.
	if got.RejectionReason != "" {
		t.Errorf("expected the reason to be cleared, got %q", got.RejectionReason)
	}
}
```

- [ ] **Step 2: Correrlo y verificar que FALLA**

```bash
cd backend && DATABASE_URL="postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable" \
  go test ./tests/ -run TestEditSuspended_VuelveAPending -count=1 > /tmp/out.log 2>&1; echo "EXIT=$?"
```

Esperado: `EXIT=1`, con `UpdateMine failed: foster_home_suspended`. Ése es el
guard que todavía está.

- [ ] **Step 3: Sacar el guard**

En `UpdateMine`, borrar estas cuatro líneas (hoy 101-104):

```go
	// Un hogar suspendido queda CONGELADO: el dueño no puede editarlo.
	if fh.Status == domain.FosterHomeStatusSuspended {
		return nil, domain.ErrFosterHomeSuspended
	}
```

- [ ] **Step 4: Extender la rama de resubmit**

Reemplazar el bloque de hoy (147-151):

```go
	// Un rejected que se edita vuelve a pending (resubmit).
	if fh.Status == domain.FosterHomeStatusRejected {
		fh.Status = domain.FosterHomeStatusPending
		fh.RejectionReason = ""
	}
```

por:

```go
	// Editar ES re-someter, y vale para los dos estados de los que se sale
	// corrigiendo: `rejected` (nunca llegó a publicarse) y `suspended` (estaba
	// publicado y un moderador lo bajó). En los dos el hogar vuelve a la cola
	// y el motivo se limpia, porque ya no describe el estado actual.
	//
	// No hay tope de rebotes a propósito: el hogar no vuelve a ser público sin
	// que un moderador lo apruebe (`foster_home_repository.go` filtra por
	// `approved`), así que lo peor que pasa es ruido en la cola.
	if fh.Status == domain.FosterHomeStatusRejected || fh.Status == domain.FosterHomeStatusSuspended {
		fh.Status = domain.FosterHomeStatusPending
		fh.RejectionReason = ""
	}
```

- [ ] **Step 5: Correr y verificar que PASA**

```bash
cd backend && DATABASE_URL="postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable" \
  go test ./tests/ -count=1 > /tmp/out.log 2>&1; echo "EXIT=$?"
```

Esperado: `EXIT=0`. La suite entera, no sólo el test nuevo: sacar un guard puede
romper otro test que lo daba por hecho.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/service/foster_home_service.go backend/tests/foster_home_service_test.go
git commit -m "feat(api): un hogar suspendido que se edita vuelve a la cola"
```

---

### Task 2: El dueño ve por qué lo suspendieron

**Files:**
- Modify: `backend/tests/foster_home_service_test.go` (`TestSuspend_RequiresReasonAndLogs`, hoy en 147)
- Modify: `backend/internal/service/foster_home_service.go` (`transition`, la condición del motivo, hoy en 258)

- [ ] **Step 1: Agregar la aserción que falta al test existente**

Dentro de `TestSuspend_RequiresReasonAndLogs`, justo después del bloque que
verifica `got.Status`, agregar:

```go
	// El log de moderación es admin-only. Si el motivo no llega TAMBIÉN al
	// campo que ve el dueño, "arreglá y volvé" es una adivinanza.
	if got.RejectionReason != "fraude" {
		t.Errorf("expected the owner-visible reason to be %q, got %q", "fraude", got.RejectionReason)
	}
```

- [ ] **Step 2: Correrlo y verificar que FALLA**

```bash
cd backend && DATABASE_URL="postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable" \
  go test ./tests/ -run TestSuspend_RequiresReasonAndLogs -count=1 > /tmp/out.log 2>&1; echo "EXIT=$?"
```

Esperado: `EXIT=1`, con `expected the owner-visible reason to be "fraude", got ""`.

- [ ] **Step 3: Persistir el motivo también al suspender**

En `transition()`, reemplazar:

```go
	if action == domain.FosterHomeActionReject {
		fh.RejectionReason = reason
	}
```

por:

```go
	// El motivo se guarda en las dos acciones que dejan al dueño con algo que
	// corregir. El campo se llama `RejectionReason` por historia; lo que
	// significa es "por qué un moderador lo bajó", y el dueño lo ve en las dos.
	if action == domain.FosterHomeActionReject || action == domain.FosterHomeActionSuspend {
		fh.RejectionReason = reason
	}
```

- [ ] **Step 4: Correr la suite y verificar que PASA**

```bash
cd backend && DATABASE_URL="postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable" \
  go test ./tests/ -count=1 > /tmp/out.log 2>&1; echo "EXIT=$?"
```

Esperado: `EXIT=0`.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/service/foster_home_service.go backend/tests/foster_home_service_test.go
git commit -m "feat(api): el motivo de una suspension le llega al dueño"
```

---

### Task 3: Borrar el error que ya no puede ocurrir

**Files:**
- Modify: `backend/internal/domain/errors.go` (líneas 68 y 218)
- Modify: `backend/internal/handler/foster_home_handler.go` (el `case`, hoy en 81-82)
- Modify: `frontend/packages/shared/i18n/locales/{es,en,pt}.json` (la clave `errors.foster_home_suspended`)

Con el guard de la Task 1 fuera, `ErrFosterHomeSuspended` no lo devuelve nadie.
Un `case` inalcanzable en un `switch` es una trampa: el próximo que lea el
handler va a creer que hay un caso que manejar.

- [ ] **Step 1: Confirmar que de verdad no queda ningún productor**

```bash
cd backend && rg -n "ErrFosterHomeSuspended" --glob '!*_test.go' internal/
```

Esperado: exactamente tres líneas — la definición, la entrada del mapa de
códigos y el `case` del handler. **Ningún `return`**. Si aparece un `return`,
parar: hay otro camino que lo produce y este borrado sería incorrecto.

- [ ] **Step 2: Borrar las tres**

En `internal/domain/errors.go`, borrar:

```go
	ErrFosterHomeSuspended      = errors.New("foster_home_suspended")
```

y

```go
	ErrFosterHomeSuspended:      "foster_home_suspended",
```

En `internal/handler/foster_home_handler.go`, borrar:

```go
		case errors.Is(err, domain.ErrFosterHomeSuspended):
			writeError(c, http.StatusConflict, err)
```

- [ ] **Step 3: Borrar la clave i18n en los tres locales compartidos**

En `frontend/packages/shared/i18n/locales/{es,en,pt}.json`, borrar la línea
`"foster_home_suspended": ...` del objeto `errors`.

**Los locales usan CRLF**: editar en texto, nunca con `json.load`/`dump`, que
los pasa a LF y explota el diff. El resultado tiene que ser **1 baja y 0 altas
por archivo**.

- [ ] **Step 4: Verificar que compila, que la suite pasa y que la paridad de locales sigue**

```bash
cd backend && go build ./... && DATABASE_URL="postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable" \
  go test ./... -count=1 > /tmp/out.log 2>&1; echo "EXIT=$?"
cd frontend/packages/web && pnpm vitest run --config vitest.shared.config.ts > /tmp/shared.log 2>&1; echo "EXIT=$?"
```

Esperado: los dos `EXIT=0`. El segundo es el que caza haber borrado la clave de
un solo idioma.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/domain/errors.go backend/internal/handler/foster_home_handler.go frontend/packages/shared/i18n/locales
git commit -m "refactor(api): borrar el error de hogar suspendido, que ya no puede ocurrir"
```

---

### Task 4: Los textos

**Files:**
- Modify: `frontend/packages/web/src/i18n/locales/{es,en,pt}.json`

El mensaje de hoy (`mine.statusSuspended`) manda a **contactar al soporte**, que
deja de ser el camino: ahora el camino es corregir y guardar.

- [ ] **Step 1: Reescribir y agregar las claves**

Dentro de `fosterHomes.mine` de cada locale, **borrar** `suspendedFrozen` y
dejar estas tres. `statusSuspended` se reescribe; las otras dos son nuevas y son
del namespace `fosterHomes` a propósito — no se reusan las de `shelters`, porque
un namespace prestado es cómo un cambio de texto en una pantalla aparece sin
querer en otra.

`es.json`:

```json
      "statusSuspended": "Un administrador suspendió tu hogar. Corregí lo que haga falta y volvé a enviarlo.",
      "resubmit": "Guardar y reenviar",
      "resubmitHint": "Al guardar, tu hogar vuelve a la cola de revisión.",
```

`en.json`:

```json
      "statusSuspended": "An administrator suspended your foster home. Fix what's needed and submit it again.",
      "resubmit": "Save and resubmit",
      "resubmitHint": "Saving sends your home back to the review queue.",
```

`pt.json`:

```json
      "statusSuspended": "Um administrador suspendeu seu lar. Corrija o que for necessário e envie novamente.",
      "resubmit": "Salvar e reenviar",
      "resubmitHint": "Ao salvar, seu lar volta para a fila de revisão.",
```

**Ojo con el ancla**: `"fosterHomes"` aparece **dos veces** en estos archivos —
una como etiqueta suelta cerca de la línea 14 y otra como namespace de primer
nivel. El ancla tiene que ser `\n  "fosterHomes": {` (dos espacios) y hay que
verificar que aparezca **una sola vez** antes de insertar.

- [ ] **Step 2: Verificar que las tres resuelven en los tres idiomas**

```bash
cd frontend/packages/web/src/i18n && node -e "
for (const l of ['es','en','pt']) {
  const m = require('./locales/'+l+'.json').fosterHomes.mine;
  console.log(l, m.statusSuspended, '|', m.resubmit, '|', m.resubmitHint, '| frozen borrado:', m.suspendedFrozen === undefined);
}"
```

Esperado: los tres textos y `frozen borrado: true` en las tres filas.

- [ ] **Step 3: Commit**

```bash
git add frontend/packages/web/src/i18n/locales
git commit -m "feat(web): textos del re-envio de un hogar suspendido"
```

---

### Task 5: La pantalla deja de congelar

**Files:**
- Modify: `frontend/packages/web/src/pages/MyFosterHomePage.tsx`

- [ ] **Step 1: Sacar el `return` que haría que Guardar no hiciera nada**

En `handleSubmit`, borrar estas cuatro líneas:

```tsx
    // Defensa cliente: un hogar suspendido no se puede editar. El backend
    // igual devuelve 409 foster_home_suspended si esto se saltea — se
    // maneja abajo vía getErrorMessage (defense in depth, no solo UI).
    if (isSuspended) return;
```

**Este paso es el que hace que el cambio funcione.** Sin él, el botón se
habilita y guardar no hace nada, en silencio.

- [ ] **Step 2: Sacar el `<fieldset>`, que ya no deshabilita nada**

Reemplazar la apertura:

```tsx
        <fieldset disabled={isSuspended} className="space-y-6 disabled:opacity-60">
```

por un fragmento, y su cierre `</fieldset>` por `</>`:

```tsx
        <>
```

Las dos `<FormSection>` quedan como hijas directas del `<form>`, que ya tiene
`space-y-6`.

- [ ] **Step 3: Mostrar el motivo también cuando está suspendido**

Reemplazar:

```tsx
        {isRejected && fosterHome.rejection_reason && (
```

por:

```tsx
        {/* El motivo vale para los dos estados de los que se sale corrigiendo.
            El campo se llama `rejection_reason` por historia; el backend lo
            escribe también al suspender. */}
        {(isRejected || isSuspended) && fosterHome.rejection_reason && (
```

- [ ] **Step 4: Cambiar el aviso de congelado por la pista de re-envío**

Reemplazar:

```tsx
        {isSuspended && (
          <p className="text-sm text-danger bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-900 rounded-xl p-3">
            {t('fosterHomes:mine.suspendedFrozen')}
          </p>
        )}
```

por:

```tsx
        {isSuspended && (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t('fosterHomes:mine.resubmitHint')}
          </p>
        )}
```

- [ ] **Step 5: Ofrecer siempre el botón, con el texto que corresponda**

Reemplazar:

```tsx
        {!isSuspended && (
          <FormActions
            submit={
              <button type="submit" disabled={updateFosterHome.isPending} className={formSubmitClass}>
                {updateFosterHome.isPending ? t('fosterHomes:mine.saving') : t('fosterHomes:mine.save')}
              </button>
            }
          />
        )}
```

por:

```tsx
        <FormActions
          submit={
            <button type="submit" disabled={updateFosterHome.isPending} className={formSubmitClass}>
              {updateFosterHome.isPending
                ? t('fosterHomes:mine.saving')
                : isSuspended
                  ? t('fosterHomes:mine.resubmit')
                  : t('fosterHomes:mine.save')}
            </button>
          }
        />
```

- [ ] **Step 6: Typecheck**

```bash
cd frontend/packages/web && pnpm exec tsc --noEmit -p tsconfig.json > /tmp/tsc.log 2>&1; echo "EXIT=$?"
```

Esperado: `EXIT=0`. Si aparece `'isRejected' is declared but never read` u otra
variable sin usar, es señal de que algo se borró de más — revisar antes de
seguir.

---

### Task 6: Los tests de la pantalla

**Files:**
- Modify: `frontend/packages/web/src/pages/MyFosterHomePage.test.tsx`

- [ ] **Step 1: Invertir el test del congelado**

Reemplazar el test `con el hogar suspendido, el fieldset deshabilita los controles DEL FORMULARIO` **entero**, con su comentario, por:

```tsx
  // Suspendido ya no es un callejón: el dueño corrige y guarda, y su hogar
  // vuelve a la cola. Este test afirmaba lo contrario — que el formulario
  // quedaba congelado — y se invierte junto con el comportamiento.
  it('con el hogar suspendido el formulario es EDITABLE y ofrece reenviar', () => {
    myFosterHomeState.data = { ...baseFosterHome, status: 'suspended' };
    renderPage();

    expect(screen.getByLabelText('fosterHomes:register.city')).not.toBeDisabled();
    expect(screen.getByLabelText('fosterHomes:register.description')).not.toBeDisabled();
    for (const casilla of within(grupoAnimales()).getAllByRole('checkbox')) {
      expect(casilla).not.toBeDisabled();
    }

    // El botón cambia de texto: "guardar" y "guardar y reenviar" no son lo
    // mismo, y el usuario tiene que saber que esto lo devuelve a revisión.
    expect(screen.getByText('fosterHomes:mine.resubmit')).toBeTruthy();
    expect(screen.queryByText('fosterHomes:mine.save')).toBeNull();
    expect(screen.getByText('fosterHomes:mine.resubmitHint')).toBeTruthy();
  });

  // Sin esto, alguien podría "arreglar" el test de arriba habilitando el
  // formulario y dejando el `return` de `handleSubmit`: el botón se vería
  // vivo y no haría nada.
  it('y guardar un hogar suspendido SÍ llama a la API', () => {
    myFosterHomeState.data = { ...baseFosterHome, status: 'suspended' };
    mutateMock.mockImplementation((_data, opts) => opts?.onSuccess?.());
    renderPage();

    fireEvent.change(screen.getByLabelText('fosterHomes:register.city'), {
      target: { value: 'Salto' },
    });
    fireEvent.click(screen.getByText('fosterHomes:mine.resubmit'));

    expect(mutateMock).toHaveBeenCalledTimes(1);
    expect(mutateMock.mock.calls[0][0]).toMatchObject({ city: 'Salto' });
  });

  it('un hogar suspendido muestra el motivo, como uno rechazado', () => {
    myFosterHomeState.data = {
      ...baseFosterHome,
      status: 'suspended',
      rejection_reason: 'fotos que no corresponden',
    };
    renderPage();

    expect(screen.getByText('fotos que no corresponden')).toBeTruthy();
  });
```

- [ ] **Step 2: Borrar el test de las fotos**

Borrar entero el test `pero las fotos NO se congelan — hoy siguen editables`,
con su comentario. Existía para documentar una asimetría entre el formulario y
las fotos; con este cambio todo es editable y esa asimetría no existe. Un test
que ya no distingue nada es ruido.

- [ ] **Step 3: Correr y verificar que PASAN**

```bash
cd frontend/packages/web && pnpm vitest run src/pages/MyFosterHomePage.test.tsx > /tmp/mfh.log 2>&1; echo "EXIT=$?"
```

Esperado: `EXIT=0`.

- [ ] **Step 4: Probar que el guard nuevo se pone ROJO**

Devolver a mano el `if (isSuspended) return;` en `handleSubmit` y volver a
correr. Esperado: **falla** `y guardar un hogar suspendido SÍ llama a la API`, y
sólo ése. **Deshacer el sabotaje** con una copia del archivo (`cp` antes,
`cp` después) y **no** con `git checkout`, que revierte al HEAD y se lleva
puesto el trabajo sin commitear.

- [ ] **Step 5: Suite completa y commit**

```bash
cd frontend/packages/web && pnpm test:run > /tmp/web.log 2>&1; echo "EXIT=$?"
git add frontend/packages/web/src/pages/MyFosterHomePage.tsx frontend/packages/web/src/pages/MyFosterHomePage.test.tsx
git commit -m "feat(web): un hogar suspendido se corrige y se reenvia"
```

Esperado: `EXIT=0`.

---

### Task 7: Mobile — la misma pantalla, el mismo cambio

**Se sumó el 2026-08-28.** El plan original sólo cubría la web; mobile tiene el
congelado completo y sin esto la feature llega a la mitad de los clientes.

**Files:**
- Modify: `frontend/packages/mobile/i18n/locales/{es,en,pt}.json`
- Modify: `frontend/packages/mobile/app/foster-homes/mine.tsx`
- Create: `frontend/packages/mobile/__tests__/foster-home-mine.test.tsx`

Mobile tiene **su propia** copia del namespace `fosterHomes` — las claves de la
web no le llegan.

- [ ] **Step 1: Las claves, en los tres locales de mobile**

Dentro de `fosterHomes.mine`, borrar `suspendedFrozen` y dejar:

`es`: `"statusSuspended": "Un administrador suspendió tu hogar. Corregí lo que haga falta y volvé a enviarlo."`, `"resubmit": "Guardar y reenviar"`, `"resubmitHint": "Al guardar, tu hogar vuelve a la cola de revisión."`

`en`: `"statusSuspended": "An administrator suspended your foster home. Fix what's needed and submit it again."`, `"resubmit": "Save and resubmit"`, `"resubmitHint": "Saving sends your home back to the review queue."`

`pt`: `"statusSuspended": "Um administrador suspendeu seu lar. Corrija o que for necessário e envie novamente."`, `"resubmit": "Salvar e reenviar"`, `"resubmitHint": "Ao salvar, seu lar volta para a fila de revisão."`

- [ ] **Step 2: La pantalla**

En `app/foster-homes/mine.tsx`:

1. Borrar **los dos** `if (isSuspended) return;` (hay uno cerca de la línea 166 y
   otro en `handleSave`, cerca de 196). **Sin esto el botón queda vivo y mudo.**
2. Quitar `editable={!isSuspended}` de los inputs y `disabled={isSuspended}` de
   los botones de opción, más los estilos `inputDisabled` que dependan de eso.
3. El cartel de `suspendedFrozen` pasa a `resubmitHint`.
4. Mostrar el motivo cuando está suspendido, no sólo cuando está rechazado —
   igual que la web.
5. La etiqueta del botón: `resubmit` si está suspendido, `save` si no.

- [ ] **Step 3: El test que no existe**

Crear `__tests__/foster-home-mine.test.tsx` cubriendo lo que este cambio decide:
con el hogar suspendido el formulario es **editable** y guardar **llama a la
API**. Modelar el arnés sobre otro test de pantalla del mismo directorio: los
smoke tests mockean `@shared/hooks` hook por hook, así que **todo hook que use
la pantalla tiene que estar en el mock**.

- [ ] **Step 4: Correr la suite de mobile**

```bash
cd frontend/packages/mobile && pnpm test:run > /tmp/mob.log 2>&1; echo "EXIT=$?"
```

`pnpm test:run`, **nunca `pnpm test`**: ese es `jest --watchAll` y no termina.

- [ ] **Step 5: Commit**

```bash
git add frontend/packages/mobile
git commit -m "feat(mobile): un hogar suspendido se corrige y se reenvia"
```

---

### Task 8: Verificación final y PR

- [ ] **Step 1: Las dos suites y el typecheck, por exit code**

```bash
cd backend && DATABASE_URL="postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable" \
  go test ./... -count=1 > /tmp/go.log 2>&1; echo "GO=$?"
cd frontend/packages/web && pnpm test:run > /tmp/web.log 2>&1; echo "WEB=$?"
cd frontend/packages/web && pnpm exec tsc --noEmit -p tsconfig.json > /tmp/tsc.log 2>&1; echo "TSC=$?"
```

Los tres en 0.

- [ ] **Step 2: Confirmar que no quedó ninguna referencia al error borrado**

```bash
cd . && rg -n "foster_home_suspended|ErrFosterHomeSuspended" backend frontend --glob '!*.log'
```

Esperado: **sin resultados**.

- [ ] **Step 3: Abrir el PR**

Seguir la skill `searchpet-pr`. Cuerpo en español. El PR toca backend y
frontend, así que el plan de prueba nombra las dos suites.

---

## Self-review

**Cobertura de la spec.** Cada sección tiene tarea: el guard y el resubmit →
Task 1; el motivo visible → Task 2; el borrado del error muerto → Task 3; los
textos → Task 4; la pantalla → Task 5; los tests de la pantalla → Task 6.

**Dos cosas que la spec NO nombraba y este plan agrega**, porque sin ellas el
cambio se entrega roto o a medias:

1. **`handleSubmit` tiene un `if (isSuspended) return;`** (Task 5, Step 1). Si se
   habilita el formulario y no se saca eso, el botón queda vivo y mudo — el
   defecto que ya apareció en el #190 y que la regla #51 nombra.
2. **`mine.statusSuspended` decía "Contactá al soporte"** (Task 4). Cambiar sólo
   la pista y dejar ese texto le daría al usuario dos caminos contradictorios en
   el mismo cartel.

**Lo que este plan NO hace**, alineado con la spec: no congela las fotos, no
agrega endpoint ni estado nuevo, no notifica al moderador y no le pone tope a los
rebotes `suspended → pending`.

**Los números de línea van a moverse.** Cada tarea cita el código además del
número: matchear por el código.
