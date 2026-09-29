# Mobile lint in CI (G6c)

## Objective

Make `pnpm lint` in `frontend/packages/mobile` exit 0 with zero warnings and
run it in the `Mobile Tests` CI job, like web does since G6/G6b.

## Problem

Mobile has eslint 8 (`.eslintrc.js`, `eslint-config-expo`, i18next plugin) and
nobody runs it. Measured 2026-09-29 on `origin/main` (`dbad47ad`): 81 problems.

- 47 `no-undef`: `jest`/timers in `jest.setup.js` and `__mocks__/*.js`
  (config: those files have no jest env).
- 5 React Compiler rules from react-hooks v7 (`immutability`,
  `set-state-in-effect`, `refs`). Web turns these off on purpose (G6): only
  `rules-of-hooks` + `exhaustive-deps`.
- 9 `react-hooks/exhaustive-deps` in app code — the rule that matters.
- Test-only noise: `no-require-imports` (10), `no-literal-string` (2),
  `display-name` (2), `import/first` (1).
- 5 `@typescript-eslint/array-type` (`Array<T>` vs `T[]`).

## Scope

Lint config, the app files with findings, the `lint` script, `ci.yml`.
No behavior change except where an exhaustive-deps finding is a real bug.

## Tasks

- [x] T1 — Config: jest env for test/mock files, test-file overrides,
  compiler rules off (match web), `--max-warnings=0`. Fix the 9
  exhaustive-deps (each: real bug → fix + test; intentional → disable with a
  written reason) and the array-type ones. `Lint` step in `Mobile Tests`.
  Route: delegated (2+ non-trivial files).

## Checks

- `pnpm lint` exit 0 (mobile).
- `pnpm typecheck` exit 0, `pnpm test:run` exit 0.
- Mutation: a missing hook dep in an app file makes `pnpm lint` fail with that
  rule named.

## Progress

- 2026-09-29: measured; branch `chore/mobile-lint-ci`.
- 2026-09-29: T1 done (delegated writer). 9 exhaustive-deps: 8 intentional
  (stable zustand actions, expo-router `router`, React Navigation
  `navigation`, run-once location request) disabled with written reasons;
  the two location effects inlined. `user` added to the chat effects' deps
  because they read it. The writer called one a real bug (messages loading
  before `user`) with a test; REJECTED: `loadToken` sets the API token and
  `user` in the same tick and the conversation endpoint needs the token, so
  that state is unreachable. Test reverted, comments corrected.
  Checks: lint EXIT=0, typecheck EXIT=0, test:run EXIT=0 (277). Writer's
  mutation (drop `sendEnvelope` from a useCallback) → lint EXIT=1 naming
  exhaustive-deps.
