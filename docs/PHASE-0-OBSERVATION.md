# Phase 0 Observation Record

> **Narrow authority: append-only Phase 0 evidence.** The daily rows and count in
> this file are the evidence for the window. The window definition, two-clock
> reset taxonomy, and portfolio-wide sequence are canonical in
> [the master plan](portfolio-master-plan.md).

**Owner:** Codex, with Sam as final authority  
**Purpose:** the authoritative human-readable record for the 10 consecutive clean
trading-day Phase 0 exit gate in `AUTONOMY-ROADMAP.md`. This is evidence tracking,
not a substitute for the Jetson system sentinel or signed ledgers.

## Window rule

The clock starts on the first market day **after** the Day 0 blockers below are
deployed and independently re-verified. A day counts only when all required
evidence is clean; a missed critical job, unresolved broker/ledger difference,
manual ledger repair, hidden failure, unsafe client exposure, or invalid
MCP receipt resets the consecutive-day count.

## Day 0 — 2026-07-12 ET: BLOCKED

| Check | Evidence | Result |
| --- | --- | --- |
| Jetson service | `portfolio-manager` online; health reports Redis, Sheets auth, Anthropic key, webhook secret, and Telegram all present | Pass |
| Mac companion | `portfolio-executor` online; log contains a successful MCP holdings sync and a clean empty-order reconciliation | Pass |
| Signed financial records | Investors 5/5, Performance 40/40, Trade Ledger 1/1, Lots 1/1, Audit 2,949/2,949 verified | Pass |
| Shadow ledger parity | Sheets positions = `NVDA` plus `Synced via Robinhood Agentic MCP`; Postgres positions = `NVDA` only | **Blocked** |
| Mandate-v3 safety boundary | 437/437 local tests; no live scan import; peer flags remain off | Pass |

### Required repair before Day 1

`lib/pg/parity-runner.js` filters `Last synced...` marker rows but not the current
`Synced via Robinhood Agentic MCP` marker. It therefore reports a false position
divergence (2 Sheets rows vs. 1 Postgres position). The scoped parser fix and
regression test pass locally; deploy it as an isolated production hotfix and prove a
production `npm run db:parity` **MATCH**. Until then, 2026-07-13 is not Day 1.

**Resolution note:** commit `6e0aa24` removed this marker-row count false positive;
the July 13 evening comparison correctly saw one position on each side. It then
exposed the distinct field-level market-value divergence recorded below.

## 2026-07-13 ET review: INVALID — window remains at 0/10

A live review at 10:22 PM ET confirmed that the alerting path worked and that the
day cannot count. The Jetson was online at commit `6e0aa24`, `/health` returned 200
with all required dependency-presence/connectivity booleans true, and the MCP
holdings sync plus order reconciliation recorded successful account-bound runs.
The scheduled signed-ledger check also passed: Investors 7/7, Performance 43/43,
Trade Ledger 1/1, Lots 1/1, and Audit 3,371/3,371 over seven days.

The scheduled 8:00 PM parity check failed, and a fresh manual read-only comparison
failed the same way. Proposals (14), capital entries (7), lots (1), and the number
of positions (1) match. The sole field-level difference is current NVDA market
value: Sheets has `$15.37`; Postgres has `$15.39`. Ticker, company name, shares
(`0.075555`), average cost (`$198.53`), and cost basis (`$15.00`) agree. This looks
like stale/discordant replaceable valuation state rather than lost transaction or
ownership data, but exact parity is the gate and it is not met.

The 6:15 PM sentinel also retained three active P1s: one acknowledged historical
pre-signing NVDA approval and two July 11 `reason=smoke` reconciliation records
whose signatures do not verify. The two reconciliation rows are test artifacts,
not broker orders, but they are still polluting the production open queue and
must be resolved through an auditable cleanup path rather than ignored. PM2 was
online with seven hours uptime, but the sentinel observed 13 restarts since its
prior snapshot. Marker-row leakage and Athena timeouts remained visible P2 noise.

Research health is not proven by the green `/health` response. The scheduled scan
reported 36 attempted reviews, 36 HOLDs, zero proposals, and zero recorded errors,
while the current PM2 error log also contains Anthropic usage-limit failures. The
log has no per-line timestamps, so those failures cannot be conclusively attached
to the scheduled run; the contradiction itself is an observability gap. Treat the
day as unproven until explicit per-review outcome accounting is deployed and a
fresh scan reconciles attempted reviews to successes, blocks, and failures.

