# Mis alertas: la zona se elige y se lee en un mapa

## Objective

Rebanada 2 del rediseño de `/alerts`. Hoy una alerta se crea tipeando dos
`<input type="number">` y se lee como `-34.901, -56.164 · 5 km`. Nadie lee
coordenadas. La pantalla tiene lat/lng/radio de cada alerta: son datos
suficientes para dibujar la zona, y no se dibuja en ningún lado.

## Problem

- **Alta**: la ubicación se ingresa a mano. El único atajo es "usar mi
  ubicación", que sirve para el barrio propio y para nada más — vigilar la casa
  de un familiar obliga a conseguir las coordenadas por fuera de la app.
- **Lectura**: la tarjeta muestra el par de coordenadas con tres decimales. No
  permite reconocer la zona ni comparar dos alertas entre sí.
- **Radio**: se elige entre 1 y 25 km sin ninguna referencia de cuánto es eso
  sobre el terreno.

## Why

Salió de mirar el diseño de Stitch *"Alertas Comunitarias - PawFinder"*
(`projects/16519613178896842350/screens/137b18a0752246b3a42780f076eaaaed`),
generado al lado del texto extraído de `searchpet.vercel.app/alerts`.

**El diseño NO se porta como está**, y el motivo es el de siempre (ver las
convenciones en los cuerpos de commit de #162, #164 y #173): inventa conceptos
que el modelo no tiene. Se descartan:

| Lo que dibuja Stitch | Por qué no va |
|---|---|
| "ZONA CRÍTICA · ALTA PRIORIDAD", "VIGILANCIA COMUNITARIA ACTIVA" | `LocationAlert` no tiene prioridad ni estado comunitario |
| "Epicentro: Rambla Gandhi & 21 de Setiembre" | no hay geocodificación inversa, y agregarla cuesta plata o cuota |
| "~2.400 vecinos y 6 refugios" | no existe |
| Contadores por especie, filtros, buscador | el tope son 10 alertas |
| "Cargar más" / "Mostrando 5 de 34" | ídem: no hay paginación que hacer |
| "Vigilar Zona" / "Ver Perímetro" | no son acciones de este recurso |
| El marco entero: *alertas comunitarias* | `/alerts` es **privada**: son TUS alertas. Portar ese encabezado sería mentir sobre lo que la pantalla hace |

Lo que sí se toma es lo que ya es dato real: **el mapa**, **el marcador
arrastrable con el círculo del radio**, y **las tarjetas en grilla con el
estado como pill**.

## Scope

Autorizado: `frontend/packages/web/src/pages/AlertsPage.tsx`, componentes
nuevos bajo `src/components/alerts/`, los tres locales web, y sus tests.

**Fuera de alcance**: el backend (no se toca: el modelo ya alcanza), mobile, y
cualquier concepto de la tabla de arriba.

## Constraints

- **Los inputs de latitud y longitud SE QUEDAN.** Un mapa que sólo se arrastra
  no tiene camino de teclado ni de lector de pantalla, y el #253 acaba de darle
  a esos dos campos su etiqueta visible y su contrato de error
  (`AlertsPage.test.tsx`, cuatro tests). El mapa es la vía visual; los campos
  son la vía accesible; los dos escriben el mismo estado.
- Leaflet + OpenStreetMap, que ya son dependencia (`MapPage`, `LocationStep`).
  Ningún proveedor nuevo: regla #1.
- **Un solo mapa de resumen**, no un mini-mapa por tarjeta: diez tarjetas serían
  diez juegos de tiles contra la política de uso de OSM, para mostrar diez veces
  la misma ciudad.
- i18n en es/en/pt con las claves declaradas en el namespace `alerts`.
- Sale sobre `refactor/alertas-banda-y-contenedor` (#253, abierto), no sobre
  `main`: el #253 es el que trae la banda y el contenedor de esta pantalla.

## Delivery

Estrategia: `ask-on-risk`. Dos PRs encadenados, uno por tarea.

## TDD

Modo no configurado en el proyecto. Se aplica la práctica que documentan las
memorias del repo: **el arreglo se ve en rojo antes de confiar en el verde**,
revirtiendo cada cambio por separado. Runner: `pnpm vitest` desde
`frontend/packages/web`.

## Tasks

- [x] **T1 — El alta elige la zona sobre el mapa.** ✅ `16ec7720` Componente
  `components/alerts/AlertZonePicker.tsx` (marcador arrastrable + `<Circle>`
  atado al radio elegido + recentrado). Se monta dentro del `<fieldset>` de
  coordenadas, encima de los dos inputs, que siguen editables y sincronizados en
  los dos sentidos. Claves i18n nuevas en los tres locales.
  - Checks: `pnpm vitest run src/pages/AlertsPage.test.tsx src/components/alerts`
    y `pnpm build`. Los cuatro tests de coordenadas del #253 tienen que seguir
    verdes SIN tocarlos — si hay que editarlos, la vía accesible se rompió.
- [x] **T2 — La lista se lee en un mapa y en tarjetas.** ✅ `d275ad04` Mapa de resumen con el
  círculo de cada alerta (activa y pausada distinguibles por algo que no sea
  sólo el color), tarjetas en grilla con pill de estado, badge de radio y tipo,
  y el vacío con el lenguaje de las públicas.
  - Checks: los mismos, más el guard del ancho del #253.

## Acceptance

- Crear una alerta sin tipear una sola coordenada.
- Mover el marcador cambia los dos inputs, y editar un input mueve el marcador.
- Cambiar el radio cambia el círculo en el acto.
- Con la consulta caída la pantalla sigue sin afirmar un conteo ni un "no tenés
  alertas" (lo que ya protege `ListState` y los tests del #253).
- Cero claves i18n crudas en pantalla, en los tres idiomas.

## Progress

### T1 — hecho, commit `16ec7720`

Evidencia observada, no afirmada:

- `pnpm test:run` → **EXIT 0**, 981 web + 317 shared.
- `pnpm build` → **EXIT 0**. Cazó un error que los tests no veían: el mock de
  `getBounds` infería el literal `true` y el caso contrario no compilaba.
- **Los seis guards vistos en rojo por separado**, revirtiendo un cambio cada
  vez: la conversión km→m, el anti-salto de la cámara, el marcador ausente sin
  punto elegido, el click sobre el mapa, el `dragend`, y el picker montado en la
  página.
- Los cuatro tests de coordenadas del #253 siguen verdes **sin tocarles una
  aserción**. Lo único que se agregó a ese archivo es un test nuevo.

Riesgo del candidato (`gentle-ai review assess`, `--base-ref d72ddeb6
--committed-only`): **medium**, 8 archivos / 498 líneas. Por el protocolo el
candidato es la rebanada, y con 498 líneas la rebanada se cierra acá.

**Lo que los tests NO pueden ver**: que el mapa se vea bien. jsdom no pinta
tiles ni mide posiciones. Falta pasarlo por el navegador antes de congelar el
candidato para la revisión — la normalización que muta fuente va ANTES del
freeze.

### El pendiente de T1: MEDIDO, y no era un problema

El control de radio quedó **fuera** del `<fieldset>` de coordenadas, o sea
debajo del mapa pero en otro bloque. Se anotó la sospecha de que en un teléfono
eso dejara el círculo fuera de pantalla al cambiar el radio, sin que el usuario
viera la reacción, y se difirió a T2.

**Medido en el navegador, y la sospecha no se cumple.** El layout entra: el mapa
mide 286px, la separación hasta el control de radio es 349px, o sea **635px**
contra los **667px** del viewport más chico que se probó. Con el control de
radio pegado al borde de abajo se ven **286/286px del mapa** y 200px del círculo
de 25 km —el más grande— en los tres teléfonos:

| Viewport | Del mapa se ve | Del círculo | Radio en pantalla |
|---|---|---|---|
| iPhone 14 Pro Max (430×932) | 286/286 px | 200 px | sí |
| iPhone SE / Android chico (375×667) | 286/286 px | 200 px | sí |
| Galaxy S8 angosto (360×740) | 286/286 px | 200 px | sí |

**No se toca nada**, y así se evita el cambio que el propio pendiente advertía
que era caro: anidar `<fieldset>`s y renombrar la leyenda "Coordenadas", que
además rompía un test del #253.

**La medición correcta no es dónde quedan las cosas tras un scroll cualquiera,
sino si EXISTE un scroll que las muestre juntas.** La primera aserción usaba
`scrollIntoViewIfNeeded` sobre el radio, que lo pega arriba y saca el mapa del
viewport: daba "0/286px visibles" y **confirmaba el pendiente por construcción**.
Eso mide el scroll, no el layout.

### T2 — hecho, commit `d275ad04` (rama `feat/alertas-lista-y-mapa`)

`AlertsMap` (un mapa, todos los círculos) + tarjetas en grilla con pill de
estado, badges de radio y tipo, y las coordenadas convertidas en el botón que
lleva el mapa a esa zona.

Evidencia observada:

- `pnpm test:run` → **EXIT 0**, 990 web + 317 shared. `pnpm build` → **EXIT 0**.
- **Ocho guards vistos en rojo por separado** entre componente y página: el
  punteado de la pausada, el encuadre del conjunto, el encuadre al enfocar, la
  conversión km→m, el `role="switch"`, el enfoque de la tarjeta tocada, el mapa
  recibiendo las alertas, y —el que más importa— **el mapa dibujándose sobre la
  consulta caída**.

Riesgo del candidato (`--base-ref db2cb437 --committed-only`): **medium**, 7
archivos / 464 líneas. Es su propia rebanada.

### Las cuatro revisiones nativas

Fueron **cuatro**, no dos: cada commit nuevo reabre el candidato (ver el bloque
"Ojo con el ciclo de revisiones" más abajo). Las dos primeras están detalladas
acá; las otras dos, resumidas al final de esta sección.

**Y las cuatro fueron LA MISMA LENTE**, `review-reliability` — se reconoce en el
prefijo de sus hallazgos, todos `R3-*`. Nunca corrió `risk` (R1), `readability`
(R2) ni `resilience` (R4). Cuatro pasadas de la misma pregunta no son cuatro
revisiones, y por eso el `/code-review` sigue teniendo algo que aportar.

**`review-37f7f2e88298a8e9`** (lente `review-reliability`, `medium`) → `approved`,
`authority: burned`. Tres `SUGGESTION`, y **una era un defecto de verdad**:

> El efecto que encuadra el círculo dependía de `[map, radiusKm]`, así que en la
> transición `null → primer punto` no volvía a correr. Y el otro efecto tampoco
> hacía nada, **porque un click cae siempre DENTRO de la vista**. El primer
> círculo se dibujaba sin que la cámara lo mirara nunca.

Arreglado en `3fded060` dependiendo del BOOLEANO `elegido`. **La forma del
defecto es lo que hay que recordar: dos guards correctos por separado dejaban
un hueco exactamente en su intersección**, y ninguno de los catorce chequeos en
rojo podía verlo, porque cada uno probaba su propio efecto.

Los otros dos: el `focused` que queda apuntando a una alerta borrada pasó a ser
un test (*"no rompe por construcción" es un razonamiento, no una prueba*), y el
`ids.join(',')` se descartó — los ids son UUID, no pueden traer comas, y un
reordenamiento sólo produce un reencuadre de más.

**`review-f45bc4d2098ee39e`** (misma lente, `medium`) → `approved`,
`authority: burned`. Dos `WARNING` advisory, **ninguno accionable**, cada uno
verificado contra el código antes de descartarlo:

- **R3-001** — `radiusKm` sin guarda contra `0`, negativo o `NaN`. **No es
  alcanzable**: el estado es `RadiusKm`, la unión de los cinco literales de
  `RADIUS_OPTIONS`, y el único que lo escribe es el `onToggle` de
  `FormChoiceGroup`, que TypeScript restringe a esos valores. Se deja como está.
- **R3-002** — las aserciones de `index.css.test.ts` dependen de `index.css`,
  que no está en el manifiesto del candidato. Es cierto, y es una limitación de
  VISIBILIDAD de la revisión, no un defecto: ese archivo viene del #253
  (`1147d54b`) y el test lo lee de verdad en cada corrida.

**`review-fd0716c3b74f99a8`** (misma lente) → `approved`, `authority: burned`.
Un `SUGGESTION` sobre `AlertsMap.tsx:30-51`: la clave de la cámara
(`ids.join(',')`) no incluye la geografía, así que mover una alerta sin cambiar
el conjunto de ids no reencuadra. **No se arregló, a propósito**: hoy nada edita
la zona de una alerta existente, y el propio bloque de hallazgos lo marcó como
trabajo posterior.

**`review-5776bb2d3f0fb7f4`** (misma lente) → `approved`, `authority: burned`.
Un `WARNING` R3-1: *"las coordenadas de una alerta no las acota nadie, ni el
front ni el backend"*, citando `internal/dto/location_alert_dto.go:13-14`.

> **La mitad del backend de ese hallazgo es FALSA**, verificada contra el código:
> `internal/service/location_alert_service.go:242-250` define
> `validateAlertCoords` (−90..90 y −180..180) y se la llama en `Create` (121) y
> en las **dos** ramas de `Update` (193 y 199); `validateRadiusKm:252` acota
> 1..`domain.MaxAlertRadiusKm`.
>
> Lo cierto es más chico: la validación no está en el **DTO**, está en el
> servicio — que es donde la pone esta arquitectura. La lente miró el archivo
> donde ESPERABA encontrarla y concluyó ausencia sin mirar la capa de al lado.
> **Una ausencia observada en un archivo no es una ausencia en el sistema**:
> antes de aceptar un "nadie valida X", buscá el predicado por NOMBRE en todo el
> paquete.

### Ojo con el ciclo de revisiones en esta pila

El `--base-ref` que elige el preflight es la punta de `main`, así que **cada
commit nuevo en estas ramas vuelve a proponer el stack entero** como candidato
`medium` — incluidos los cuatro commits del #253. No es un error: es
consecuencia de trabajar stackeado sobre una rama sin mergear. Hasta que el
#253 entre, esperá que cada commit pida consentimiento otra vez.

## Estado de las ramas

```
refactor/alertas-banda-y-contenedor   #253, abierto  ← no se tocó
  └── feat/alertas-mapa-zona          T1  16ec7720 + db2cb437
        └── feat/alertas-lista-y-mapa T2  d275ad04 + 8f594934
                                      fix 3fded060 (hallazgo de la revisión)
```

## La verificación en el navegador — hecha, 41/41

Sonda de Playwright contra `pnpm dev`, **41 aserciones, dos corridas seguidas en
verde** (`EXIT=0` las dos). Cubre lo que jsdom no puede ver:

- **Los tiles de OSM se pintan de verdad** (8/8 cargadas) en los dos mapas, y el
  pin de `raw.githubusercontent.com` carga. Los tres orígenes están en el
  `img-src` de `vercel.json` — verificado leyendo la CSP, no supuesto.
- **El arreglo de `59d8ca58` anda por los TRES caminos que escriben coordenadas**:
  tocar el mapa (`-34.902123`), arrastrar el pin (`-34.927601`) y "Usar mi
  ubicación" alimentado con `-34.899025460930744` → `-34.899025`. Los tres a 6
  decimales. Este arreglo **nació de un `/verify` y nunca había vuelto al
  navegador**: una verificación que termina en un cambio de código no verifica el
  código que dejó.
- Sin punto elegido no hay marcador ni círculo, y la pista se va al elegir.
- Tipear una coordenada lejana trae la cámara al punto; cambiar el radio
  reencuadra sin que el círculo se salga.
- El submit sin coordenadas marca `aria-invalid` y `aria-describedby` en los
  **dos** inputs contra un único `role="alert"`.
- En el resumen: un círculo por alerta, la pausada con `stroke-dasharray="6 6"`,
  las tres zonas dentro del encuadre inicial, y enfocar una la acerca (80px →
  638px de ancho).
- Con la consulta caída: **cero mapas dibujados**, el título dice "Mis alertas"
  sin conteo, y no aparece "Sin alertas".
- **Cero claves i18n crudas en es, en y pt**, afirmando las cadenas EXACTAS de
  cada locale (incluidas las comillas: `«Mi barrio»` en es, `"Mi barrio"` en
  en/pt).

**No encontró un solo defecto de la app.** Los dos fallos que reportó eran
defectos de la sonda, cada uno verificado antes de reportarlo: un click que
flaqueó una vez (refutado con dos corridas de debug independientes) y la
medición del pendiente de T1 que confirmaba su propia hipótesis (ver arriba).

## Next step

1. `/code-review` sobre la pila. Las cuatro revisiones nativas fueron **todas la
   misma lente** (`review-reliability` — sus hallazgos salen numerados `R3-*`):
   nunca corrió `risk`, `readability` ni `resilience`.
2. `/security-review` **no va**, y el motivo está medido: 12 archivos, todos
   `frontend/packages/web`; cero `href`, `dangerouslySetInnerHTML`, `innerHTML`,
   `fetch`, `eval` o `localStorage` en `components/alerts/`; ningún origen nuevo
   para la CSP; y nada que toque auth ni endpoints.
3. Abrir los dos PRs encadenados. El merge lo decide el usuario, y el #253 va
   primero.
