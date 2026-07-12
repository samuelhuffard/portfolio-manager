# Portfolio Manager — Multi-Model Execution Handoff

**Prepared:** 2026-07-11
**Program state:** Phase 0 stabilization is live; the coordinated Phase 1 ownership/contracts release and Phase 2 Postgres shadow are deployed. Agent 4 remains shadow-only.
**North star:** `docs/AUTONOMY-ROADMAP.md` and `~/Claude Memory/Projects/portfolio-manager-autonomy-roadmap.md`.

## Execution update — 2026-07-11

WP1, the Agent 4 shadow foundation, and the Postgres shadow-completeness build are deployed. Strict ownership quarantines unattributed lots; Agent 4 decisions are shadow-only/content-fingerprinted/staleness-gated and have no public write endpoint or live authority; Postgres mirrors proposal lifecycle, lot state, capital entries, and positions with fail-closed daily parity evidence. Independent re-review verdict: **SHIP** after all four initial blockers were fixed. Backend 363/363 and dashboard 92/92 tests passed; TypeScript, contract drift, and production build passed.

The coordinated release is complete: backend `81e7719` and dashboard `f0a5c03` are pushed and deployed; migrations `0002` and `0003` are applied; Jetson health is green; the Mac companion is online; all shadow domains backfilled; parity is `MATCH`; and `PG_DUAL_WRITE=true` is persistent. Continue with observation only—do not cut canonical reads over or grant Agent 4 live authority.

## Mission for the next meta-agent

Ship the reviewed contracts/ownership foundation safely, establish a trustworthy Phase 0 observation baseline, ingest the incoming Agent 2/3/4 mandates without inventing policy, and finish the minimum Phase 1 coordination contracts. Use small models for bounded work packages, but serialize money-path integration, release review, and deployment.

This is not an authorization to add autonomous execution, accept outside capital, enable Agent 4 live approvals, or cut canonical accounting to Postgres.

## Truth at handoff

### Deployed production

- Jetson backend: `81e7719` code deployed (roadmap/handoff docs subsequently recorded in `9d5f4be`), PM2 `portfolio-manager` online.
- Vercel dashboard: `f0a5c03` live.
- Mac PM2: `portfolio-executor` and `portfolio-sysloop` online after restart.
- Phase 0A safety controls are deployed. The 10-trading-day observation window may begin Monday, 2026-07-13 if Monday's critical jobs run clean and no later safety-affecting release resets it.

### Deployed foundation

- Backend and dashboard release branches are synchronized with origin. The backend worktree retains unrelated user WIP in `docs/CHANGE_MAP.md` and `config/agents/_TEMPLATE-STRATEGY-SPEC.md`; those files were deliberately not included in the release commit.
- Backend: shared proposal/signature/lot/pipeline/accounting contracts; approval-validity checks; ownership-scoped SELL logic; signed durable reconciliation; crash-injection tests; Neon migration/backfill/parity and create-path shadow writers behind an off flag.
- Dashboard: generated contract mirrors, signature delegation, proposal-shape/drift tests, companion contract changes.
- Release verification on 2026-07-11: backend 363/363 tests; dashboard 92/92 tests; `tsc --noEmit`, `npm run predeploy`, and production build clean.
- Neon is accepted, migrations are applied, and the full proposal/capital/lot/position shadow is backfilled. Production parity is clean. Sheets/Redis remain canonical; persistent dual-write is enabled for shadow writes only.

### Fresh runtime evidence reviewed

- Jetson and both Mac processes are online. Jetson PM2 shows 18 historical restarts, so uptime alone is not proof of stability.
- July 10 weekly review completed; signed-ledger verification was clean; companion reconciliation reported no filled orders for July 10.
- Logs still contain Robinhood sync re-auth failures, Athena timeouts/fetch failures, Yahoo schema-validation chatter, and Mac sysloop missed cron ticks. The companion had historical poll/reconciliation failures before restart. Recheck fresh timestamps after any release.
- `ops/FIXLIST.md` was generated July 10 and contains a large duplicate-noise cluster. Treat it as leads, not current truth.

## Non-negotiable authority model

1. Agents 1–3 research and propose only under versioned mandates.
2. Agent 4 may eventually accept/reject an exact proposal and allocate bounded virtual strategy budgets; it cannot originate or mutate a trade or force a sale.
3. Only the specialist that opened a strategy-owned lot may propose its reduction/SELL.
4. Sam remains the live signer. Agents 2/3 stay non-actionable; Agent 4 stays shadow-only.
5. Missing, stale, unsigned, ambiguous, or unreconciled state fails closed.

## Ownership policy — resolved

Named strategies now consume only their own lots. Legacy `unattributed` inventory cannot top up a strategy SELL; it routes to signed durable reconciliation with no lot mutation or phantom gain. `ENFORCE_OWNERSHIP=false` is the emergency legacy-FIFO rollback.

## Delegated work packages

### WP1 — Ownership policy and tests

**Owner:** one code model.
**Scope:** `contracts/lot.js`, `lib/owned-lots.js`, SELL callers, and directly corresponding tests; sync the dashboard contract mirror if the canonical contract changes.
**Do not:** deploy, change env, touch Postgres, or broaden Agent authority.

Deliverables:

- Contract prose and runtime behavior agree.
- Own-lot SELL succeeds; cross-strategy and unresolved unattributed consumption fail closed into signed durable reconciliation.
- Existing manual/unattributed exit behavior is explicit and tested.
- Backend tests and dashboard contract drift tests pass.

### WP2 — Coordinated release audit

**Owner:** a separate review model after WP1.
**Scope:** review backend `origin/main..HEAD` and dashboard `origin/main..HEAD` as one release.

Checks:

