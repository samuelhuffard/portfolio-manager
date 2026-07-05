# portfolio-manager (backend)

AI portfolio research + execution backend. **Real money flows through this repo.** Node ESM (no TypeScript syntax in .js), runs on the Jetson under PM2 as `portfolio-manager` (`scheduler.js` → jobs + `server.js` on :3200).

## Read first

- **Open system-loop findings → `ops/FIXLIST.md`** (auto-generated). At session start, skim "Needs attention" and judge whether anything there should be fixed as part of (or before) the current task — verify against live state first, findings are point-in-time. When you fix one, follow the status/regenerate steps in the file header.
- New to the system → `docs/ONBOARDING.md` (mental models, proposal lifecycle, vocabulary).
- Before ANY change → find your change type in `docs/CHANGE_MAP.md` (exact files + gotchas).
- Touching proposals/execution/ledgers/NAV → `docs/INVARIANTS.md` is non-negotiable.
- Ops (deploy, env, failure modes) → `docs/RUNBOOK.md`.

## Hard rules

- No autonomous trade execution. Python (`lib/robinhood-*.py`) stays read-only forever — `grep rh.order_` must return nothing (tested in `tests/read-only-broker.test.js`).
- Execution ordering is the safety mechanism: `Executing` marker before order → ledger write before fulfillment → `ref_id = proposal.id`. Never reorder.
- Security/signature checks fail CLOSED. Ledger tabs are append-only; corrections are new rows.
- The proposal schema + decision-signature payload live in THREE copies (here `lib/redis.js` + `lib/proposal-signature.js`, dashboard `lib/proposals.ts`, companion `scripts/companion-core.mjs`). Any change ships to all copies in one commit — checklist at the bottom of CHANGE_MAP.
- Money math goes in pure `lib/` functions with tests (`npm test`, ~100), then gets wired into `jobs/`.
- Failure is loud: pipeline outputs that get dropped must `console.error` + Telegram. Missing model-output fields FAIL the checks that read them.
- Never print secrets or full `.env`; `.trim()` every env read; check env presence per machine (local ≠ Jetson).

## Deploy

Push to main → `ssh sam@100.102.93.103`, `cd ~/portfolio-manager && git pull && npm test && pm2 restart portfolio-manager --update-env`, then `curl localhost:3200/health` (must be 200 with all `deps` true). Not done until health + fresh logs are clean.

Companion repo: `../portfolio-dashboard` (dashboard on Vercel + Mac executor `scripts/mac-companion.mjs`, PM2 `portfolio-executor` — restart it after pulling executor changes).
