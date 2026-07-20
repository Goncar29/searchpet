# Foster Homes — Web (Fase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir la UI web de "hogares transitorios" (directorio privado, registro, edición del dueño con fotos, contacto chat/WhatsApp, denuncia, y panel admin de moderación con visor forense), consumiendo la API de la Fase 1 (backend, PR #99).

**Architecture:** React + Vite + Tailwind + React Router + React Query. Código compartido (types/api client/hooks) en `frontend/packages/shared/`; páginas y componentes en `frontend/packages/web/`. Espeja el flujo de auto-registro de refugios (`RegisterShelterPage`, `MyShelterPage`, `SheltersAdminPage`, `ShelterSteps`) pero adaptado: sección **privada** (todo tras `ProtectedRoute`), campos propios del hogar, fotos, contacto, denuncia y moderación con suspensión + auditoría.

**Tech Stack:** TypeScript, React 18, React Router v7 (`react-router`), @tanstack/react-query, Tailwind, react-i18next, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-19-foster-homes-registration-design.md` (§7 contacto, §9 endpoints, §10 web, §12 i18n, §18/§19 seguridad).
**Backend API (Fase 1, ya mergeable):** ver §"Contrato de API" abajo.

**Alcance:** SOLO web. Mobile (Fase 3) es un plan separado. Depende del backend de la Fase 1 (idealmente mergeado en `main` antes de arrancar; si no, apuntar contra la rama `feat/foster-homes`).

**Convenciones a respetar (del CLAUDE.md):**
- Código compartido en `frontend/packages/shared/` (regla #9); imports bare desde shared necesitan alias en `web/vite.config.ts` (regla #15 — acá no se agregan deps nuevas, así que no aplica).
- i18n: separador de namespace es `:` no `.` (regla #12). **Registrar el namespace `fosterHomes` en `web/src/i18n/index.ts`** en los 3 bloques es/en/pt (regla #21) — si no, se ve la key cruda.
- Errores API: usar `getErrorMessage(err, t)` de `@shared/utils/apiErrors` (regla #11); agregar los códigos nuevos al namespace `errors`.
- Tests de shared/ con Vitest desde `web/` (`pnpm vitest run --config vitest.shared.config.ts`; `test:run` ya encadena) (regla #14). Solo testear hooks con lógica real, no passthroughs triviales.
- Estados válidos foster home: `pending | approved | rejected | suspended`. Labels SIEMPRE vía `t('fosterHomes:status.<x>')`, nunca hardcode (regla #13 aplicada al nuevo dominio).
- Commits convencionales SIN `Co-Authored-By`.

---

## Contrato de API (Fase 1 backend)

Todo requiere JWT (sección privada). Respuestas `{code,message}` en error.

| Método | Path | Body | Respuesta |
|---|---|---|---|
| GET | `/api/foster-homes?city=&animal_type=` | — | `FosterHome[]` (solo approved) |
| GET | `/api/foster-homes/:id` | — | `FosterHome` (404 si no approved) |
| POST | `/api/foster-homes` | `RegisterFosterHomeRequest` | `MyFosterHome` (201) |
| GET | `/api/foster-homes/mine` | — | `MyFosterHome` (404 `foster_home_not_found` si no tiene) |
| PUT | `/api/foster-homes/mine` | `UpdateMyFosterHomeRequest` | `MyFosterHome` (409 `foster_home_suspended` si suspendido) |
| POST | `/api/foster-homes/mine/photos` | multipart `photo` | `{id,url}` (201; 422 `too_many_photos`) |
| DELETE | `/api/foster-homes/mine/photos/:photoId` | — | 204 |
| GET | `/api/foster-homes/pending` | — | `MyFosterHome[]` (admin) |
| POST | `/api/foster-homes/:id/approve` | — | `MyFosterHome` (admin) |
| POST | `/api/foster-homes/:id/reject` | `{reason}` | `MyFosterHome` (admin) |
| POST | `/api/foster-homes/:id/suspend` | `{reason}` | `MyFosterHome` (admin) |
| POST | `/api/foster-homes/:id/reinstate` | — | `MyFosterHome` (admin) |
| GET | `/api/foster-homes/:id/logs` | — | `FosterHomeModerationLog[]` (admin) |
| GET | `/api/foster-homes/:id/history` | — | `FosterHomeChangeLog[]` (admin) |
| POST | `/api/abuse-reports` | `{target_foster_home_id, reason}` | denuncia (endpoint existente; 409 `self_abuse_report`/`duplicate_abuse_report`) |

Errores nuevos a i18n: `foster_home_not_found`, `foster_home_already_owned`, `foster_home_suspended`, `invalid_foster_home_status`, `suspension_reason_required`, `too_many_photos`, `self_abuse_report`, `duplicate_abuse_report`.

Contacto (§7): chat in-app = navegar a `/messages/{owner_user_id}` (ruta existente `ChatPage`); WhatsApp = `https://wa.me/<whatsapp_phone>` si está presente.

---

## File Structure

