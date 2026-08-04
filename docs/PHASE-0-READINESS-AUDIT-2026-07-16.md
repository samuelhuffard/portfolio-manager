# Phase 0 Observation Readiness Audit — 2026-07-16

## Decision

The observation system was not ready to begin an honest consecutive window in
its pre-audit form. The production money path was healthy, but several observer
and transport rules could either create a false failure or let a partial day be
recorded permanently. The repairs below are one consolidated S2 gate-closing
release. Therefore 2026-07-16 cannot count; the first eligible safety day is the
next clean trading day after this release.

After the repaired backend and Mac companion are deployed and verified, no known
P0/P1 defect remains in the observed workflow. Research/advisory failures remain
visible without erasing a clean TRUST day, and every money/control failure still
fails closed.

## Scope reviewed

- The canonical TRUST/SKILL clocks, S1/S2/R1/R2 reset taxonomy, Phase 0 entry and
  exit gates, and freeze rules in `docs/roadmaps/portfolio-master-plan.md`.
- Every scheduled backend workflow from 8:30 AM premarket through the 8:20 PM
  observer, including the Friday and Sunday exceptions.
- Jetson-to-Mac broker-read transport, account binding, leases, retries,
  invocation receipts, holdings projection idempotency, and reconciliation.
- Per-holding monitoring conservation, circuit-breaker and protected-capacity
  behavior, signed ledgers, open reconciliations, Postgres shadow refresh/parity,
  dashboard probes, PM2 restart attribution, and sentinel finding carry-forward.
- Observer freshness, create-once persistence, HMAC/archive/index recovery,
  deployment identity, trading-calendar behavior, two-clock verdicts, and
  consecutive-count consumption in the dashboard.
- Backend and dashboard dependency inventories, tracked secret-like files,
  ignore rules, and common credential patterns in tracked content.

## Corrected defects

| Defect | Failure mode | Repair |
| --- | --- | --- |
| Singleton MCP request per job kind | One retrying holdings request coalesced later 11:00/1:00/3:00 slots, making their required receipts impossible | Atomic invocation-deduplicated FIFO; every slot retains its own request and receipt |
| Historical failure masked recovery incorrectly | Any failed attempt blocked a slot even after a valid retry | Append-only attempts remain visible; the final attempt for that exact invocation is authoritative |
| Manual observer persisted by default | A daytime diagnostic could create the immutable failed record before later jobs ran | Manual command is dry-run; persistence is explicit and rejected before 8:20 PM ET |
| Deployment day was not machine-blocked | A same-day S1/S2 release could still receive `countsTowardSafetyWindow=true` | Signed runtime identity now carries deployed-at time; deployment date must predate the observation date |
| TRUST and SKILL jobs were mixed | Research scan, performance review, weekly review, or advisory research-data failure could become P1 and reset safety | Money/control jobs remain P1/TRUST; research/advisory workflows are P2/SKILL and cannot erase TRUST unless protected monitoring is actually lost |
| Partial performance-review failure returned success | One or more agent reviews could fail while the scheduled job recorded green | Per-agent work remains isolated, but any partial failure is aggregated and thrown into job status |
| Audit Redis read errors looked empty | An unavailable audit day was treated as zero rows and could pass ledger verification | Redis and JSON failures are explicit ledger-verification problems |
| Companion heartbeat could overlap or reject unhandled | Slow broker work could overlap the next tick; a top-level rejection could restart the companion | Serialized heartbeat tick with top-level catch/finally and overlap suppression |
| Raw Redis REST errors were not checked | HTTP/Upstash errors could be interpreted as undefined command results | Both Redis helpers reject non-2xx responses and command error payloads |
| MCP child errors dumped full commands | A broker-read failure could copy the prompt and account identifier into PM2 logs/receipts | Failure summaries stop before command text, redact the account identifier, strip controls, and cap length |
| Observer had only five minutes after final sentinel | Ordinary latency left little operational margin | Observer moved from 8:15 to 8:20 PM ET; final sentinel remains at 8:10 |

