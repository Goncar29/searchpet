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

- [ ] **T1 — El alta elige la zona sobre el mapa.** Componente
  `components/alerts/AlertZonePicker.tsx` (marcador arrastrable + `<Circle>`
  atado al radio elegido + recentrado). Se monta dentro del `<fieldset>` de
  coordenadas, encima de los dos inputs, que siguen editables y sincronizados en
  los dos sentidos. Claves i18n nuevas en los tres locales.
  - Checks: `pnpm vitest run src/pages/AlertsPage.test.tsx src/components/alerts`
    y `pnpm build`. Los cuatro tests de coordenadas del #253 tienen que seguir
    verdes SIN tocarlos — si hay que editarlos, la vía accesible se rompió.
- [ ] **T2 — La lista se lee en un mapa y en tarjetas.** Mapa de resumen con el
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

- Nada empezado todavía.

## Next step

T1.
