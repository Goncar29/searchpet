# Antes de publicar un callejero, preguntamos si no es uno que ya está

**Fecha:** 2026-09-05
**Estado:** diseño aprobado, sin implementar
**Issue:** #221
**Rama:** `feat/stray-duplicate-candidates`

> Los números de línea son de `main` al 2026-09-05 (`e523599`). Van a moverse: al
> implementar, **matchear por el código citado y no por el número**.

## El problema

El issue #221 lo plantea así: desde el #220, un avistamiento de callejero que
nadie vuelve a ver en 90 días sale del feed, del mapa y del perfil público, pero
la mascota sigue viva y un reporte nuevo la revive — sólo que **no hay cómo
llegar a ella para hacer ese reporte**. Quien vuelve a ver al mismo animal
termina publicándolo de nuevo, y quedan dos fichas del mismo perro con el
historial partido.

### Lo que se midió, y corrige la premisa

Antes de diseñar nada se midió por dónde se llega hoy. Tres de los cuatro
hallazgos contradicen o acotan el planteo del issue:

1. **`GET /api/pets/:id` no filtra vencidos** (`pet_handler.go:78` → `GetPetByID`,
   sin ningún scope de caducidad). La ficha existe y responde 200. **El problema
   es de descubrimiento, no de acceso.**

2. **El reportante original SÍ llega hoy.** `/api/pets/reported` va por
   `FindByReporterID` (`pet_repository.go:93`), que es `WHERE reporter_id = ?` a
   secas, **sin filtro de caducidad**, y lo consumen "Mis mascotas" en web y en
   mobile. El "no hay cómo llegar a su ficha" del issue vale para un tercero, no
   para quien lo reportó.

3. **La web ya expone la escotilla, sin rótulo.** `HomePage.tsx:324` manda
   `from: startOfDayISO(filterFrom)` desde el input "Desde" del filtro, y la
   escotilla es exactamente `filters.From == nil` (`pet_repository.go:295`). O
   sea que la mecánica del cruce histórico ya está en la portada; lo que no hay
   es forma de descubrirla como tal, ni señal de que esas tarjetas están
   vencidas.

4. **La búsqueda por imagen ya devuelve los vencidos.** `FindSimilar` filtra sólo
   `WHERE p.status IN ('lost', 'stray')` (`pet_embedding_repository.go:79`) y no
   aplica `straySightingNotExpired`.

### El problema real, entonces

**Un tercero que ve al animal no tiene cómo caer en la ficha existente.** No es
que no pueda abrirla: es que no sabe que existe, y no hay nada en su camino que
se lo diga. Y ese camino no es la búsqueda — es **publicar**. El tercero no
busca un avistamiento viejo: viene a dar de alta uno nuevo.

De ahí sale la decisión de fondo: la afordancia no va en la búsqueda, va en el
alta.

### Y la clase es más ancha que el issue

Publicar un duplicado sobre un avistamiento **vivo** produce exactamente el mismo
daño —dos fichas del mismo perro, historial partido— y hoy tampoco lo previene
nada. El #221 destapa el hueco en los vencidos porque la caducidad lo volvió
inevitable, pero el caso más frecuente es el otro, simplemente porque la mayoría
de los avistamientos no están vencidos. **El paso cubre los dos** (decisión del
usuario, 2026-09-05).

## La solución

Un paso nuevo en el wizard de publicar: antes de crear el callejero, le
mostramos los avistamientos cercanos —vencidos y vivos— y le preguntamos si no
es alguno de esos.

```
Publicar callejero
  → formulario (tipo, foto, descripción)
  → ubicación
  → [login, si no tiene sesión]
  → [NUEVO] "¿No es alguno de estos?"
        ┌──────────────────────────────┐
        │ [foto]  Perro · a 300 m      │
        │ visto por última vez         │
        │ hace 4 meses                 │
        │              [ Es este ]     │
        └──────────────────────────────┘
        [ Ninguno, es otro animal ]
  → alta
```

### Dónde va el paso, y por qué ahí

Va **después** del paso `auth` y antes del alta, en `handlePublish`
(`PublishWizardPage.tsx:331`), que es el primer punto donde tenemos las tres
cosas que hacen falta: `location` (lat/lng), `wizard.strayForm.type` y una
sesión. No hay que pedirle al usuario ni un dato más.

Después de `auth` y no antes por dos motivos: reportar exige cuenta igual, así
que adelantarlo no le ahorra el login a nadie; y con la sesión ya resuelta el
endpoint puede ser protegido, sin agregar superficie pública nueva.

