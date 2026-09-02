# El perfil público adopta el diseño del perfil propio, y muestra lo publicado

**Fecha:** 2026-09-02
**Estado:** diseño aprobado, sin implementar

> Los números de línea son de `main` al 2026-09-02 (`57f087f`). Van a moverse:
> al implementar, **matchear por el código citado y no por el número**.

## El problema

Dos problemas independientes en la misma pantalla, `/users/:id`
(`web/src/pages/UserProfilePage.tsx`).

### 1. Quedó afuera del rediseño

Es una de las ocho pantallas que nunca se portaron al lenguaje de Stitch. Medido
en el navegador contra la app corriendo (viewport 1280):

| | Perfil propio (`/profile`) | Perfil público (`/users/:id`) |
|---|---|---|
| Contenedor | `max-w-7xl` — 1216px útiles | `max-w-lg` — **512px** |
| Borde izq. del `h1` | x=32, alineado con el logo | **x=505** |
| Estructura | 3 columnas (`lg:grid-cols-3`) | una sola columna centrada |
| Bordes | `border-gray-100 dark:border-gray-800` | `border-gray-200/700` (viejo) |
| Íconos | componente `Icon` | emoji 📍 suelto |
| i18n | completo | **~30 cadenas cableadas en español** |

Viola además la regla #50 de `CLAUDE.md`: toda página de contenido va en
`max-w-7xl`, el mismo cap que el navbar.

Hay un defecto visual concreto de paso: la tarjeta de rating pinta
`{avg_rating > 0 ? avg.toFixed(1) : '—'}` en `text-3xl font-bold`, así que un
usuario sin reseñas muestra **una barra negra suelta** al lado de cinco
estrellas grises.

### 2. No muestra nada de lo que la persona publicó

`GET /api/users/:id/profile` devuelve nombre, ciudad, puntos, contadores, badges
y rating. **Ninguna mascota.** El perfil es la pantalla de confianza del
producto —tiene reseñas, estrellas, badges y botón de denunciar— y no muestra lo
único que la persona realmente hizo.

## La regla de visibilidad

> **Se ve lo que la persona publicó y todavía no cerró.**

| Estado | ¿Lo ve un tercero? | Por qué |
|---|---|---|
| `lost` | ✅ | búsqueda activa, ya pública |
| `stray` | ✅ | ya pública |
| `adoption` | ✅ | ya listada en `/api/adoptions` |
| `found` | ✅ | ya está en `PublicSearchableStatuses` |
| `adopted` | ✅ | fue pública mientras estuvo en `adoption` |
| `registered` | ❌ | **privada** |
| `archived` | ❌ | **privada** — es el interruptor del dueño |

**`registered` es el punto entero de este diseño.** Publicar las mascotas
registradas de alguien es un mapa de qué animales tiene y dónde vive. El código
ya lo dice, en `domain/pet_status.go`:

```go
// registered and archived are private/closed and must NEVER be enumerable
// via ?status=, otherwise anyone could list every user's private pets.
```

Esto cierra ese mismo agujero en una superficie donde nadie lo había mirado.

**`archived` es la salida del dueño.** Quien no quiera que se vea su historia de
éxito o su adopción, archiva. Un solo interruptor, no una preferencia nueva por
estado.

**Sobre `adopted`, que es el único caso nuevo.** Se decidió mostrarlo. Verificado
antes de decidir: la adopción **no transfiere la mascota** — el status machine
sólo permite `adoption ↔ adopted` y `→ archived` (`domain/status_machine.go:11-12`)
y `pet_service.go` no menciona `adopted` ni una vez. No hay traspaso de
`owner_id` ni existe registro del adoptante en todo el sistema, así que no hay
privacidad de un tercero que proteger.

> **Riesgo aceptado a conciencia:** `adopted` hoy **no es enumerable
> públicamente en ningún lado** — no está en `/api/adoptions` ni en
> `PublicSearchableStatuses`. Es el único estado que esta feature vuelve público
> por primera vez. Se acepta porque la mascota ya fue pública con foto y
> descripción mientras estuvo en `adoption`, y marcarla adoptada no vuelve
> privado lo que ya se vio.

## Backend

### El filtro va en SQL. No en el servicio, y menos en React.

