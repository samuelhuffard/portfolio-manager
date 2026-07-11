# ADR 0002 — Scoped service identities (retire the universal bearer)

- **Status:** PROPOSED (draft — audit + staged plan). This is an auth-model change
  across three machines; it must be Codex-reviewed and deployed deliberately, not
  as part of a batch. NOT yet implemented.
- **Date:** 2026-07-11
- **Context source:** roadmap Phase 1 "Give each external caller a scoped service
  identity instead of one universal bearer secret."

## Current state (audited 2026-07-11)

- **Backend (`server.js`):** every route except `/health` is gated by a single
  shared secret — `PORTFOLIO_WEBHOOK_SECRET`, checked as a `Bearer` header
  (`server.js:17,66`). It fails closed when unset (good), but **one secret
  authorizes every caller and every route**. The dashboard proxy, any script, and
  anything else that has the secret can call anything.
- **Dashboard (`app/api/**`):** every route starts with `requireApiPermission`
  (permission + audit action) — this part is already scoped per-user via Clerk +
  RBAC (`lib/client-access.ts`, `lib/audit.ts`, `lib/rate-limit.ts`). The dashboard
  side is in good shape.
- **The gap is the backend↔caller boundary:** a single bearer, no per-caller
  identity, no per-route scoping, no idempotency keys on the backend mutation
  routes, no body-size cap.

Callers of the backend today: the dashboard proxy routes (`/api/scan`,
`/api/alerts*` forward `Authorization: Bearer ${PORTFOLIO_WEBHOOK_SECRET}`), and
operational scripts. That is a small, known set — which makes scoping tractable.

## Decision

Replace the single `PORTFOLIO_WEBHOOK_SECRET` with **named service identities**,
each a distinct secret mapped to an allowed set of routes/actions:

- `svc-dashboard` — may call the read + scan + alert proxy routes.
- `svc-executor` — may call the fill/reconcile recording routes.
- `svc-ops` — may call maintenance/reconcile scripts.

Each identity is a separate env secret; the backend resolves the identity from the
presented key and checks it against a per-identity route allowlist, failing closed
on an unknown key or a route the identity may not reach. This turns "anyone with
the secret can do anything" into least-privilege.

Additionally (independent of the identity split, lower risk):

- **Body-size cap** on backend POST routes (reject oversized bodies before
  parsing).
- **Idempotency keys** on the backend mutation routes that record money events,
  so a retried request cannot double-write (complements the ledger-keyed dedup the
  crash-injection tests already cover).

## Why this is staged, not done here

Flipping the auth model means minting the new secrets and updating them in **three
places** — Jetson `.env`, Vercel env, and the Mac executor `.env` — plus the
proxy routes that present them. A partial rollout (backend expects scoped keys but
a caller still sends the old bearer) fails **closed**, i.e. it takes the system
down until every caller is updated. That is safe but disruptive, so it needs a
coordinated, reviewed deploy with a rollback path — exactly the kind of change the
roadmap protocol says gets Codex review before it ships. Doing it blind at the end
of a build batch would risk an outage during the observation window.

## Staged plan

1. Land the identity registry + per-identity allowlist in the backend behind a
   compatibility mode that **still accepts the legacy bearer** (so nothing breaks).
2. Add body caps + idempotency keys (safe, additive — can ship independently).
3. Issue the scoped secrets; update the dashboard proxy + executor + scripts to
   present their own identity.
4. Once every caller presents a scoped identity, flip off legacy-bearer
   acceptance. Codex-reviewed deploy, with the legacy re-enable as the rollback.

## Codex review refinements (2026-07-11)

Codex reviewed this ADR (Decision B). Incorporated:

- **The legacy bearer must NOT bypass the new route allowlist.** This is the
  critical one: in compat mode, a request authenticated by the legacy bearer must
  still be checked against a route allowlist, or "compatibility" just preserves a
  universal credential that reaches every route — defeating the whole change. The
  legacy bearer maps to a specific (broad-but-bounded) identity, not to "all routes".
- **Corrected caller matrix (verified in code, not assumed):** the Mac companion
  (`scripts/mac-companion.mjs`) calls **only** Upstash Redis (REST) and Telegram —
  it does **not** call the backend's HTTP API. So **`svc-executor` does not need to
  exist yet.** The only external HTTP caller of the backend is the Vercel dashboard
  proxy (`/api/scan`, `/api/alerts*`) → that's the one identity, `svc-dashboard`,
  that must exist. Ops scripts run locally on the Jetson (same host) and can use a
  local `svc-ops` identity or the bearer during compat. Re-verify this matrix
  before implementing — if the companion ever gains a backend HTTP call, it needs
  its own identity then, not before.
- **Identity allowlist keys on method + exact path**, including dynamic route
  segments (not prefix globs that accidentally widen scope).
- **Test matrix required before enabling:** scoped-identity correct-use,
  cross-use (identity A calling identity B's route → denied), missing identity,
  wrong identity, legacy-bearer mode, and legacy-disabled mode.
- **Telemetry:** log every legacy-bearer use (route + caller fingerprint, never
  the secret) so the migration's tail is visible and the removal deadline is
  data-driven.
- **Hard removal deadline + rollback switch** for the legacy bearer — compat mode
  is temporary, not permanent.
- **Body-size limits before JSON parsing** and **atomic idempotency** on
  money-mutating routes ship independently of the identity split (safe, additive).

## Consequences

- Least-privilege at the backend boundary; a leaked dashboard key can't drive the
  executor's money routes.
- A multi-machine secret rotation — must be scripted and verified per machine
  (`grep -c` presence, never printing values), consistent with the env-safety rules.
