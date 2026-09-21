# Los .md que afirman estado presente dejan de mentir

## Objective

Poner al día los documentos del repo que afirman **cómo son las cosas hoy**,
midiendo cada afirmación contra el código en vez de contra otro documento.

## Problem

El usuario pidió "actualizá todos los .md, no sólo `CLAUDE.md`". Son 81
trackeados, pero **75 son `docs/superpowers/{plans,specs}`**: documentos
fechados que registran qué se decidió ESE día. Esos no se tocan — reescribirlos
borraría el registro de por qué se cambió de opinión, que es justo lo que los
hace útiles. El propio `CLAUDE.md` los trata así ("el spec describe la versión
pública y quedó viejo, es anterior al pivot").

Los que afirman presente son seis, y el peor no era el que el usuario sospechaba:

- **`DEPLOY.md`** manda crear un **PostgreSQL de Render**. La base es **Neon**
  desde el 2026-06-16, y se migró precisamente porque la free de Render **se
  suspende a los 30 días**. Seguir la guía hoy te deja sin base en un mes.
  Además: falta la mitad de las variables de entorno, ofrece Supabase como
  alternativa de una decisión ya tomada, y manda publicar en Play Store / App
  Store cuando el proyecto distribuye el APK directo.
- **`README.md`** no lista cinco rutas que existen, y su roadmap corta en agosto.
- **`backend/GUIDE.md`** enseña `Status: "active"`, un valor que **ya no existe
  en el backend** (`rg "'active'" internal/` da cero). Su propia nota de
  vigencia también miente: dice cinco estados y son siete.
- **`odd/tasks/*.md`** (2) terminan en "Next step: mergear" y están mergeados.

## Why

Un documento que afirma algo falso es peor que no tenerlo: se lee con la misma
confianza que uno correcto. `DEPLOY.md` es el caso agudo porque es el que sigue
alguien que **no conoce el proyecto** y no tiene con qué contrastar.

## Scope autorizado

Los seis que afirman presente, más `CLAUDE.md`. **NO** se tocan los 75 de
`docs/superpowers/` — son historia, no estado.

## Tareas

- [x] **T1** — `DEPLOY.md`: Neon (con el formato exacto del `DATABASE_URL` y por
      qué), las 8 variables que faltaban, el modelo de cobro por tiempo
      despierto, los dos endpoints de salud, el APK por GitHub Actions y no por
      las stores, y la tabla de costos con los límites reales.
- [x] **T2** — `README.md`: las 5 rutas faltantes (`/health/ready`,
      `/api/ops/quota`, `GET /api/users/:id/pets`, `PATCH /api/auth/me/location`,
      `POST /api/admin/vets/import`), la semántica nueva de `/api/alerts`
      (pausar ≠ borrar) y 8 items de roadmap.
- [x] **T3** — `backend/GUIDE.md`: nota de vigencia reescrita (decía 5 estados,
      son 7, y apuntaba a `models.go` en vez de `pet_status.go`) y las **10
      ocurrencias** de `'active'` a `domain.PetStatusRegistered`. Verificado:
      `rg "'active'|\"active\"" GUIDE.md` sale vacío.
- [x] **T4** — Los dos `odd/tasks/*.md` cerrados con su squash y su evidencia.
- [x] **T5** — `CLAUDE.md`: la sección de pendientes.

## Lo que encontró el barrido, y no era lo que se buscaba

De los **cinco** pendientes que `CLAUDE.md` listaba, **cuatro ya estaban
hechos** — y uno de ellos nombraba dos archivos (`ReviewCard.tsx`,
`BadgeCard.tsx`) que **ya no existen**. Casi escribo "hoy lo cuida tal test" sin
comprobar que el test cubriera esos componentes; al verificarlo aparecieron las
dos cosas: los archivos no están, y el guard real
(`utils/dateLocaleCoverage.test.ts`) es **más fuerte** que lo que la deuda
pedía, porque barre todo el paquete con `import.meta.glob` en vez de arreglar
dos archivos.

**El nombre de un archivo dentro de una lista de deuda no prueba que el archivo
exista.**

## Fuera de alcance, verificado y anotado

- `docs/github-secrets.md` y `backend/cmd/seed/README.md`: **leídos enteros y
  están al día**. No se tocan.
- `internal/domain/models.go:125` tiene un comentario stale en el campo `Status`
  (lista 5 estados, son 7). Es un `.go`, fuera del pedido — se reporta.

## Criterio de aceptación

Cada afirmación nueva verificada contra su fuente (`router.go`,
`postgres.go`, `pet_status.go`, el historial de git), nunca contra otro `.md`.

## Verificación aplicable

Documentación pasiva: no hay tests que correr. El chequeo es leer la fuente
citada. Donde el doc afirme una ruta, tiene que existir en `router.go`.