Hoy **no existe** ningún endpoint que devuelva las mascotas de otro usuario:
`GET /api/pets/mine` y `GET /api/pets/reported` están atados al JWT del que
llama (`router.go:429-430`).

Filtrar en el frontend no sería una versión más débil de esto: sería **no haber
hecho nada**. La API igual habría mandado las `registered` por el cable y
cualquiera las ve en devtools.

Filtrar en el servicio tampoco alcanza. Existen `FindByOwnerID` y
`FindByReporterID` (`repository/pet_repository.go:85,92`) y **ninguna de las dos
filtra por estado**: reusarlas cargaría las filas privadas a memoria para
descartarlas después. Va un método nuevo con la allowlist en el `WHERE`.

### El método

```go
// FindPublicByUserID devuelve las mascotas de un usuario que un TERCERO puede
// ver: las que publicó y todavía no cerró. La allowlist se aplica en SQL —
// una fila `registered` no debe salir nunca de Postgres.
//
// El OR cubre los dos vínculos: `owner_id` (las suyas) y `reporter_id` (los
// callejeros que reportó sin ser dueña; `owner_id` queda nil en esos casos).
// Va en UNA query y no en dos llamadas concatenadas a propósito: una mascota
// puede matchear los dos lados —quien reporta un callejero y después lo
// adopta— y dos listas pegadas la mostrarían duplicada.
FindPublicByUserID(userID string, statuses []string) ([]domain.Pet, error)
```

### La allowlist

Va en `domain/pet_status.go`, al lado de las otras cuatro, **explícita y no
derivada** — misma convención que las existentes:

```go
// PublicProfileVisibleStatuses son los estados que un tercero ve en el perfil
// público de otra persona (GET /api/users/:id/pets). Excluye `registered` y
// `archived`: son privados, y publicarlos sería un inventario de qué animales
// tiene esa persona. `archived` es además el interruptor con el que el dueño
// baja cualquier publicación de esta vista.
var PublicProfileVisibleStatuses = []string{
    PetStatusLost, PetStatusStray, PetStatusFound,
    PetStatusAdoption, PetStatusAdopted,
}
```

### La ruta

```
GET /api/users/:id/pets   → público, sin auth (igual que /users/:id/profile)
```

Va en el grupo `public` de `router.go:349`, al lado de
`public.GET("/users/:id/profile")`. Responde `200` con la lista (vacía si no
publicó nada) y `404` si el usuario no existe — mismo contrato que el perfil.

Reusa el DTO `PetResponse` que ya devuelve `/api/pets/search`. No inventar uno
nuevo.

> **Lo que ese DTO expone, medido y no supuesto:** `PetResponse` incluye
> `owner: {id, name, phone, is_verified}`, y `GET /api/pets/search` es **público
> y sin auth**. Verificado contra el backend local: una mascota `lost` devuelve
> el teléfono de su dueño a cualquiera, sin sesión.
>
> Es **deliberado y preexistente**: el sentido de publicar una mascota perdida
> es que te puedan llamar. El teléfono del *reporter* de un callejero, en
> cambio, va sólo con opt-in explícito (`ReporterContactPublic`,
> `dto/pet_dto.go:53`). El **email nunca** se expone en este DTO.
>
> Consecuencia para este diseño, y hay que decirla: esta pantalla **no puede
> "proteger" el teléfono**, porque viaja dentro de cada tarjeta de mascota
> perdida. Lo que se decide abajo sobre las filas de contacto es una decisión
> de **superficie**, no de privacidad.

## Frontend

Se reusa la estructura del perfil propio (`ProfilePage.tsx:530+`), no se diseña
nada nuevo.

**Contenedor:** `max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10`, sin banda de
encabezado — el nombre de la persona ya es el encabezado.

**Columna izquierda** (`lg:col-span-1`), tres tarjetas
`rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800`:

