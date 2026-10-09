# A ban ends live sessions

Objective: banning a user stops their open sessions at once (HTTP and WebSocket), and web and mobile log them out with "account suspended".
Branch: `fix/ban-ends-live-sessions`. Delivery: ask-on-risk. Runners: backend `go test ./... -count=1` (+ `-tags e2e` with `DATABASE_URL`), web `pnpm test:run`, mobile `pnpm test:run`.

## Specs

- **S1** The middleware rejects a banned user's token on the next request with 401 `user_banned`, reading `is_banned` from the same per-request user lookup (no extra query). Unbanning restores the token at once.
- **S2** `OptionalAuth` treats a banned user as anonymous: public reads stay readable.
- **S3** Banning closes the user's open WebSockets (`Hub.DisconnectUser`), only after the ban was saved. A reconnect needs a ticket, which goes through `Auth` and is rejected.
- **S4** Web and mobile handle `user_banned` like `session_expired`: drop the session, go to login, and tell the user "Tu cuenta fue suspendida" (`errors:user_banned`, already in the three locales).
- **S5** An e2e against real Postgres: ban with an open session → next request 401 `user_banned`; unban → 200.

## Tasks

| ID | Specs | Route | Status | Commit |
|----|-------|-------|--------|--------|
| T1 | S1, S2, S5 | inline | pending | |
| T2 | S3 | inline | pending | |
| T3 | S4 web | inline | pending | |
| T4 | S4 mobile | inline | pending | |
| T5 | all | delegated verifier (security, high risk item 2) | pending | |

## Log

- **L1** (2026-10-09, user) on `resolved`: "trate de bloquear el mismo usuario ... con mi cuenta de admin esa denuncia la pase a resolved, que quiere decir que quedo en resolved?" Answer: `resolved` only labels the report. While reading the ban, found that `IsBanned` is checked only at login, Google login and password reset; no middleware or WebSocket reads it, so a banned user keeps a live session up to the 72 h of the token.
- **L2** (2026-10-09, user) on the explained plan: "si hazlo".
