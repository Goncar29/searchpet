# APK 1.2.0 findings + update notice

Objective: fix what the user found testing APK 1.2.0, plus the unread-dot a11y text and an in-app update notice.
Branch: one `fix/…`/`feat/…` branch per task off `origin/main`. Delivery: one PR per task. Runner: mobile `pnpm test:run` (jest), web `pnpm test:run` (vitest).

## Specs

- **S1** Logged-out Profile and Messages tabs in dark mode: "sin iniciar sesion en la seccion de perfil los colores quedaron mal, puede que se este mezclando el darkmode, teniendo en cuenta que el dark mode esta activado por defecto en mi celular este se ve fondo blanco y el texto casi no se ve por colores muy claros, lo mismo pasa en la de mensajes, si inicio sesion ese problema se va"
- **S2** Chat ⋮ menu: "me gustaria que el cuadro con las opciones se vea igual que el cuadro de opciones de idioma, parece solo un alert con opciones sin diseño, apliquemos algo como el pop up que hicimos en leaderboard". Found while checking: on Android the Alert shows at most three buttons, so with Cancel + Ver perfil + Bloquear + Denunciar the user only sees "bloquear usuario, ver perfil y cancelar" — Denunciar is unreachable.
- **S3** Logout confirmation: "mismo tipo de cuadro aparece cuando quiero cerrar sesion me gustaria, cambiarlo tambien"
- **S4** The unread dot has no text for screen readers (web `MessagesShell.tsx`, mobile `(tabs)/messages.tsx`).
- **S5** In-app update notice in mobile: the app compares its version with the latest GitHub release and, when newer, shows a notice with a button that opens the APK download. No silent install. Network failure shows nothing.
- **S6** (OPEN, needs the user's decision) "en la lista de usuario con las que tuve conversaciones los tres puntos no aparecen": mobile has no "Marcar como no leída" nor "Borrar conversación" at all (`useMarkConversationUnread` / `useHideConversation` are unused in mobile), so #353 cannot be tested from the APK.

## Tasks

| ID | Specs | Route | Status | Commit |
|----|-------|-------|--------|--------|
| T1 | S1 | inline | PR open | fix/mobile-guest-tabs-dark-background |
| T2 | S2 | inline | pending | |
| T3 | S3 | inline | pending | |
| T4 | S4 | inline | pending | |
| T5 | S5 | inline | pending | |
| T6 | S6 | — | waiting on user decision | |

## Log

- **L1** (2026-10-08, user, verbatim): "punto 0, eso ya funcinaba asi / punto 1, no se puede probar ya que no hay reportes ni publicaciones / punto 2, si se ve, me gustaria que el cuadro con las opciones se vea igual que el cuadro de opciones de idioma, parece solo un alert con opciones sin diseño, apliquemos algo como el pop up que hicimos en leaderboard, mismo tipo de cuadro aparece cuando quiero cerrar sesion me gustaria, cambiarlo tambien / punto 3, en la lista de usuario con las que tuve conversaciones los tres puntos no aparecen, solo si entro a la conversacion de un usuario especifico tengo las opciones de tres puntos que es el mismo lugar donde probe el punto 2 y en ese lugar tengo las opciones en este orden: bloquear usuario, ver perfil y cancelar / punto 4, fue lo primero que revise, sin iniciar sesion en la seccion de perfil los colores quedaron mal, ..."
- **L2** (2026-10-08, user): "¿Hago el aviso de actualización en mobile después del texto accesible del punto de no leído?" → "si hazlo".
- **L3** S1 cause: the logged-out branches render `styles.center`, which has no background; the tab scene falls back to react-navigation's light background while the text uses dark-theme colors. Logged in, `styles.container` paints `c.surface`. Fix at the tabs layout (`sceneStyle`), which covers every tab.
- **L4** Download link (#363) done separately before this doc.