1. **Identidad** — avatar `h-28 w-28 ring-4 ring-primary/20` vía
   `cloudinaryThumb(url, 224)`, nombre en `font-display text-headline`,
   "Miembro desde … · Ciudad", pill de Verificado.
   **Sin las filas de contacto.** El motivo real, y no el que parece: el
   **email** sí es privado y no está en ningún DTO público, así que mostrarlo
   sería una fuga nueva. El **teléfono no** — ya viaja dentro de cada tarjeta de
   mascota perdida de esta misma página (ver el recuadro de arriba), así que
   omitirlo de la tarjeta de identidad **no lo protege**: sólo evita presentar
   el número como un dato de la persona en vez de un dato del caso. Ponerlo
   arriba lo convertiría en un directorio de teléfonos indexable por perfil, que
   es una superficie distinta aunque el dato sea el mismo.
   En ese lugar van *Denunciar* y *Bloquear*.
2. **Actividad** — la grilla 2×2 de tiles del perfil propio. Entran justo
   cuatro: Puntos, Reportes, Reunidos, Compartidos.
3. **Logros** — la misma grilla, pero **sólo los conseguidos**. Los bloqueados
   en gris son copy motivacional para el dueño ("Verificá tu identidad"); a un
   desconocido le mostrarían lo que esa persona *no* logró.

**Columna derecha** (`lg:col-span-2`):

1. **Publicaciones** — `lost`, `stray`, `found`.
2. **En adopción** — `adoption`, `adopted`. El corte lo hace `splitOwnedPets`
   de `shared/utils/ownedPetBuckets`, que ya parte exactamente ese balde y hoy
   lo consumen `MyPetsPage` y `ProfilePage`. Tercer consumidor, **una sola
   definición del criterio**.
3. **Reseñas** — el promedio y la lista fusionados en **una** tarjeta (hoy son
   dos), lo que de paso mata la barra negra del rating vacío.

Las dos listas de mascotas van con `ListState` (regla #60), y valen sus dos
invariantes: ramar por `isLoading` y nunca `isPending`; decidir el cartel de
error por `query.data == null` y nunca por `items.length === 0`, porque una
tajada vacía —tiene mascotas pero ninguna en adopción— es una respuesta, no
ignorancia.

**Ojo con lo que vive fuera de la rama envuelta** (el modo de falla conocido de
la primitiva): los contadores de los encabezados y cualquier `.find()` sobre la
lista. Antes de envolver, buscar toda otra referencia a la variable y preguntar
de cada una si *afirma* algo.

## i18n

Las ~30 cadenas cableadas pasan a claves en los **tres** idiomas, con test
propio de claves. Los tests mockean `t: (key) => key`, así que una traducción
faltante se pinta cruda y en silencio y ningún test unitario la ve.

Se registra el namespace en `web/src/i18n/index.ts` en los tres bloques
`es/en/pt` (regla #21): estar en los JSON y no en el config devuelve la clave
literal.

## Verificación

- **Go**: test del repositorio contra Postgres real que siembre una mascota
  `registered` y una `archived` del mismo usuario y exija que **no** vuelvan.
  Los mocks no tienen constraints y este test no puede ser un mock (regla #34).
- **El test que importa es el negativo.** Verificar en rojo: sacar la allowlist
  del `WHERE` y confirmar que el test se pone rojo. Un test que sólo afirma que
  las cinco visibles vuelven pasa igual con el filtro roto.
- **Duplicados**: caso con `owner_id` y `reporter_id` apuntando al mismo usuario
  en la misma fila → tiene que volver **una** vez.
- **Web**: `ListState` en las dos listas, con la query en error y con datos
  cacheados.
- **Navegador**: el borde izquierdo del `h1` tiene que dar **x=32**, igual que
  el logo del navbar. Un desfase de 44px no se ve, se mide.

## Lo que este cambio NO hace

- **No toca mobile.** El perfil público de mobile queda como está.
- **No agrega una preferencia de privacidad por mascota.** El interruptor es
  `archived`, que ya existe.
- **No cambia `/api/users/:id/profile`.** El endpoint nuevo es aparte; fusionar
  las mascotas dentro del perfil obligaría a pagar esa query en toda pantalla
  que hoy lee el perfil, incluido el propio.

## Aparte, encontrado al leer el modelo

El comentario del campo `Status` en `domain/models.go:124` lista
`registered, lost, stray, found, archived` — le faltan `adoption` y `adopted`.
Es un comentario viejo, no un bug, y la fuente de verdad es `pet_status.go`
(regla #13). Se puede corregir de paso; no es parte de este cambio.
