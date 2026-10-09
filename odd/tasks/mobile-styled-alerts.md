# Mobile: styled alerts instead of Alert.alert

Objective: every native `Alert.alert` in mobile becomes the app's own card (`ModalCard`), and the chat ⋮ gets a usable touch target.
Branch: `feat/mobile-styled-alerts`. Delivery: ask-on-risk. Test runner: `pnpm test:run` in `frontend/packages/mobile` (jest), plus `pnpm lint` and `pnpm typecheck`.

## Specs

- **S1** Chat header ⋮: "el ⋮ es un poco diferente al ⋮ que se encuentra en la lista de usuarios con las que conversé, cuesta un poco poder tocarlo, puede que sea un poco menos ancho que el otro". The header ⋮ gets at least the same touch area as the list ⋮ (padding + `hitSlop`).
- **S2** "en denunciar no lo vimos antes pero falta ajustar el diseño como en los demas, parece un alert, revisemos que en otras opciones no tengamos esto y ajustemos tambien". Scope chosen 2026-10-09: "ambos". Both the dialogs with options (confirmations, menus) AND the one-button notices ("Error: …", "Denuncia enviada") use the styled card.
- **S3** Assumption (not asked): closing the card (X, outside tap, back button) runs the `cancel`-style button's `onPress` when there is one, or the only button's `onPress` for a one-button notice, so flows that navigate on "OK" (register, forgot-password) cannot get stuck. A notice with no buttons shows a single "OK" row.
- **S4** Assumption: a guard test fails if any `Alert.alert` call comes back in `app/` or `components/`.

## Tasks

| ID | Specs | Route | Status | Commit |
|----|-------|-------|--------|--------|
| T1 | S1 | inline | pending | |
| T2 | S2, S3 | inline | pending | |
| T3 | S2 | inline | pending | |
| T4 | S4 | inline | pending | |

- T1: chat header ⋮ touch target.
- T2: `showAlert` (same signature as `Alert.alert`) + `AlertHost` mounted in the root layout, with tests.
- T3: migrate the 28 files and their 17 test files.
- T4: guard test.

## Log

- **L1** (2026-10-09, user, APK 1.3.0 test): "4. el ⋮ es un poco diferente al  ⋮  que se encuentra en la lista de usuarios con las que conversé, cuesta un poco poder tocarlo, puede que sea un poco menos ancho que el otro, por otro lado no aparecen las 4 opciones, solo aparecen 3 en este orden, ver perfil, bloquear usuario y denunciar 5. en denunciar no lo vimos antes pero falta ajustar el diseño como en los demas, parece un alert, revisemos que en otras opciones no tengamos esto y ajustemos tambien"
- **L2** The 3 options are by design: `ActionMenuModal` has no Cancel row (X, backdrop and back close it). My checklist wrongly said 4. The report reasons in the chat are already a card (#365); the alert-looking dialog is the "report sent" / error notice after choosing a reason.
- **L3** (2026-10-09, user) on scope "sólo los que tienen opciones o también los avisos de un botón": "ambos".
- **L4** Measured: 96 `Alert.alert` calls in 28 files; 17 test files reference `Alert`. Design: a drop-in `showAlert` with `Alert.alert`'s signature so the migration is mechanical and the risk sits in one component.