**El paso vive en la URL** (`?paso=candidatos`), como los otros cinco. La regla
#52 se pagó cara: el paso en `useState` fue lo que convirtió el wizard en una
trampa. Y como todo paso alcanzable por URL, necesita su guarda de precondición
en la derivación —igual que `location` exige `wizard.strayForm.type`
(`PublishWizardPage.tsx:123`)— porque un F5 en `?paso=candidatos` sin ubicación
en memoria no tiene nada que consultar. Esa guarda es el hallazgo (a) de la regla
#52 y es la que siempre falta.

### El endpoint: uno nuevo, no un flag sobre `/reports/nearby`

```
GET /api/pets/stray-candidates?lat=&lng=&radius=&type=   (protegido)
```

Devuelve los callejeros cercanos **sin aplicar `straySightingNotExpired`**, con
su `last_reported_at`, su distancia y su foto principal.

**No aplicar la caducidad es parte de su contrato, no un parámetro.** Es el mismo
criterio que `FindPublicByUserID` con su allowlist y que `straySightingNotExpired`
con su plazo (regla #40): un invariante configurable es peor que ninguno, porque
la firma promete algo que cualquier llamador puede romper.

Y es endpoint nuevo en vez de un `include_expired=true` sobre `/reports/nearby`
por el defecto que ya levantó la revisión del #220: una perilla que apaga la
protección, colgada de un endpoint que consumen el mapa y la portada, es
alcanzable desde la superficie misma que la protección existe para cuidar. Un
endpoint con un solo llamador y un solo propósito no tiene esa forma, y su nombre
dice lo que hace.

**Radio: 1 km** (decisión del usuario). Un callejero se mueve de a cuadras. Cae
justo en el piso del bound que ya usan `/reports/nearby` y la búsqueda con geo
(1000–50000 m), así que no hay que ampliar ningún rango existente.

**Acotado por `type`.** Un gato no es candidato de un perro.

### Revivir no necesita código nuevo

Al tocar "es este" se crea un reporte sobre la ficha existente con
`POST /api/reports`, que ya estampa `last_reported_at` y devuelve la mascota a
las tres superficies sola. El #225 (`e523599`) ya hizo que reportar aterrice en
la ficha, así que el destino existe. **Cero backend nuevo en esa rama** — el
mecanismo de revival ya estaba, lo que faltaba era la puerta.

### Qué dice la tarjeta de candidato

**No dice "vencido".** Dice **"visto por última vez hace 4 meses"**, con foto,
tipo y distancia.

Tres motivos: "vencido" es jerga nuestra y no significa nada para quien lo lee;
sugiere que el animal ya no está, que es exactamente lo que no sabemos; y la
fecha es el dato que la persona necesita para decidir si es el mismo perro. Esto
responde la pregunta 2 del issue sin tener que redactar un eufemismo.

Corolario: **el paso no distingue visualmente vencidos de vivos.** No hace falta
—la fecha ya ordena la lista y comunica la antigüedad— y hacerlo expondría un
concepto interno que el usuario no tiene por qué aprender.

### El paso no bloquea nunca

Es un asistente, no una compuerta. Un fallo del endpoint no puede impedir que
alguien publique un animal que está en la calle **ahora**.

- **Cero candidatos** → el paso no se muestra, se sigue derecho al alta.
- **El endpoint falla** → el paso **sí se muestra**, con el cartel de error y un
  botón "Publicar igual".

Esa segunda rama es deliberada y es lo contrario de lo intuitivo. Saltear en
silencio ante un error pintaría "no hay candidatos" cuando en realidad **no
pudimos preguntar** — la regla #60 exacta — y acá el precio de esa mentira es el
duplicado que la feature viene a evitar. Va con `ListState`
(`web/src/components/list/ListState.tsx`), y la guarda del cartel es
`query.data == null` y no `items.length === 0`.

## Alcance de esta tanda

**Backend + web.** Mobile queda para una tanda posterior, anotado en el issue.

Dos PRs stackeados (la skill `searchpet-pr` recomienda stackear arriba de 400
líneas, y las dos plataformas juntas se pasan seguro):

1. **El endpoint** con sus tests contra Postgres real. Sin consumidor todavía.
2. **El paso en el wizard web**, que lo consume.

**Riesgo conocido y aceptado:** hasta que se haga mobile, las dos plataformas
divergen — en mobile se sigue pudiendo publicar el duplicado sin aviso. Va
anotado en el issue #221, que queda abierto hasta que mobile esté.

## Testing

### Backend — las dos mitades, o no prueba nada

El test contra Postgres real afirma que el endpoint **sí** devuelve un stray
vencido. Pero sólo con eso, un cambio que apagara la caducidad **entera** pasaría
verde: el endpoint seguiría devolviéndolo, y también lo haría el feed.

Así que el mismo test afirma la otra mitad: **con la misma mascota sembrada, el
feed la sigue escondiendo**. Lo que se prueba es el **desacuerdo** entre las dos
consultas, no cada una por separado. Es la lección del #157: cuando dos consultas
tienen que ver conjuntos distintos, se testea la diferencia.

Casos:

- Un stray con `last_reported_at` de hace 120 días, a 300 m → **aparece** en
  candidatos, **no aparece** en el feed.
- Un stray con `last_reported_at` de ayer, a 300 m → aparece en los dos.
- Un stray a 5 km → no aparece en candidatos (el radio corta).
- Un gato cuando se pide `type=dog` → no aparece.
- Una mascota `lost` (con dueño) → **no aparece**: no es un avistamiento de
  callejero y ofrecerla como candidato invitaría a reportar sobre la búsqueda de
  otra persona.

### Web

- El endpoint falla → el paso se muestra con el cartel de error, **no** con
  "ningún candidato", y "Publicar igual" funciona.
- Cero candidatos → el paso no se monta y el alta sigue.
- Un F5 en `?paso=candidatos` sin ubicación en memoria → cae a `intent`, no a un
  paso que no puede consultar nada.
- "Es este" navega a la ficha existente y **no** crea una mascota nueva.

## Lo que este diseño NO hace

- **No toca la caducidad.** `straySightingNotExpired` y el plazo de 90 días
  quedan exactamente como están.
- **No agrega un filtro "incluir vencidos" a la búsqueda.** Se evaluó y se
  descartó: resuelve sólo al que ya sospecha que hay una ficha vieja, y el
  tercero por definición no lo sabe.
- **No usa la búsqueda por imagen** para elegir candidatos, aunque ya devuelve
  los vencidos. La cercanía es determinista, no depende de Jina (que se cayó dos
  veces, regla #18) y CLIP no distingue bien dos perros marrones parecidos: un
  falso positivo acá hace que alguien reporte sobre el animal equivocado y ensucie
  dos historiales. La foto puede sumarse después como reordenamiento, sin rehacer
  nada de esto.
- **No señaliza el vencimiento en "Mis mascotas".** El reportante original ve su
  avistamiento vencido igual que uno vivo, sin saber que caducó. Es un hueco
  real, es de otro sujeto, y queda anotado en el issue.

## Límite conocido: un stray sin reportes es invisible para esto

`domain.Pet` **no tiene coordenadas** — sólo `City`, texto libre
(`models.go:111`). Las lat/lng viven en `reports`, así que toda consulta
geográfica del proyecto pasa por `JOIN reports`, y la de candidatos también.

**Consecuencia: un callejero sin ninguna fila en `reports` no lo devuelve este
paso.** Tampoco lo devuelve el cruce histórico, por antiguo que sea el `from`,
por el mismo JOIN. Un animal así es hoy inalcanzable por cualquier vía que no
sea su link directo o la lista del reportante.

Hoy no debería poder crearse uno: `pet_service.go:111` exige `initial_report`
para dar de alta un stray. Podrían existir filas anteriores a esa regla.

**No se pudo medir contra producción** — la red externa de la máquina estaba
caída el 2026-09-05 (fallaron `curl` y `WebFetch` contra
`searchpet.onrender.com`). La consulta que lo resuelve:

```sql
SELECT count(*) FROM pets p
WHERE p.status = 'stray'
  AND NOT EXISTS (SELECT 1 FROM reports r WHERE r.pet_id = p.id);
```

Si da cero, este límite es teórico y no hay nada que hacer. Si da distinto de
cero, esas filas necesitan su propia decisión y **no la resuelve este diseño**.
Medirlo antes de cerrar el #221.

## Contexto

- #218 — el issue que originó la caducidad
- #219 `8da7f0f` — el reloj de última vista
- #220 `da5f333` — el filtro, en producción desde el 2026-09-04
- #225 `e523599` — reportar un avistamiento vuelve a la ficha
- Reglas de `CLAUDE.md`: #13 (allowlists), #18 (Jina), #40 (invariante no
  configurable), #52 (estado en la URL), #60 (`ListState`)
