# Foster Homes — Mobile (Fase 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir la UI mobile (Expo/React Native) de "hogares transitorios" — directorio privado, detalle con contacto (chat + WhatsApp) y denuncia, registro, y "mi hogar" (edición + fotos) — consumiendo la capa shared ya existente (Fases 1 y 2 en `main`).

**Architecture:** Expo Router (file-based routing en `app/`), Zustand para auth (`useAuthStore`), React Query vía los hooks compartidos (`@shared/hooks`), i18n con `react-i18next`. La moderación admin es **web-only** (no va en mobile). Espeja los patrones existentes: `app/shelters/index.tsx` (directorio), `components/publish/AdoptionFormStep.tsx` (form + expo-image-picker), `app/pet/[id].tsx` (detalle + contacto).

**Tech Stack:** TypeScript, React Native, Expo Router, expo-image-picker, Zustand, @tanstack/react-query, react-i18next, Jest (`pnpm test:run`).

**Spec:** `docs/superpowers/specs/2026-07-19-foster-homes-registration-design.md` (§7 contacto, §11 mobile, §12 i18n).

**Alcance:** SOLO mobile UI. El backend (Fase 1) y la capa shared web+mobile (Fase 2: types/client/hooks) YA están en `main`. Este plan NO agrega hooks/types/client — los consume.