Earliest possible Day 1 is the next trading day after the position-value divergence,
active P1 artifacts, and research-run accounting contradiction are resolved and a
fresh full checklist passes. A late repair does not retroactively make July 13 clean.

## 2026-07-14 ET: reviewed evidence-spine deployment

The reviewed shadow/measurement release was deployed after production preflight. The
Jetson is on backend commit `79c778a` on branch `mandate-v3`; additive Neon migrations
`0004_research_observations.sql`, `0005_research_events.sql`, and
`0006_research_outcomes.sql` applied successfully; and PM2 `portfolio-manager` is
online with `/health` 200 and all dependency booleans true. Dashboard commit
`76d92b8` is live at Vercel deployment `dpl_69Ap25LCLgwAiiaQ8heiL9DKQvfd`, with the
signed-out smoke path returning the expected Clerk 307 redirect.

This is a deployment boundary, not a passing observation day. The research spine is
still shadow/measurement-only: peer scoring, positive selection, canary/live
promotion, and canonical money-read cutover remain disabled. The next clean trading
day is the first candidate for the fresh post-deploy window. Existing P1 artifacts,
positions parity divergence, and Yahoo/Athena upstream noise remain open and keep the
gate closed until the daily checklist proves otherwise.

### 2026-07-14 ET current live correction

Later live verification supersedes the open-artifact and unexplained-restart status
above without rewriting the July 13 historical record:

- Production is clean on branch `mandate-v3` at backend commit `e162637`.
- Both historical `reason=smoke` reconciliation artifacts have signed resolutions.
- The historical unsigned NVDA approval is rejected/closed.
- Live Redis has zero open reconciliation records and zero unsigned approved proposals.
- The observed PM2 restart count of 35 correlates to controlled `SIGINT` deployment
  restarts; `unstable_restarts=0` and `exit_code=0`, so the count is not evidence of
  a crash loop.

This cleanup does not start or backfill the observation clock. Transactional versus
valuation parity changes, the automated observer, and cost-governance work remain
local/uncommitted until the final reviewed gate-closing release. Phase 0 therefore
remains **0/10**, and the first possible Day 1 is a clean trading day after that
release.

### 2026-07-14 ET gate-closing backend release

The reviewed backend release is deployed from `mandate-v3` at code commit
`df9b9ef`. Migration `0007_position_quote_provenance.sql` applied, PM2 restarted
cleanly with `unstable_restarts=0` and `exit_code=0`, and local Jetson `/health`
returned 200 with every required dependency boolean true. The backend test suite
passed 713/713 before release. Cost-governance, parity, restore, and observer
changes each received independent blocker review; the final observer re-review and
the restore-timezone re-review were clean.

A post-migration shadow refresh and comparison produced exact transactional
`MATCH` for the accounting snapshot, capital entries, lots, positions, and
proposals. Valuation was honestly `NON_COMPARABLE`, not failed: the retained
Sheets position predates the new content-bound quote version/source/timestamp, so
neither side claimed same-snapshot valuation proof.

The encrypted type-preserving v2 restore drill then passed against all seven live
migrations and all 20 declared tables in a clean PGlite target. Exact counts,
content digests, signature/HMAC bytes, foreign keys, and sequences survived; the
privacy-safe proof is recorded at
`ops/restore-drills/2026-07-14-postgres-shadow-v2.md`. Provider-native Neon PITR
remains a separate pre-canonical-cutover gate.

This release still does **not** start or backfill the clock. At release time, the
Portfolio Manager monthly Anthropic ceiling was human-gated and
`NOT_CONFIGURED`; the later same-day cost-policy update below supersedes that
specific condition. Dashboard companion contract commit `bbb5a5c` is pushed, but
the local `portfolio-executor` restart awaits explicit approval, and the first
scheduled immutable observer record has not yet run. Backend `main`
also awaits explicit approval to fast-forward; production remains pinned to the
reviewed `mandate-v3` branch. Phase 0 remains **0/10**.