## Tuned clock boundaries

### TRUST — resets the consecutive safety clock

- Runtime commit, branch, deployed-at timestamp, mandate versions, selection
  policy, and deployment date eligibility.
- Five account-bound holdings receipts, one account-bound order-reconciliation
  receipt, fourteen intraday invocations, and both sentinel invocations. Missing
  or malformed evidence fails; a recovered retry passes only when it is the final
  attempt for that invocation.
- Complete per-holding coverage for every due intraday and exit monitor, with no
  failure, overflow, or silent skip. Explicitly degraded source evidence is
  allowed only when the holding itself remains monitored conservatively.
- PM2 online/health dependencies, trusted restart edges, dashboard/auth probes,
  companion readiness when approved work waits, Redis proposal integrity,
  signed approvals, lifecycle/reconciliation, Sheet schema/freshness, and active
  tracked P0/P1 findings.
- Signed Investors, Performance, Trade, Lots, and audit ledgers; unreadable or
  malformed evidence fails closed.
- Shadow position refresh, exact transactional parity, and valuation safety. A
  valid `NON_COMPARABLE` valuation remains visible but does not invent an
  accounting divergence. Same-snapshot value mismatch or monitoring impact
  blocks.
- Protected holding/evaluator capacity. Ordinary research-budget exhaustion is
  not a safety failure unless it actually prevents protected monitoring.

### SKILL — does not reset a clean safety day

- Research-scan and performance-review completion.
- Conserved, current-version research outcome accounting and current cadence.
- Proposal queue readability, genuine actionable proposals, and confirmed
  evaluator approvals.
- Research/advisory provider capacity, premarket awareness, weekly feedback, and
  enriched research-data health unless a failure crosses into protected holding
  monitoring, health, resource reservation, or money/control behavior.

### Human promotion checks

The automated observer establishes daily eligibility; it does not unilaterally
promote autonomy. The human record must still attest no manual ledger repair or
contradictory evidence. At the time of this audit, Phase 0 exited only after both 10/10 consecutive TRUST days
and the current-version proposal/evaluator gates are met.

> **Superseded policy:** on 2026-07-20 Sam reduced the supervised workflow-readiness
> threshold to 5/5 consecutive TRUST days while retaining the proposal/evaluator
> gates and human approval authority. This dated audit preserves its then-current
> 10/10 wording as historical evidence.

## Schedule and dependency review

| ET cadence | Workflow | Clock treatment | Required end-of-day proof |
| --- | --- | --- | --- |
| 8:30 | Premarket awareness | Advisory/P2 | Visible degradation; never a safety reset by itself |
| 9:30, 11:00, 1:00, 3:00, 4:30 | Broker holdings reads | TRUST | Five FIFO-isolated, account-bound final receipts |
| 9:35; every 30m 10:00–3:30; 3:50 | Intraday holding monitor | TRUST | Fourteen invocation records and conserved holding coverage |
| 4:40 | Broker/order reconciliation | TRUST | Account-bound receipt and zero open reconciliation records |
| 4:45 Sun–Thu | Exit monitor | TRUST when due Mon–Thu | Conserved held-name coverage; Sunday is research replay, not a safety day |
| 5:15 Sun–Thu | Research scan | SKILL | Current cadence and conserved outcomes; Sunday sample consumed once |
| 5:45 | Performance review | SKILL | All agent reviews complete or explicit failed job |
| 6:00 | Signed-ledger verification | TRUST | Fail-closed verification result |
| 6:15 | Timely sentinel | TRUST | Invocation with no P0/P1 blockers |
| 7:30 | Advisory research-data refresh | SKILL/P2 | Visible status; no safety reset while isolated from authority |
| 7:50 | Sheet-to-Postgres position refresh | TRUST | Current-day successful job |
| 8:00 | Postgres parity | TRUST | Current-day transactional result and valuation classification |
| 8:10 | Final sentinel | TRUST | Fresh final snapshot plus invocation history |
| 8:20 | Immutable observer | BOTH | Complete-day signed record; dry-run before persistence cutoff |