**Convenciones (CLAUDE.md):**
- **Tests mobile: `pnpm test:run`, NUNCA `pnpm test`** (es `jest --watchAll`, nunca termina — regla #17). Los smoke tests de screens **mockean `@shared/hooks` hook por hook**: cada hook nuevo usado en una screen testeada DEBE agregarse a su mock.
- i18n: separador `:` no `.` (regla #12). Registrar el namespace `fosterHomes` en el índice i18n de mobile (regla #21 aplicada a mobile).
- Errores API: `getErrorMessage(err, t)` de `@shared/utils/apiErrors` (regla #11).
- Estados foster home: `pending|approved|rejected|suspended`; labels vía `t('fosterHomes:status.<x>')` (regla #13).
- Commits convencionales SIN `Co-Authored-By`.
- Auth en mobile es Zustand (`useAuthStore`) — NO un React context como web. `const { user, isAuthenticated } = useAuthStore()`.

## Hooks/types shared ya disponibles (Fase 2)

`@shared/hooks`: `useFosterHomes(city?, animalType?)`, `useFosterHomeByID(id)`, `useMyFosterHome()`, `useRegisterFosterHome()`, `useUpdateMyFosterHome()`, `useUploadFosterHomePhoto()`, `useDeleteFosterHomePhoto()`, `useSubmitAbuseReport()`, `useVerificationStatus()`.
`@shared/types`: `FosterHome`, `MyFosterHome`, `FosterHomePhoto`, `HousingType`, `AnimalKind`, `FosterHomeStatus`, `RegisterFosterHomeRequest`, `UpdateMyFosterHomeRequest`.
> **Foto en RN:** `uploadFosterHomePhoto(file)` en el client espera un `File`. En React Native no hay `File` — mirá cómo el upload de foto de mascota mobile arma el "file" desde un URI de expo-image-picker (un objeto `{ uri, name, type }` casteado, vía FormData). Reutilizá ESE patrón. Ver Task 5.

---

## File Structure

**Crear (mobile):**
- `frontend/packages/mobile/app/foster-homes/index.tsx` — directorio (lista + filtro ciudad).
- `frontend/packages/mobile/app/foster-homes/register.tsx` — registro.
- `frontend/packages/mobile/app/foster-homes/mine.tsx` — mi hogar (estado + edición + fotos).
- `frontend/packages/mobile/app/foster-home/[id].tsx` — detalle + contacto + denuncia.
- `frontend/packages/mobile/components/FosterHomeCard.tsx` — card del directorio (opcional; puede ir inline como en shelters).
- Tests: `frontend/packages/mobile/__tests__/foster-homes.test.tsx` (o el dir de tests que use el repo — verificar `jest.config.js` `testMatch`).

**Modificar (mobile):**
- El índice i18n de mobile (buscar: `frontend/packages/mobile/**/i18n*` o donde se llame `i18n.use(...).init({resources})`) — registrar `fosterHomes`.
- Los locales mobile (es/en/pt) — namespace `fosterHomes` + error codes.
- La pantalla que lista accesos (profile tab o menú) — entry point a `/foster-homes`.

---

## Task 1: i18n mobile — namespace `fosterHomes`

**Files:**
- Modify: mobile i18n index + locales (es/en/pt).

- [ ] **Step 1: Localizar el i18n de mobile**

Run: `cd frontend/packages/mobile && grep -rn "i18n" --include=*.ts --include=*.tsx -l . | head` y buscar el archivo que hace `i18n.init({ resources: {...} })` y los JSON de locales (probablemente `frontend/packages/mobile/i18n/` o `frontend/packages/mobile/locales/`). Ver cómo se registran namespaces existentes (`shelters`, `adoption`, `pets`, `errors`).

- [ ] **Step 2: Agregar el namespace `fosterHomes` a los 3 locales**

Con las claves que usan las screens (mismas que web, adaptadas): `nav`, `directory.{title,empty,filterCity,filterPlaceholder,capacity,registerCta,subtitle}`, `status.{pending,approved,rejected,suspended}`, `housingType.{house,apartment}`, `animalType.{dog,cat,other}`, `detail.{contactChat,contactWhatsapp,reportCta,photos}`, `register.{title,intro,emailUnverified,verifyEmailLink,start,city,cityRequired,housingType,animalTypes,animalTypesRequired,capacity,capacityInvalid,description,descriptionRequired,whatsapp,submit,submitting,successTitle,successBody,goToMine}`, `mine.{title,statusPending,statusApproved,statusRejected,statusSuspended,rejectionReason,edit,save,saving,cancel,addPhoto,photoLimit,deletePhoto,suspendedFrozen,noFosterHomeTitle,registerNow}`, `report.{title,reasonLabel,reasonPlaceholder,submit,submitting,success}`. Traducir es/en/pt con paridad total.
Reusá los textos del namespace `fosterHomes` de web (`frontend/packages/web/src/i18n/locales/es.json`) como fuente para las traducciones — copiá y adaptá.

- [ ] **Step 3: Registrar el namespace en el índice i18n de mobile (regla #21)**

Agregar `fosterHomes` a los resources en los 3 idiomas del init, igual que los otros namespaces web-only de mobile. Sin esto, `useTranslation('fosterHomes')` devuelve la key cruda.

- [ ] **Step 4: Error codes**

Si mobile tiene su propio namespace `errors` (separado del de shared), agregar los 8 códigos nuevos (`foster_home_not_found`, `foster_home_already_owned`, `foster_home_suspended`, `invalid_foster_home_status`, `suspension_reason_required`, `too_many_photos`, `self_abuse_report`, `duplicate_abuse_report`). Si mobile usa el `errors` de `@shared/i18n` (que ya los tiene de la Fase 2), no hace falta duplicar — verificar cuál usa `getErrorMessage` en mobile.

- [ ] **Step 5: Validar JSON + commit**

Run: `node -e "require('<ruta>/es.json');require('<ruta>/en.json');require('<ruta>/pt.json');console.log('OK')"`
```bash
git add frontend/packages/mobile/<i18n paths>
git commit -m "feat(mobile): foster homes i18n (es/en/pt)"
```

---

## Task 2: Directorio `app/foster-homes/index.tsx`

**Files:**
- Create: `frontend/packages/mobile/app/foster-homes/index.tsx`

- [ ] **Step 1: Implementar (espeja `app/shelters/index.tsx`)**

READ `frontend/packages/mobile/app/shelters/index.tsx` y calcá su estructura EXACTA: `SafeAreaView`, header con back arrow (`useRouter().back()`), `useTranslation('fosterHomes')`, filtro de ciudad con debounce 500ms (`cityInput`/`debouncedCity`), `FlatList`, `SkeletonCard`, estados loading/error/empty.
Diferencias:
- `useFosterHomes(debouncedCity || undefined, undefined)` (sin filtro de animal en mobile MVP, o agregá un selector simple de tipo).
- Card (inline como ShelterCard o en `components/FosterHomeCard.tsx`): primera foto (o 🏠), ciudad, `t('fosterHomes:housingType.'+fh.housing_type)`, chips de `t('fosterHomes:animalType.'+k)`, capacidad, descripción (`numberOfLines={2}`). Tap → `router.push('/foster-home/'+fh.id)`.
- Botón "Ofrecer mi hogar" → `router.push('/foster-homes/register')`.
- **Privado:** si querés, redirigí a login si `!isAuthenticated` (`useAuthStore`), aunque la navegación ya debería estar detrás de auth. Mirá cómo otras screens privadas manejan esto.

- [ ] **Step 2: Typecheck + commit**

Run: `cd frontend/packages/mobile && pnpm tsc --noEmit` (o el script de typecheck; ver package.json). Debe pasar.
```bash
git add frontend/packages/mobile/app/foster-homes/index.tsx frontend/packages/mobile/components/FosterHomeCard.tsx
git commit -m "feat(mobile): foster homes directory screen"
```

---

## Task 3: Detalle `app/foster-home/[id].tsx`

**Files:**
- Create: `frontend/packages/mobile/app/foster-home/[id].tsx`

- [ ] **Step 1: Implementar (espeja `app/pet/[id].tsx` para contacto)**

READ `frontend/packages/mobile/app/pet/[id].tsx` para el patrón de detalle + cómo navega al chat + cómo abre WhatsApp (`Linking.openURL`).
- `useLocalSearchParams()` para `id` (expo-router), `useFosterHomeByID(id)`, `useAuthStore()` para `user`.
- Galería: `ScrollView` horizontal de `fh.photos` (o placeholder 🏠).
- Datos: ciudad, `housingType`, chips de animal, capacidad, descripción.
- **Contacto (§7):**
  - Botón "Contactar por chat" → navegar al chat con `fh.owner_user_id` (mirá la ruta real de chat en mobile — ej. `router.push('/messages/'+fh.owner_user_id)` o la que use `pet/[id]`). Ocultar si `fh.owner_user_id === user?.id`.
  - Botón "WhatsApp" (solo si `fh.whatsapp_phone`) → `Linking.openURL('https://wa.me/'+fh.whatsapp_phone.replace(/[^0-9]/g,''))`.
- **Denunciar:** botón que abre un modal/`Alert` con input de motivo → `useSubmitAbuseReport().mutate({ target_foster_home_id: id, reason })`; errores con `getErrorMessage` (maneja 409 self/duplicate). Ocultar si es tu propio hogar. Éxito → `Alert` con `t('fosterHomes:report.success')`.

- [ ] **Step 2: Typecheck + commit**

```bash
git add frontend/packages/mobile/app/foster-home/[id].tsx
git commit -m "feat(mobile): foster home detail with contact and report"
```

---

## Task 4: Registro `app/foster-homes/register.tsx`

**Files:**
- Create: `frontend/packages/mobile/app/foster-homes/register.tsx`

- [ ] **Step 1: Implementar (espeja `AdoptionFormStep.tsx`)**

READ `frontend/packages/mobile/components/publish/AdoptionFormStep.tsx` para el patrón de form (TextInputs, selector de tipo con chips, validación por campo, submit).
- Campos: `city` (required), `housing_type` (2 chips: house|apartment, required), `animal_types` (chips multi-select dog/cat/other, ≥1 required), `capacity` (TextInput numérico, ≥1 required), `description` (TextInput multiline, required), `whatsapp_phone` (opcional).
- Gate: `useVerificationStatus()` — si el email no está verificado, mostrar aviso + link a la pantalla de perfil/verificación (mirá cómo web `RegisterFosterHomePage` maneja el gate y cómo mobile navega a perfil).
- Guard: si `useMyFosterHome().data` existe → redirigir a `/foster-homes/mine` (`router.replace`).
- Submit: `useRegisterFosterHome().mutate(payload, { onSuccess: → Alert éxito + router.replace('/foster-homes/mine'), onError: → Alert getErrorMessage })`.
- `useTranslation(['fosterHomes','errors'])`. Labels `fosterHomes:register.*`.

- [ ] **Step 2: Typecheck + commit**

```bash
git add frontend/packages/mobile/app/foster-homes/register.tsx
git commit -m "feat(mobile): foster home registration screen"
```

---

## Task 5: Mi hogar `app/foster-homes/mine.tsx` (edición + fotos)

**Files:**
- Create: `frontend/packages/mobile/app/foster-homes/mine.tsx`

- [ ] **Step 1: Investigar el upload de foto mobile**

READ cómo el upload de foto de mascota mobile convierte un URI de expo-image-picker en algo que el client sube (busca `useUploadPetPhoto` / `apiClient.uploadPetPhoto` uso en mobile, o el FormData con `{ uri, name, type }`). El `uploadFosterHomePhoto(file: File)` del client necesita el MISMO tipo de "file" que mobile ya arma para mascotas. Si el client mobile castea `{ uri, name, type } as unknown as File`, replicá eso.

- [ ] **Step 2: Implementar (espeja `MyShelterPage` web + patrón de fotos de `AdoptionFormStep`)**

- `useMyFosterHome()`. Si error `code === 'foster_home_not_found'` → estado vacío con CTA a `/foster-homes/register`.
- Banner de estado: `t('fosterHomes:status.'+status)` + mensaje `fosterHomes:mine.status*`; si `rejected`, mostrar `rejection_reason`.
- Edición (`useUpdateMyFosterHome`): form editable (city, housing_type, animal_types, capacity, description, whatsapp). Si `status === 'suspended'` → deshabilitar edición + `t('fosterHomes:mine.suspendedFrozen')` (y manejar 409 `foster_home_suspended` con getErrorMessage).
- Fotos: mostrar `fh.photos` (thumbs) con botón borrar (`useDeleteFosterHomePhoto`); botón agregar con expo-image-picker (`useUploadFosterHomePhoto`), máx 5 (deshabilitar al llegar a 5, manejar `too_many_photos`).
- SIN botón de borrar el hogar (retención §18).

- [ ] **Step 3: Typecheck + commit**

```bash
git add frontend/packages/mobile/app/foster-homes/mine.tsx
git commit -m "feat(mobile): my foster home screen with edit and photos"
```

---

## Task 6: Entry point de navegación

**Files:**
- Modify: la pantalla de perfil o menú de mobile (buscar dónde está el link a "Refugios"/`/shelters`).

- [ ] **Step 1: Agregar el acceso**

Run: `cd frontend/packages/mobile && grep -rn "shelters" app/ | grep -i "push\|href\|Link"` para encontrar dónde se linkea a refugios (probablemente en el tab de perfil o un menú). Agregar un ítem "Hogares transitorios" (`t('fosterHomes:nav')`) que haga `router.push('/foster-homes')`, visible para usuarios autenticados. Seguir el estilo del ítem existente.

- [ ] **Step 2: Typecheck + commit**

```bash
git add frontend/packages/mobile/<archivo del menú>
git commit -m "feat(mobile): foster homes navigation entry"
```

---

## Task 7: Tests de screens (smoke, mock hook por hook)

**Files:**
- Create: `frontend/packages/mobile/__tests__/foster-homes.test.tsx`

- [ ] **Step 1: Escribir smoke tests (regla #17)**

READ un test de screen existente (ej. `frontend/packages/mobile/__tests__/*.test.tsx` que teste una screen con hooks de `@shared/hooks`) para copiar el patrón de mock. Los smoke tests mockean `@shared/hooks` **hook por hook** — cada hook usado por las screens testeadas debe estar en el mock.
Cubrir al menos:
- Directorio: renderiza la lista cuando `useFosterHomes` devuelve datos; muestra empty cuando vacío.
- Register: muestra el aviso de email no verificado cuando `useVerificationStatus` devuelve `email_verified:false`.
- Mine: muestra el CTA de registrar cuando `useMyFosterHome` devuelve error `foster_home_not_found`; muestra el banner de suspendido + edición deshabilitada cuando el status es `suspended`.

- [ ] **Step 2: Correr los tests**

Run: `cd frontend/packages/mobile && pnpm test:run` (NUNCA `pnpm test` — es watch, no termina). Filtrar si hace falta: `pnpm test:run foster-homes`.
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/packages/mobile/__tests__/foster-homes.test.tsx
git commit -m "test(mobile): foster home screens smoke tests"
```

---

## Task 8: Cierre — suite + PR

- [ ] **Step 1: Typecheck + suite mobile completa**

Run: `cd frontend/packages/mobile && pnpm tsc --noEmit && pnpm test:run`
Expected: typecheck limpio; suite mobile verde (todas las suites, sin romper las existentes — recordá que todo hook nuevo en una screen testeada debe estar en su mock).

- [ ] **Step 2: Verificación manual (Expo)**

`make mobile` (o `pnpm start` en mobile), loguearse, y recorrer: `/foster-homes` (directorio), registrar, ver "mi hogar" pending, (aprobar desde la WEB admin), volver y ver el detalle, probar contacto (chat + WhatsApp) y denuncia. Revisar que no aparezcan keys i18n crudas.

- [ ] **Step 3: PR (Fase 3)**

Skill `searchpet-pr`. Base `main`, rama `feat/foster-homes-mobile`. Nota: mobile changed → `pnpm test:run` corrido (NO `pnpm test`).

---

## Self-Review (cobertura del spec)

- §11 Directorio mobile → Task 2. Detalle + contacto → Task 3. Registro → Task 4. Mi hogar + edición + fotos → Task 5. Entry point → Task 6.
- §7 Contacto (chat + WhatsApp opcional) → Task 3.
- §8 Fotos (subida/borrado, máx 5) → Task 5.
- §12 i18n es/en/pt + registro (regla #21) → Task 1.
- §18/§19 en mobile: sin borrado del hogar (Task 5), suspendido congelado (Task 5), denuncia (Task 3). La moderación admin es web-only (fuera de alcance mobile — decisión de diseño).
- Tests → Task 7.

**Gaps deliberados:** admin/moderación NO va en mobile (los admins usan la web). El filtro por tipo de animal en el directorio es opcional en mobile MVP (solo ciudad, como shelters).

**Riesgos flageados:**
- Task 5: el "file" de RN para el upload — hay que calcar cómo mobile arma el objeto `{uri,name,type}` para el upload de foto de mascota (el client tipa `File`, RN no tiene `File`).
- Task 1 y Task 7: la ubicación exacta del i18n index de mobile y del patrón de mock de `@shared/hooks` en los tests — inspeccionar antes de escribir (no asumir rutas).