A non-persisting production observer dry run correctly returned `FAIL_BOTH` and
`countsTowardSafetyWindow=false`: the release arrived after the day's scheduled
invocations, the 8:00/8:10 evidence had not yet run, the new receipt histories did
not exist for pre-release jobs, and monthly capacity was `NOT_CONFIGURED`. It did
not create or overwrite the immutable daily record or send Telegram. The
privacy-safe spend report found complete readable telemetry for 357 conservatively
repriced legacy calls and `$3.6878` July month-to-date spend, but no approved
ceiling from which to calculate remaining capacity. Authority remained unchanged:
research selection is `shadow` at `research-selection-v1`, and no active Agent 4
allocation policy exists.

#### Later 2026-07-14 cost-policy update

Sam's HUMAN NEEDED response approved a `$40` monthly Anthropic ceiling and accepted
the existing shared credential for now. Production now enforces
`ANTHROPIC_MONTHLY_MAX_USD=40`; PM2 restarted cleanly, `/health` returned 200, and
the privacy-safe report showed complete telemetry, `$3.6878` spent, no active
leases, and `$36.3122` remaining. A second non-persisting observer dry run no
longer reported capacity readiness or monthly headroom as a failure. It still
failed the date, correctly, because pre-release scheduled invocation/receipt
histories and the due final sentinel/parity evidence cannot be recreated
retroactively. At this point the protected holding/evaluator pool remained `$0`;
the later owner-gate completion below supersedes that condition.

#### Later 2026-07-14 PM2 logging update

The final audit found that structured job and observer histories were timestamped,
but legacy raw PM2 lines were not. Production was restarted once with PM2 `--time`,
bringing the fully explained count to 39; `pm2 save` persisted the setting. Fresh
startup lines now carry `YYYY-MM-DDTHH:mm:ss` prefixes, `/health` remains 200 with
all dependencies true, and PM2 reports online, `unstable_restarts=0`, and
`exit_code=0`. This improves future incident attribution but does not make any
earlier raw line attributable or turn July 14 into Day 1.

#### Later 2026-07-14 owner-gate and restart-attestation completion

Sam approved all three immediate owner gates. Production now enforces a `$10`
protected holding/evaluator pool inside the existing `$40` ceiling; the
privacy-safe report remains complete at `$3.6878` spent, `$0` active leases, and
`$36.3122` remaining. Backend `main` was fast-forwarded from `6e0aa24` through the
then-reviewed `4d557e4`. Local `portfolio-executor` was restarted at dashboard
`bbb5a5c`; PM2 reports online, restart 10, zero unstable restarts, and a fresh
Redis heartbeat. The later backend deploy-attestation and loaded-runtime identity
fixes through `e746bd5` leave a new `main` alignment choice because they were
outside the earlier SHA-specific approval.

The scheduled 8:15 PM observer created the first immutable, HMAC-signed
`phase0-observation-v2` record. It correctly returned `FAIL_BOTH`, did not count a
safety day, and retained the research cohort sample. It passed deployment identity,
critical-job summaries, proposal counts, reconciliation, transactional parity,
capacity readiness, monthly capacity, and protected monitoring capacity. It failed
the unrecoverable pre-release invocation/holding histories and the 8:10 PM
untrusted-restart snapshot; research accounting and proposal throughput were
insufficient rather than invented.

That PM2 finding exposed a real automation gap: manual explanations could not be
trusted by the sentinel. Commit `9397eef` added a dedicated-key signed deploy
wrapper that observes and performs only exact `N → N+1` edges; contiguous markers
bind host, process, branch, commit, stable/exit metadata, and process start time.
The first 40 restarts remain manually evidenced and July 14 remains failed.
Restart `40→41` was signed, independently accepted, atomically consumed with the
new baseline, and followed by a sentinel snapshot containing no PM2 anomaly.
Commit `e746bd5` then made the observer prefer the trusted wrapper's pinned PM2
branch/commit over repository HEAD, preventing a later documentation-only pull
from being misreported as loaded code. Its signed `41→42` restart was likewise
accepted and atomically consumed. Production is online at restart 42 with zero
unstable restarts, exit code zero, all `/health` dependencies true, and only the
pre-existing P2 for eight expired proposals in the post-deploy sentinel snapshot.

### Watch, do not normalize away

