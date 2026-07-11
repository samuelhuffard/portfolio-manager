# `contracts/` — single source of truth for cross-repo shapes

This directory is the **one** canonical definition of the objects that cross the
backend ↔ dashboard ↔ Mac-companion boundary (Phase 1 of the autonomy roadmap:
"cross-repo contract duplication is removed or mechanically generated").

Historically the proposal schema + decision-signature payload lived in three
hand-maintained copies (`portfolio-manager/lib/redis.js` + `lib/proposal-signature.js`,
`portfolio-dashboard/lib/proposals.ts`, `portfolio-dashboard/scripts/companion-core.mjs`).
Every field rename that missed a copy became a bug (`fulfilledTradeId` vs
`fulfilledOrderId` was exactly this). This package ends that.

## How it stays single-source across two separate repos

The two repos deploy independently (Jetson `git pull` for the backend, Vercel
build for the dashboard), so Vercel cannot import `../portfolio-manager` at build
time. Instead:

1. **Canonical** files live here, authored once as ESM + Zod (plain `.js`, so the
   backend's "no TS syntax in .js" rule is satisfied and the dashboard still gets
   `z.infer<>` types through `allowJs`).
2. **`npm run contracts:sync`** copies `contracts/*.js` verbatim into
   `portfolio-dashboard/lib/contracts/` (a committed vendored mirror).
3. **A drift test in the dashboard** (`tests/contracts-drift.test.ts`) byte-compares
   the mirror against the canonical files and fails `npm test` if they differ —
   the same cross-repo guard pattern `tests/companion-core.test.ts` already uses.

So there is exactly one place to edit (here). The sync + drift test make the
dashboard copy mechanically generated, not independently maintained.

## Editing rule

Change a shape here, run `npm run contracts:sync`, run `npm test` in both repos,
commit all changed files together. Never edit `portfolio-dashboard/lib/contracts/`
by hand — the drift test will reject it.

## Zod version

Pinned to the `zod@3` API (both repos ship 3.25.x).