**Modificar (shared):**
- `frontend/packages/shared/types/index.ts` — interfaces del dominio foster home.
- `frontend/packages/shared/api/client.ts` — métodos del API client.
- `frontend/packages/shared/hooks/index.ts` — hooks React Query.

**Modificar (web):**
- `frontend/packages/web/src/App.tsx` — rutas (protegidas + admin).
- `frontend/packages/web/src/layouts/MainLayout.tsx` — link de nav a "Hogares transitorios".
- `frontend/packages/web/src/i18n/index.ts` — registrar namespace `fosterHomes` (regla #21).
- `frontend/packages/web/src/i18n/locales/{es,en,pt}.json` — namespace `fosterHomes` + códigos de error nuevos en `errors`.

**Crear (web):**
- `frontend/packages/web/src/pages/FosterHomesPage.tsx` — directorio privado + filtros.
- `frontend/packages/web/src/pages/FosterHomeDetailPage.tsx` — detalle + contacto + denuncia.
- `frontend/packages/web/src/pages/RegisterFosterHomePage.tsx` — registro.
- `frontend/packages/web/src/pages/MyFosterHomePage.tsx` — vista/edición del dueño + fotos.
- `frontend/packages/web/src/pages/admin/FosterHomesAdminPage.tsx` — cola + moderación + visor logs/history.
- `frontend/packages/web/src/components/FosterHomeCard.tsx` — card del directorio.
- `frontend/packages/web/src/components/ReportFosterHomeModal.tsx` — modal de denuncia.

**Test:**
- `frontend/packages/shared/hooks/fosterHomes.test.ts` — hooks con lógica real (invalidaciones, reshape).

---

## Task 1: Shared — types del dominio

**Files:**
- Modify: `frontend/packages/shared/types/index.ts`

- [ ] **Step 1: Agregar las interfaces**

Al final de la sección de tipos (después de las de SHELTERS), agregar:
```ts
// ============================================================
// FOSTER HOMES (hogares transitorios)
// ============================================================

export type HousingType = 'house' | 'apartment';
export type AnimalKind = 'dog' | 'cat' | 'other';
export type FosterHomeStatus = 'pending' | 'approved' | 'rejected' | 'suspended';

export interface FosterHomePhoto {
  id: string;
  url: string;
}

// Vista de directorio (GET /api/foster-homes, /:id) — sección privada.
export interface FosterHome {
  id: string;
  owner_user_id: string;
  city: string;
  housing_type: HousingType;
  animal_types: AnimalKind[];
  capacity: number;
  description: string;
  whatsapp_phone?: string;
  photos: FosterHomePhoto[];
  created_at: string;
}

// Vista del dueño (GET /api/foster-homes/mine) — + estado de moderación.
export interface MyFosterHome extends FosterHome {
  status: FosterHomeStatus;
  rejection_reason?: string;
}

export interface RegisterFosterHomeRequest {
  city: string;
  housing_type: HousingType;
  animal_types: AnimalKind[];
  capacity: number;
  description: string;
  whatsapp_phone?: string;
  latitude?: number;
  longitude?: number;
}

// PUT /api/foster-homes/mine — omitir (undefined) = no tocar; enviar valor = aplicar.
export interface UpdateMyFosterHomeRequest {
  city?: string;
  housing_type?: HousingType;
  animal_types?: AnimalKind[];
  capacity?: number;
  description?: string;
  whatsapp_phone?: string;
  latitude?: number;
  longitude?: number;
}

// Vista admin forense (§18) — GET /api/foster-homes/:id/logs.
export interface FosterHomeModerationLog {
  id: string;
  foster_home_id: string;
  actor_admin_id: string;
  action: 'approve' | 'reject' | 'suspend' | 'reinstate';
  reason?: string;
  owner_user_id: string;
  owner_email?: string;
  owner_phone?: string;
  owner_whatsapp?: string;
  created_at: string;
}

// Vista admin forense (§18.1) — GET /api/foster-homes/:id/history.
export interface FosterHomeChangeLog {
  id: string;
  foster_home_id: string;
  edited_by_id: string;
  change_type: 'listing_edit' | 'owner_contact_changed';
  changed_fields: Record<string, { old: string; new: string }> | null;
  owner_email?: string;
  owner_phone?: string;
  owner_whatsapp?: string;
  created_at: string;
}
```

- [ ] **Step 2: Verificar typecheck**

Run: `cd frontend/packages/web && pnpm tsc --noEmit` (o el script de typecheck del repo — revisar `package.json`).
Expected: sin errores nuevos.

- [ ] **Step 3: Commit**

```bash
git add frontend/packages/shared/types/index.ts
git commit -m "feat(web): foster home shared types"
```

---

## Task 2: Shared — API client

**Files:**
- Modify: `frontend/packages/shared/api/client.ts`

- [ ] **Step 1: Importar los tipos**

En el bloque `import type { ... } from '../types';` agregar:
```ts
  FosterHome,
  MyFosterHome,
  RegisterFosterHomeRequest,
  UpdateMyFosterHomeRequest,
  FosterHomeModerationLog,
  FosterHomeChangeLog,
```

- [ ] **Step 2: Agregar los métodos**

Después del bloque de métodos de SHELTERS, agregar una sección FOSTER HOMES. Nota: el upload usa `FormData` — mirar cómo el client sube fotos de mascota (`uploadPetPhoto` o similar) y replicar el manejo de multipart/headers/token. Si el `request()` helper no soporta FormData, usar `fetch` directo con el header Authorization como hace el upload de pet.
```ts
  // ============================================================
  // FOSTER HOMES (hogares transitorios) — sección privada (JWT)
  // ============================================================

  async getFosterHomes(city?: string, animalType?: string): Promise<FosterHome[]> {
    const params: Record<string, string> = {};
    if (city) params.city = city;
    if (animalType) params.animal_type = animalType;
    return this.request<FosterHome[]>('GET', '/api/foster-homes', undefined, params);
  }

  async getFosterHomeByID(id: string): Promise<FosterHome> {
    return this.request<FosterHome>('GET', `/api/foster-homes/${encodeURIComponent(id)}`);
  }

  async registerFosterHome(data: RegisterFosterHomeRequest): Promise<MyFosterHome> {
    return this.request<MyFosterHome>('POST', '/api/foster-homes', data);
  }

  async getMyFosterHome(): Promise<MyFosterHome> {
    return this.request<MyFosterHome>('GET', '/api/foster-homes/mine');
  }

  async updateMyFosterHome(data: UpdateMyFosterHomeRequest): Promise<MyFosterHome> {
    return this.request<MyFosterHome>('PUT', '/api/foster-homes/mine', data);
  }

  async uploadFosterHomePhoto(file: File): Promise<FosterHomePhoto> {
    const form = new FormData();
    form.append('photo', file);
    // Replicar EXACTAMENTE el patrón del upload de foto de mascota (headers Authorization,
    // sin Content-Type manual — el browser lo setea con el boundary). Ver uploadPetPhoto.
    return this.requestMultipart<FosterHomePhoto>('POST', '/api/foster-homes/mine/photos', form);
  }

  async deleteFosterHomePhoto(photoId: string): Promise<void> {
    await this.request<void>('DELETE', `/api/foster-homes/mine/photos/${encodeURIComponent(photoId)}`);
  }

  // Admin
  async getPendingFosterHomes(): Promise<MyFosterHome[]> {
    return this.request<MyFosterHome[]>('GET', '/api/foster-homes/pending');
  }

  async approveFosterHome(id: string): Promise<MyFosterHome> {
    return this.request<MyFosterHome>('POST', `/api/foster-homes/${encodeURIComponent(id)}/approve`);
  }

  async rejectFosterHome(id: string, reason: string): Promise<MyFosterHome> {
    return this.request<MyFosterHome>('POST', `/api/foster-homes/${encodeURIComponent(id)}/reject`, { reason });
  }

  async suspendFosterHome(id: string, reason: string): Promise<MyFosterHome> {
    return this.request<MyFosterHome>('POST', `/api/foster-homes/${encodeURIComponent(id)}/suspend`, { reason });
  }

  async reinstateFosterHome(id: string): Promise<MyFosterHome> {
    return this.request<MyFosterHome>('POST', `/api/foster-homes/${encodeURIComponent(id)}/reinstate`);
  }

  async getFosterHomeLogs(id: string): Promise<FosterHomeModerationLog[]> {
    return this.request<FosterHomeModerationLog[]>('GET', `/api/foster-homes/${encodeURIComponent(id)}/logs`);
  }

  async getFosterHomeHistory(id: string): Promise<FosterHomeChangeLog[]> {
    return this.request<FosterHomeChangeLog[]>('GET', `/api/foster-homes/${encodeURIComponent(id)}/history`);
  }
```
> **IMPORTANTE (upload):** inspeccioná el método real de upload de foto de mascota en `client.ts` (nombre, si usa un helper `requestMultipart` o `fetch` directo, cómo pasa el token). Reemplazá `this.requestMultipart(...)` por ese patrón exacto. Si NO existe un helper multipart, escribí el `fetch` inline copiando el del upload de mascota. `FosterHomePhoto` ya está importado vía Task 1 — agregalo al bloque de imports si falta.

- [ ] **Step 3: Verificar typecheck + commit**

Run: `cd frontend/packages/web && pnpm tsc --noEmit`
```bash
git add frontend/packages/shared/api/client.ts
git commit -m "feat(web): foster home API client methods"
```

---

## Task 3: Shared — hooks React Query

**Files:**
- Modify: `frontend/packages/shared/hooks/index.ts`

- [ ] **Step 1: Agregar los hooks**

Después de los SHELTER HOOKS, agregar. Query keys: `['fosterHomes', ...]` para el directorio, `['fosterHome','mine']` para el dueño, `['fosterHome', id]` para el detalle, `['fosterHomes','pending']` para la cola admin.
```ts
// ============================================================
// FOSTER HOME HOOKS (hogares transitorios)
// ============================================================

export const useFosterHomes = (city?: string, animalType?: string) => {
  return useQuery<FosterHome[]>({
    queryKey: ['fosterHomes', city ?? '', animalType ?? ''],
    queryFn: () => apiClient.getFosterHomes(city, animalType),
    staleTime: 5 * 60 * 1000,
  });
};

export const useFosterHomeByID = (id: string) => {
  return useQuery<FosterHome>({
    queryKey: ['fosterHome', id],
    queryFn: () => apiClient.getFosterHomeByID(id),
    enabled: !!id,
  });
};

// 404 = el usuario no tiene hogar; retry:false para no quemar reintentos.
export const useMyFosterHome = (enabled = true) => {
  return useQuery<MyFosterHome, Error & { code?: string }>({
    queryKey: ['fosterHome', 'mine'],
    queryFn: () => apiClient.getMyFosterHome(),
    retry: false,
    enabled,
  });
};

export const useRegisterFosterHome = () => {
  const queryClient = useQueryClient();
  return useMutation<MyFosterHome, Error, RegisterFosterHomeRequest>({
    mutationFn: (data) => apiClient.registerFosterHome(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fosterHome', 'mine'] });
    },
  });
};

export const useUpdateMyFosterHome = () => {
  const queryClient = useQueryClient();
  return useMutation<MyFosterHome, Error, UpdateMyFosterHomeRequest>({
    mutationFn: (data) => apiClient.updateMyFosterHome(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fosterHome', 'mine'] });
      queryClient.invalidateQueries({ queryKey: ['fosterHomes'] });
    },
  });
};

export const useUploadFosterHomePhoto = () => {
  const queryClient = useQueryClient();
  return useMutation<FosterHomePhoto, Error, File>({
    mutationFn: (file) => apiClient.uploadFosterHomePhoto(file),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['fosterHome', 'mine'] }),
  });
};

export const useDeleteFosterHomePhoto = () => {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (photoId) => apiClient.deleteFosterHomePhoto(photoId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['fosterHome', 'mine'] }),
  });
};

// --- Admin ---

export const usePendingFosterHomes = () => {
  return useQuery<MyFosterHome[]>({
    queryKey: ['fosterHomes', 'pending'],
    queryFn: () => apiClient.getPendingFosterHomes(),
  });
};

// Cada transición invalida la cola pending y el directorio público.
const fosterHomeModerationOnSuccess = (queryClient: ReturnType<typeof useQueryClient>) => () => {
  queryClient.invalidateQueries({ queryKey: ['fosterHomes'] });
};

export const useApproveFosterHome = () => {
  const queryClient = useQueryClient();
  return useMutation<MyFosterHome, Error, string>({
    mutationFn: (id) => apiClient.approveFosterHome(id),
    onSuccess: fosterHomeModerationOnSuccess(queryClient),
  });
};

export const useRejectFosterHome = () => {
  const queryClient = useQueryClient();
  return useMutation<MyFosterHome, Error, { id: string; reason: string }>({
    mutationFn: ({ id, reason }) => apiClient.rejectFosterHome(id, reason),
    onSuccess: fosterHomeModerationOnSuccess(queryClient),
  });
};

export const useSuspendFosterHome = () => {
  const queryClient = useQueryClient();
  return useMutation<MyFosterHome, Error, { id: string; reason: string }>({
    mutationFn: ({ id, reason }) => apiClient.suspendFosterHome(id, reason),
    onSuccess: fosterHomeModerationOnSuccess(queryClient),
  });
};

export const useReinstateFosterHome = () => {
  const queryClient = useQueryClient();
  return useMutation<MyFosterHome, Error, string>({
    mutationFn: (id) => apiClient.reinstateFosterHome(id),
    onSuccess: fosterHomeModerationOnSuccess(queryClient),
  });
};

export const useFosterHomeLogs = (id: string, enabled = true) => {
  return useQuery<FosterHomeModerationLog[]>({
    queryKey: ['fosterHome', id, 'logs'],
    queryFn: () => apiClient.getFosterHomeLogs(id),
    enabled: enabled && !!id,
  });
};

export const useFosterHomeHistory = (id: string, enabled = true) => {
  return useQuery<FosterHomeChangeLog[]>({
    queryKey: ['fosterHome', id, 'history'],
    queryFn: () => apiClient.getFosterHomeHistory(id),
    enabled: enabled && !!id,
  });
};
```
> Verificá que los tipos usados estén importados al tope de `hooks/index.ts` (agregá `FosterHome, MyFosterHome, RegisterFosterHomeRequest, UpdateMyFosterHomeRequest, FosterHomePhoto, FosterHomeModerationLog, FosterHomeChangeLog` al import de `../types`).

- [ ] **Step 2: Typecheck + commit**

Run: `cd frontend/packages/web && pnpm tsc --noEmit`
```bash
git add frontend/packages/shared/hooks/index.ts
git commit -m "feat(web): foster home React Query hooks"
```

---

## Task 4: i18n — namespace `fosterHomes` + errores

**Files:**
- Modify: `frontend/packages/web/src/i18n/index.ts`
- Modify: `frontend/packages/web/src/i18n/locales/es.json`, `en.json`, `pt.json`

- [ ] **Step 1: Registrar el namespace (regla #21)**

Abrí `web/src/i18n/index.ts`. Buscá cómo se registran los namespaces (ej. `shelters`, `admin`, `vets`) en los 3 bloques `es`/`en`/`pt`. Agregá `fosterHomes` en los 3, IMPORTÁNDOLO del JSON igual que los demás. SIN esto, `useTranslation('fosterHomes')` devuelve la key cruda.

- [ ] **Step 2: Agregar el namespace a los 3 locales**

En `es.json` agregá la clave `fosterHomes` (y equivalentes traducidos en `en.json`/`pt.json`). Estructura mínima (es):
```json
"fosterHomes": {
  "nav": "Hogares transitorios",
  "directory": { "title": "Hogares transitorios", "empty": "No hay hogares disponibles todavía.", "filterCity": "Ciudad", "filterAnimal": "Tipo de animal", "capacity": "Capacidad", "registerCta": "Ofrecer mi hogar" },
  "status": { "pending": "En revisión", "approved": "Activo", "rejected": "Rechazado", "suspended": "Suspendido" },
  "housingType": { "house": "Casa", "apartment": "Apartamento" },
  "animalType": { "dog": "Perro", "cat": "Gato", "other": "Otros" },
  "detail": { "contactChat": "Contactar por chat", "contactWhatsapp": "WhatsApp", "reportCta": "Denunciar", "photos": "Fotos del lugar" },
  "register": {
    "title": "Ofrecer mi hogar transitorio",
    "intro": "Registrá tu espacio para alojar temporalmente a un animal rescatado.",
    "emailUnverified": "Necesitás verificar tu email antes de registrar tu hogar.",
    "verifyEmailLink": "Verificar email",
    "start": "Empezar",
    "city": "Ciudad", "cityRequired": "La ciudad es obligatoria",
    "housingType": "Tipo de vivienda",
    "animalTypes": "¿Qué animales podés recibir?", "animalTypesRequired": "Elegí al menos un tipo",
    "capacity": "¿Cuántos animales a la vez?", "capacityInvalid": "Debe ser 1 o más",
    "description": "Describí tu espacio", "descriptionRequired": "La descripción es obligatoria",
    "whatsapp": "WhatsApp (opcional)",
    "submit": "Registrar hogar", "submitting": "Registrando...",
    "successTitle": "¡Hogar registrado!", "successBody": "Un administrador lo revisará antes de publicarlo.",
    "goToMine": "Ver mi hogar", "reviewNote": "Un admin revisa cada hogar antes de publicarlo.", "oneNote": "Podés tener un solo hogar por cuenta."
  },
  "mine": {
    "title": "Mi hogar transitorio",
    "statusPending": "En revisión por un administrador.",
    "statusApproved": "Tu hogar está publicado.",
    "statusRejected": "Rechazado. Editá y volvé a enviar.",
    "statusSuspended": "Suspendido por un administrador. Contactá al soporte.",
    "rejectionReason": "Motivo",
    "edit": "Editar", "save": "Guardar", "saving": "Guardando...", "cancel": "Cancelar",
    "addPhoto": "Agregar foto", "photoLimit": "Máximo 5 fotos", "deletePhoto": "Eliminar",
    "suspendedFrozen": "No podés editar un hogar suspendido."
  },
  "report": { "title": "Denunciar hogar", "reasonLabel": "Motivo de la denuncia", "reasonPlaceholder": "Contanos qué pasó", "submit": "Enviar denuncia", "submitting": "Enviando...", "success": "Denuncia enviada. Gracias." },
  "admin": {
    "title": "Hogares transitorios",
    "pendingQueue": "Cola de revisión",
    "approve": "Aprobar", "reject": "Rechazar", "suspend": "Suspender", "reinstate": "Reinstaurar",
    "reasonRequired": "El motivo es obligatorio",
    "viewLogs": "Ver moderación", "viewHistory": "Ver historial de ediciones",
    "logsTitle": "Rastro de moderación", "historyTitle": "Historial de ediciones",
    "noLogs": "Sin registros.", "ownerSnapshot": "Contacto del dueño (al momento)"
  }
}
```
Traducí las mismas claves en `en.json` y `pt.json` (paridad total de keys — mismas claves, valores traducidos).

- [ ] **Step 3: Agregar los códigos de error al namespace `errors`**

En los 3 locales, dentro del namespace `errors`, agregá:
```json
"foster_home_not_found": "Hogar transitorio no encontrado",
"foster_home_already_owned": "Ya tenés un hogar transitorio registrado",
"foster_home_suspended": "Este hogar está suspendido y no se puede editar",
"invalid_foster_home_status": "Acción no válida para el estado actual del hogar",
"suspension_reason_required": "El motivo de suspensión es obligatorio",
"too_many_photos": "Alcanzaste el máximo de fotos",
"self_abuse_report": "No podés denunciar tu propio hogar",
"duplicate_abuse_report": "Ya tenés una denuncia pendiente sobre este hogar"
```
(en/pt traducidos.)

- [ ] **Step 4: Verificar en runtime + commit**

Run: `cd frontend/packages/web && pnpm tsc --noEmit`
Verificación manual (más tarde, en dev): que no aparezcan keys crudas (ej. `fosterHomes:status.pending`) en pantalla — si aparecen, revisar el registro en `index.ts` (regla #21).
```bash
git add frontend/packages/web/src/i18n/
git commit -m "feat(web): foster homes i18n (es/en/pt) + error codes"
```

---

## Task 5: Componente `FosterHomeCard` + página directorio `FosterHomesPage`

**Files:**
- Create: `frontend/packages/web/src/components/FosterHomeCard.tsx`
- Create: `frontend/packages/web/src/pages/FosterHomesPage.tsx`

- [ ] **Step 1: `FosterHomeCard.tsx`**

Card que muestra: primera foto (o placeholder 🏠), ciudad, tipo de vivienda (`t('fosterHomes:housingType.<x>')`), chips de animal_types (`t('fosterHomes:animalType.<x>')`), capacidad, y descripción recortada. Link a `/hogares/${fh.id}`. Usar `useTranslation(['fosterHomes'])`. Espejar el look de `PetCardWeb`/`ShelterCard` (Tailwind, dark mode). Alturas parejas (`line-clamp-2 min-h-[2.5rem]` en la descripción, como el fix del feed).

- [ ] **Step 2: `FosterHomesPage.tsx` (directorio privado)**

- `useTranslation(['fosterHomes','common'])`, `useFosterHomes(cityApplied, animalApplied)`.
- Filtros con **patrón draft/applied** (no disparar API por keystroke — regla del proyecto): estado `draftCity`/`draftAnimal` + `appliedCity`/`appliedAnimal`, se aplican con submit/botón, no en cada `onChange`.
- Filtro de animal: select con opciones dog/cat/other (labels i18n).
- Grid de `FosterHomeCard`. Estado vacío: `t('fosterHomes:directory.empty')`. Loading: skeletons.
- CTA "Ofrecer mi hogar" → link a `/hogares/registrar`.

- [ ] **Step 3: Typecheck + commit**

Run: `cd frontend/packages/web && pnpm tsc --noEmit`
```bash
git add frontend/packages/web/src/components/FosterHomeCard.tsx frontend/packages/web/src/pages/FosterHomesPage.tsx
git commit -m "feat(web): foster homes directory page and card"
```

---

## Task 6: Detalle `FosterHomeDetailPage` + denuncia `ReportFosterHomeModal`

**Files:**
- Create: `frontend/packages/web/src/components/ReportFosterHomeModal.tsx`
- Create: `frontend/packages/web/src/pages/FosterHomeDetailPage.tsx`

- [ ] **Step 1: `ReportFosterHomeModal.tsx`**

Modal con textarea de motivo (required) + botón enviar. Usa el endpoint de denuncia existente: `apiClient.createAbuseReport({ target_foster_home_id: id, reason })` (verificá el nombre real del método/hook de abuse report en `client.ts`/`hooks`; si hay `useCreateAbuseReport`, usalo). Maneja errores con `getErrorMessage(err, t)` (incluye `self_abuse_report`/`duplicate_abuse_report` → 409). En éxito muestra `t('fosterHomes:report.success')` y cierra.

- [ ] **Step 2: `FosterHomeDetailPage.tsx`**

- `useParams()` para `id`, `useFosterHomeByID(id)`, `useAuth()`.
- Galería de fotos (usar `PhotoBanner` o un grid simple con las `fh.photos`). Placeholder 🏠 si no hay.
- Datos: ciudad, tipo de vivienda, animal_types (chips i18n), capacidad, descripción.
- **Contacto (§7):**
  - Botón "Contactar por chat" → `navigate('/messages/' + fh.owner_user_id)`. Ocultar si `fh.owner_user_id === user?.id` (es tu propio hogar).
  - Botón "WhatsApp" (solo si `fh.whatsapp_phone`) → abre `https://wa.me/${fh.whatsapp_phone.replace(/[^0-9]/g,'')}` en nueva pestaña.
- Botón "Denunciar" → abre `ReportFosterHomeModal` (ocultar si es tu propio hogar).
- 404/no-approved → mensaje "no encontrado" (el backend devuelve 404 para no-approved).

- [ ] **Step 3: Typecheck + commit**

```bash
git add frontend/packages/web/src/components/ReportFosterHomeModal.tsx frontend/packages/web/src/pages/FosterHomeDetailPage.tsx
git commit -m "feat(web): foster home detail with contact and report"
```

---

## Task 7: Registro `RegisterFosterHomePage`

**Files:**
- Create: `frontend/packages/web/src/pages/RegisterFosterHomePage.tsx`

- [ ] **Step 1: Implementar (espeja `RegisterShelterPage`)**

Copiá la ESTRUCTURA de `RegisterShelterPage.tsx` (stepper `intro`/`form`/`done`, guard de email verificado con `useVerificationStatus`, redirect si ya tiene hogar con `useMyFosterHome`, `getErrorMessage`). Diferencias de campos:
- `city` (required), `housing_type` (radio/select house|apartment, required), `animal_types` (checkboxes dog/cat/other, ≥1 required), `capacity` (number ≥1, required), `description` (textarea required), `whatsapp_phone` (opcional).
- Validación cliente espejo del backend: city/description no vacíos, housing_type válido, capacity≥1, ≥1 animal_type.
- Submit con `useRegisterFosterHome().mutate(...)`, `onSuccess → step 'done'`, `onError → getErrorMessage`.
- Guard: si `useMyFosterHome().data` existe y `step !== 'done'` → `<Navigate to="/hogares/mio" replace />`.
- Labels i18n `fosterHomes:register.*`. Título, notas (reviewNote, oneNote), pantalla done con link a `/hogares/mio`.

- [ ] **Step 2: Typecheck + commit**

```bash
git add frontend/packages/web/src/pages/RegisterFosterHomePage.tsx
git commit -m "feat(web): foster home registration page"
```

---

## Task 8: Dueño `MyFosterHomePage` (edición + fotos)

**Files:**
- Create: `frontend/packages/web/src/pages/MyFosterHomePage.tsx`

- [ ] **Step 1: Implementar (espeja `MyShelterPage`)**

- `useMyFosterHome()`. Si 404 (`code === 'foster_home_not_found'`) → CTA para registrar (`/hogares/registrar`).
- Muestra estado con `t('fosterHomes:status.<status>')` y el banner de estado (pending/approved/rejected/suspended) con el mensaje correspondiente (`fosterHomes:mine.status*`). Si `rejected`, muestra `rejection_reason`.
- **Edición** (`useUpdateMyFosterHome`): form con los campos editables (city, housing_type, animal_types, capacity, description, whatsapp_phone). Enviar solo lo que cambió (o todo — el backend hace merge por punteros/undefined). Si el hogar está `suspended`, **deshabilitar la edición** y mostrar `t('fosterHomes:mine.suspendedFrozen')` (el backend igual devuelve 409 `foster_home_suspended`; manejarlo con `getErrorMessage`).
- **Fotos** (`useUploadFosterHomePhoto`/`useDeleteFosterHomePhoto`): grid de fotos actuales con botón eliminar; input file para agregar (máx 5 — deshabilitar el agregar si ya hay 5, y manejar `too_many_photos`). Aceptar image/jpeg,png,webp.
- No hay botón de borrar el hogar (por diseño — retención §18).

- [ ] **Step 2: Typecheck + commit**

```bash
git add frontend/packages/web/src/pages/MyFosterHomePage.tsx
git commit -m "feat(web): my foster home page with edit and photos"
```

---

## Task 9: Admin `FosterHomesAdminPage` (moderación + visor forense)

**Files:**
- Create: `frontend/packages/web/src/pages/admin/FosterHomesAdminPage.tsx`

- [ ] **Step 1: Implementar (espeja `SheltersAdminPage`)**

- `usePendingFosterHomes()` → lista la cola. Cada item muestra ciudad, tipo, animal_types, capacidad, descripción, owner.
- Acciones por item: **Aprobar** (`useApproveFosterHome`), **Rechazar** (`useRejectFosterHome`, pide motivo), **Suspender** (`useSuspendFosterHome`, pide motivo — mostrar solo para approved), **Reinstaurar** (`useReinstateFosterHome` — solo para suspended). Motivo vía prompt/modal; validar no vacío (`t('fosterHomes:admin.reasonRequired')`).
- **Visor forense** (§18/§18.1): por hogar, botones "Ver moderación" (`useFosterHomeLogs`) e "Ver historial" (`useFosterHomeHistory`), que expanden/despliegan una tabla:
  - Logs: action (label i18n), reason, snapshot de contacto del dueño (email/phone/whatsapp), fecha.
  - History: change_type, y por cada campo de `changed_fields` el `old → new`; snapshot de contacto; fecha.
- Errores con `getErrorMessage`. Manejar `invalid_foster_home_status` (409) y `suspension_reason_required`.

- [ ] **Step 2: Typecheck + commit**

```bash
git add frontend/packages/web/src/pages/admin/FosterHomesAdminPage.tsx
git commit -m "feat(web): foster homes admin moderation and forensic viewer"
```

---

## Task 10: Wiring — rutas + navegación

**Files:**
- Modify: `frontend/packages/web/src/App.tsx`
- Modify: `frontend/packages/web/src/layouts/MainLayout.tsx`

- [ ] **Step 1: Rutas en `App.tsx`**

Importar las páginas nuevas. Dentro del bloque `<Route element={<ProtectedRoute />}>` (privado — la sección es privada §10), agregar:
```tsx
            <Route path="/hogares" element={<FosterHomesPage />} />
            <Route path="/hogares/registrar" element={<RegisterFosterHomePage />} />
            <Route path="/hogares/mio" element={<MyFosterHomePage />} />
            <Route path="/hogares/:id" element={<FosterHomeDetailPage />} />
```
Dentro del bloque admin (`<Route path="/admin" element={<AdminLayout />}>`), agregar:
```tsx
              <Route path="foster-homes" element={<FosterHomesAdminPage />} />
```
> **Cuidado orden de rutas React Router:** `/hogares/registrar` y `/hogares/mio` son estáticas y `/hogares/:id` es dinámica. React Router v7 hace match por especificidad (las estáticas ganan a `:id`), pero registrá las estáticas antes para claridad. Verificá que `/hogares/registrar` no matchee `/hogares/:id`.

- [ ] **Step 2: Link de navegación en `MainLayout.tsx`**

Agregar un link "Hogares transitorios" (`t('fosterHomes:nav')`) en la navegación — visible solo para usuarios autenticados (la sección es privada). Mirá cómo `MainLayout` condiciona links por `isAuthenticated` (usa `useAuth`) y replicá. Agregar también el link al panel admin (`/admin/foster-homes`) donde estén los otros links admin (ej. junto a "shelters").

- [ ] **Step 3: Typecheck + commit**

Run: `cd frontend/packages/web && pnpm tsc --noEmit`
```bash
git add frontend/packages/web/src/App.tsx frontend/packages/web/src/layouts/MainLayout.tsx
git commit -m "feat(web): wire foster homes routes and navigation"
```

---

## Task 11: Tests de hooks (lógica real)

**Files:**
- Create: `frontend/packages/shared/hooks/fosterHomes.test.ts`

- [ ] **Step 1: Escribir tests Vitest**

Solo los hooks con lógica propia (no passthroughs triviales — política del proyecto). Testear:
- `useUpdateMyFosterHome` invalida `['fosterHome','mine']` **y** `['fosterHomes']` en onSuccess.
- `useApproveFosterHome`/`useSuspendFosterHome` invalidan `['fosterHomes']` en onSuccess.
- Mockear `apiClient` (mismo patrón que los tests existentes en `hooks/index.test.ts` — revisá cómo mockean `apiClient` y el `QueryClient`).

Patrón (revisá `frontend/packages/shared/hooks/index.test.ts` para el setup exacto de QueryClient + wrapper + mock de apiClient):
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
// ... setup igual que index.test.ts (renderHook + QueryClientProvider wrapper, vi.mock del apiClient)
```

- [ ] **Step 2: Correr los tests**

Run: `cd frontend/packages/web && pnpm vitest run --config vitest.shared.config.ts`
Expected: PASS (regla #14 — los tests de shared corren desde web con esa config).

- [ ] **Step 3: Commit**

```bash
git add frontend/packages/shared/hooks/fosterHomes.test.ts
git commit -m "test(web): foster home hooks invalidation"
```

---

## Task 12: Cierre — build + lint + suite

- [ ] **Step 1: Typecheck + build**

Run: `cd frontend/packages/web && pnpm tsc --noEmit && pnpm build`
Expected: build OK.

- [ ] **Step 2: Suite web + shared**

Run: `cd frontend/packages/web && pnpm test:run`
Expected: PASS (encadena web + shared vía `vitest.shared.config.ts`, regla #14).

- [ ] **Step 3: Verificación manual (dev)**

`pnpm dev` (o `make web`), loguearse, y recorrer: `/hogares` (directorio vacío al principio), registrar hogar (con email verificado), verlo en `/hogares/mio` como pending, aprobarlo desde `/admin/foster-homes`, verlo en el directorio, entrar al detalle, probar contacto/WhatsApp, denunciar (debe fallar self-report en tu propio hogar), suspender desde admin y ver que desaparece del directorio, abrir el visor de logs/history. Revisar la consola por keys i18n crudas (regla #21) y errores de CSP si algo se rompe.

- [ ] **Step 4: PR (Fase 2)**

Skill `searchpet-pr`. Base `main`, rama nueva `feat/foster-homes-web`. Nota en el body: web changed → `pnpm test:run` corrido. Si el backend (Fase 1) aún no está en `main`, marcar el PR como dependiente de #99.

---

## Self-Review (cobertura del spec)

- §10 Directorio privado → Tasks 5, 10 (bajo ProtectedRoute).
- §10 Detalle + galería + contacto (chat + WhatsApp) → Task 6.
- §10 Registro → Task 7. §10 Vista dueño + edición + fotos → Task 8.
- §10 Admin cola + moderación + **visor forense logs/history** → Task 9.
- §7 Contacto (chat in-app + WhatsApp opcional) → Task 6.
- §8 Fotos (subida/borrado, máx 5) → Tasks 2, 3, 8.
- §12 i18n completo es/en/pt + registro en index.ts (regla #21) + error codes → Task 4.
- §18 Sin borrado del hogar en la UI; suspendido congelado → Task 8 (no delete; edición deshabilitada). §19 Denuncia → Task 6.
- Shared foundation (types/client/hooks) → Tasks 1-3.
- Tests → Task 11.

**Gaps deliberados:** Mobile (Fase 3) es plan separado. La visibilidad privada se logra poniendo TODAS las rutas bajo `ProtectedRoute` (Task 10) — no hay landing pública de hogares.

**Riesgo flageado (Task 2):** el helper de upload multipart del client — inspeccionar el patrón real del upload de foto de mascota y replicarlo exactamente (nombre del método, manejo de token/headers). Es el único punto que depende de un detalle no verificado del client.