- Freshly distinguish the retired Python sync's 2026-07-10 failures from the MCP path;
  no new Python-path failure may be treated as harmless without proof.
- Athena timeouts, Yahoo validation chatter, and absent FRED macro data are degraded
  evidence. They must be visible in the daily record and must not silently create
  actionable proposals.

## Daily evidence checklist

After the market close, record the evidence rather than a subjective status.
The read-only observer described in [PHASE-0-OBSERVER.md](PHASE-0-OBSERVER.md)
runs after the 8:10 PM final sentinel refresh and creates the signed,
create-once automated evidence packet at 8:15 PM ET with
independent TRUST safety-day and SKILL research-cohort verdicts; this human
record remains authoritative for attestations, contradictions, and the
consecutive safety-day decision.

1. Jetson health is 200 and every required dependency is true.
2. The scheduled holdings sync and order reconciliation each have a valid, account-bound
   MCP receipt; the companion is online and has a fresh heartbeat.
3. `npm run ledgers:verify` is clean; no manual ledger repair occurred.
4. `npm run db:parity` reports transactional `MATCH`: Sheets and Postgres
   ticker/name/shares/average-cost/cost-basis counts and digests agree. Record the
   separately reported valuation classification. Until the stores persist the
   same versioned quote snapshot/source/timestamp, valuation is
   `NON_COMPARABLE` (or a provenance/freshness mismatch), not evidence of an
   accounting divergence and not evidence of exact valuation parity.
5. All critical market jobs ran or have a documented market-calendar skip. No hidden
   failure, unresolved fill, invalid signature, or unsafe client exposure occurred.
6. Every due holding-monitor record conserves `held = monitored + explicitly degraded`
   with zero failed, overflow, or silent skips. Log aggregate Athena/Yahoo/FRED
   degradation and prove it blocked or downgraded action; do not put private
   tickers in the automated ops record.
7. Update proposal throughput: cumulative genuine actionable proposals, evaluator
   approvals, filled trades, and any owner/lot reconciliation requirement.

## Consecutive-day ledger

| Trading day | Status | MCP sync + reconciliation | Ledgers | Parity | Jobs / holdings monitoring | Proposal evidence | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Jul 13 | **Invalid — does not count** | Pass: MCP sync + reconciliation jobs recorded `ok` | Pass: 7/7 Investors, 43/43 Performance, 1/1 Trade, 1/1 Lots, 3,371 Audit | **Fail:** NVDA market value `$15.37` vs `$15.39` | Critical jobs ran, but 3 active P1s + PM2 restart/marker/Athena noise; scan accounting unproven | 36 reviews reported as HOLD, 0 proposals; usage-limit log contradiction | Alerting worked; exact parity and clean-P1 gate did not |
| Jul 14 | **Observed `FAIL_BOTH` — does not count** | Pre-release invocation receipts cannot be recreated; companion is now restarted with a fresh heartbeat for future days | Prior signed-ledger proof clean | Transactional `MATCH`; valuation `NON_COMPARABLE` warning | Signed v2 observer: critical-job summaries pass, but scheduled-invocation and holding-coverage histories fail; its retained 8:10 snapshot contains one untrusted-restart P1 | 36 conserved outcomes, 0 actionable proposals; research sample retained, throughput insufficient | `$40` ceiling plus `$10` protected pool now enforced. Later `40→41` signed deploy proof clears the future restart path but cannot rewrite the immutable failed day |
| Jul 15 | Pending | — | — | — | — | — | |
| Jul 16 | Pending | — | — | — | — | — | |
| Jul 17 | Pending | — | — | — | — | — | |
| Jul 20 | Pending | — | — | — | — | — | |
| Jul 21 | Pending | — | — | — | — | — | |
| Jul 22 | Pending | — | — | — | — | — | |
| Jul 23 | Pending | — | — | — | — | — | |
| Jul 24 | Pending | — | — | — | — | — | |

## Exit evidence summary

- Consecutive clean trading days: **0 / 10**
- Genuine actionable proposals: **0 / 3 required during the window**
- Evaluator approvals: **0 / 1 required during the window**
- Filled trades during this observation window: **0**
- Autonomy level: **human-supervised; Agents 2/3 supervised and static-watchlist-bound; Agent 4 shadow-only**