The ordering has no authority inversion: broker reads remain read-only; research
cannot execute; Sheets/Redis remain canonical money sources; Postgres remains
shadow; and the observer reads evidence without repairing it.

## Verification evidence

- Backend: 761/761 tests passing after the FIFO and observer changes.
- Dashboard/companion: 124/124 tests passing, `tsc --noEmit` clean, and the
  production Next build complete.
- Backend dependency audit: zero known vulnerabilities.
- Dashboard dependency audit: no high/critical findings; four moderate transitive
  findings. The affected paths are Next/PostCSS build/style serialization and
  ExcelJS/UUID v3/v5 buffer handling. Neither is used by the broker companion's
  request/receipt path, and `npm audit` offers only incompatible/downgrade-style
  remediations. Track as non-blocking dependency P2 work rather than changing the
  safety release blindly.
- Tracked-secret filename/pattern scan found no credential material. `.env*` and
  private Phase 0 archives are ignored. The tracked credential-rotation finding
  is fixed and its no-secret resolution evidence is retained.
- `git diff --check` is clean in both repositories.

## Known non-blocking conditions

- Eight historical expired proposals remain an acknowledged P2. They are not
  approved, executable, or a ledger/reconciliation inconsistency.
- Valuation may remain `NON_COMPARABLE` until both stores share content-bound
  quote provenance. Transactional parity must still be exact.
- External research providers can fail. The day remains safe only if held-name
  monitoring is conserved and protected capacity was not denied; SKILL evidence
  may fail independently.
- A new log cluster is P2 unless it grows into the existing P1 threshold or maps
  to a money/control failure.

## Release rule

Deploy the backend and Mac companion together, restart both through their normal
controlled paths, verify exact revisions, PM2 health/restart metadata, companion
heartbeat, FIFO request compatibility, final sentinel, and a dry-run observer.
This S2 release is the final gate-closing boundary. Any later S1/S2 change resets
the safety clock; pure R1 work opens only a new research cohort when it remains
isolated from TRUST behavior.

## Live release proof

- Backend `mandate-v3@3c01d03f52f70b33fcf85222ee591527adc844e0` is loaded on
  Jetson through signed restart edge `55→56`. PM2 is online with zero unstable
  restarts and exit code zero; `/health` is green for Redis, Sheets, Anthropic,
  webhook, and Telegram dependencies.
- Companion `main@e04a602` is loaded by `portfolio-executor`. PM2 is online with
  zero unstable restarts and exit code zero. Its Redis heartbeat was three
  seconds old at verification; both FIFO queues were empty with no legacy
  singleton or outstanding lease.
- A post-release published sentinel had zero P0/P1 and one known P2: eight
  historical expired proposals. The previous new-log-cluster P2 did not recur.
- The manual observer ran in dry-run mode, wrote nothing, recovered the pinned
  PM2 identity, and correctly refused to count the release date itself. Missing
  later-day jobs in that daytime diagnostic remained fail-closed as expected.

### Post-release closing-chain and FIFO canary

A same-day production dress rehearsal increased confidence in the first eligible
day without attempting to backfill or count the release date:

- Signed-ledger verification passed 7/7 Investors, 52/52 Performance, 1/1 Trade,
  1/1 Lots, and 5,303/5,303 audit rows, with zero unsigned or mismatched rows.
- The authoritative Sheet-to-Postgres refresh completed and transactional parity
  matched for accounting snapshot, capital entries, lots, positions, and
  proposals. Valuation remained correctly `NON_COMPARABLE`.
- Health remained green and a dry sentinel returned zero P0/P1 with only the
  acknowledged expired-proposal P2.
- Two synthetic, read-only order-reconciliation invocations were atomically
  enqueued behind one another. The companion completed them in FIFO order with
  distinct successful account-bound receipts, acknowledged each head exactly
  once, drained the queue to zero, retained a fresh heartbeat, and left zero open
  reconciliations. No order was placed, changed, reviewed, or cancelled.