- HMAC/signature compatibility, fulfillment ordering, durable reconciliation, approval validity, contract drift, and rollback behavior.
- `ENFORCE_OWNERSHIP=false` genuinely restores the previous path without schema damage.
- Postgres shadow code remains non-authoritative and inert unless explicitly enabled.
- No `.env`, credentials, OAuth artifacts, tokens, or recovery files are tracked or staged.
- `rg 'rh\.order_' lib` returns no broker mutation call.

Verification:

```bash
# backend
npm test

# dashboard
npm test
npm run lint
npm run predeploy
npm run build
```

Stop and report any money-path issue; do not patch around a failed invariant during the release step.

### WP3 — Serialized push, deploy, and runtime proof

**Owner:** integration/meta-agent only, after WP1/WP2 pass.
**Order:** push both repos as coordinated contract commits; deploy backend; deploy dashboard; restart the Mac companion only if its loaded code changed; verify all targets.

Backend proof:

1. Confirm Jetson env key presence without printing values; confirm the ownership rollback switch is understood.
2. Pull, run the Jetson test suite, restart `portfolio-manager --update-env`.
3. Require `/health` 200 with all dependencies true, clean fresh startup logs, `npm run ledgers:verify`, no open/tampered reconciliation records, and no immediate restart loop.
4. Observe the first holdings/fill cycle. If ownership/reconciliation behaves unexpectedly, set `ENFORCE_OWNERSHIP=false`, restart, and record the incident; do not repair ledgers in place.

Dashboard/companion proof:

1. Run local `npm run predeploy` and build before Vercel production deploy.
2. Smoke signed-out auth behavior and manager-only API denial behavior.
3. Verify companion heartbeat and a read-only reconciliation result after restart.

Observation rule: if this release lands after Monday's critical jobs begin, reset the Phase 0 10-trading-day clock to the next clean trading day. Record the exact start date in both roadmaps.

### WP4 — Runtime cleanup and evidence baseline

**Owner:** ops-focused model, after deployment.
**Scope:** fresh Jetson/Mac logs, job-state keys, health, reconciliation, and sysloop findings. Do not edit money-path code without a new scoped review.

Priorities:

1. Resolve or prove recovery from Robinhood authentication failures.
2. Confirm weekly-review, order-reconciliation, exit-monitor, research-scan, ledger verification, and companion heartbeat timestamps.
3. Fix job-aware cron expectations and collapse duplicate/self-referential log findings if the unreleased fixes are insufficient.
4. Distinguish Athena/Yahoo degraded optional evidence from critical failures; keep degraded status visible without alert floods.
5. Regenerate `ops/FIXLIST.md` only from current evidence and update individual finding statuses before regeneration.

### WP5 — Mandate ingestion and Agent 4 contract design

**Owner:** strategy-contract model; may run in parallel with WP2/WP4.
**Inputs:** the actual Agent 2, Agent 3, and Agent 4 materials from Sam/his friend. If they have not arrived, produce only the template and ambiguity list.

For each specialist, version: universe, horizon, benchmark, edge, entry/exit/abstention rules, evidence requirements, liquidity/turnover constraints, regimes, invalidation, limits, and evaluation criteria.

For Agent 4, version: objective, accept/reject criteria, allocation inputs and bounds, minimum samples/windows, change caps, diversification, conflicts, macro/regime use, cadence, escalation, and reason codes. Explicitly prohibit self-originated trades, proposal mutation, and forced sales.

Deliver contracts/tests for `PortfolioDecision` and allocation snapshots before runtime Agent 4 behavior. Keep Sam as final signer and do not populate `personality.md` from vague prose.

### WP6 — Postgres shadow completeness

**Owner:** database model, only after the coordinated release is stable.
**Scope:** shadow infrastructure only; canonical reads remain Sheets/Redis.

Deliverables:

- Add proposal decision/update/fulfillment shadow writes through one safe boundary.
- Inventory and backfill lots, capital entries, positions, NAV, orders/fills, and other contracted financial objects with provenance.
- Capture a parity baseline and schedule a daily parity report.
- Test malformed/unavailable shadow writes cannot corrupt or block the authoritative path while shadow mode is explicitly non-authoritative.
- Add backup/restore proof before proposing any read cutover.

Do not persistently enable dual writes until the import/parity report is accepted. Enabling shadow writes is its own reviewed release; a canonical read cutover is a later phase decision.

## Merge and execution order

1. WP1 ownership-policy resolution.
2. WP2 independent coordinated release review and full verification.
3. WP3 serialized push/deploy/runtime proof; establish or reset Phase 0 start date.
4. WP4 fresh operational baseline and FIXLIST cleanup.
5. WP5 mandate contracts can proceed in parallel once real inputs exist, but Agent 4 runtime work waits for Phase 0/1 gates.
6. WP6 completes inactive shadow plumbing after the release is stable.
7. Only then implement the Agent 4 shadow manager and dashboard lineage, with a separate review.

Never let multiple models edit the same money-path files concurrently. The meta-agent owns integration, cross-repo contract synchronization, deploy order, rollback decisions, and roadmap evidence.

## Completion criteria for the next milestone

- Coordinated contracts/ownership release is live or explicitly deferred with a reason and observation-clock consequence.
- Contract and runtime agree on unattributed-lot treatment.
- Production health, logs, signed ledgers, heartbeat, and reconciliation agree.
- Phase 0 observation start date is recorded and daily evidence is accumulating.
- Agent 2/3/4 inputs are either converted to versioned mandates or their missing/ambiguous fields are explicitly listed; no invented policy is activated.
- Postgres remains shadow-only with an accepted parity baseline and no canonical-read change.
- Both roadmaps and this handoff reflect deployed truth, not local intent.
