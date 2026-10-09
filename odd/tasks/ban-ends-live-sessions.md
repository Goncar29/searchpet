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
| T1 | S1, S2, S5 | inline | done | `1bf54faf` (RED 3 named; e2e red with `IsBanned` dropped from router) |
| T2 | S3 | inline | done | `e6a60ea1` (disconnect-before-save mutation: 2 named fails) |
| T3 | S4 web | inline | done | `bb632be8` + fix (loop-guard mutation red) |
| T4 | S4 mobile | inline | done | `0be2cc85` + fix |
| T5 | all | delegated verifier (security, high risk item 2) | done | S1-S3 met, S4 blocker B1 fixed, S5 run by parent |

## Log

- **L1** (2026-10-09, user) on `resolved`: "trate de bloquear el mismo usuario ... con mi cuenta de admin esa denuncia la pase a resolved, que quiere decir que quedo en resolved?" Answer: `resolved` only labels the report. While reading the ban, found that `IsBanned` is checked only at login, Google login and password reset; no middleware or WebSocket reads it, so a banned user keeps a live session up to the 72 h of the token.
- **L2** (2026-10-09, user) on the explained plan: "si hazlo".
- **L3** Verifier (independent): S1, S2, S3 met; S4 web met; **B1 blocker, mobile**: every request in flight with the token returns its own 401 `user_banned` and `showAlert` queues, so the user got one identical "suspended" alert per request. Fixed by announcing only when a session existed (RED: 3 calls, want 1). Advisory A2 (web: banner and the login error both said "suspended") fixed by hiding the banner once the form has its own error.
- **L4** Advisories left open on purpose: A1, a WebSocket ticket minted up to 30 s before a ban (or a password reset, same gap since rule #38) can still open a socket, because `Connect` only consumes the ticket; A3, anyone can craft `/login?reason=banned`, low impact.
