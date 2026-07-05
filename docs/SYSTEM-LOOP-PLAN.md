# System Autoresearch Loop ("Sysloop") — Design Plan

*Drafted 2026-07-05; first slice (§3) BUILT the same day — sentinel + findings ledger + Mac tiers live, see `docs/RUNBOOK.md` "Sysloop" for ops. Companion doc to `LOOP-DESIGN.md` (which covers the investing loop).*

## 1. Two loops, two subjects

| | Investing loop (exists) | System loop (this plan) |
|---|---|---|
| **Subject** | The portfolio — what to buy/sell | The product — the software that decides |
| **Inner unit** | One ticker through scan → evaluator → proposal | One anomaly through detect → classify → finding |
| **Generator** | AI overlay (Sonnet) proposes trades | Sentinel probes + triage propose *system changes* |
| **Evaluator** | `lib/evaluator.js` (Opus, skeptic) | Skeptic pass over proposed patches/findings |
| **Human gate** | Sam approves proposals in `/approvals` | Sam approves patches/doc changes before merge |
| **Executor** | Mac companion, signed approvals only | Sam (git merge + deploy) — the loop never deploys |
| **Memory** | Weekly lessons → agent prompt memory | Findings ledger → tests, docs, risk register, Obsidian |
| **Improves** | Investing behavior | Reliability, UX, tests, docs, demo-readiness |

The investing loop asks "was that a good trade?" The system loop asks "did the machinery that produced the trade work — and how do we make it fail less?" They share infrastructure (Redis, Telegram, the Mac companion's `claude -p` pattern) but never share write surfaces: the system loop cannot touch proposals, risk limits, agent memory, or anything on the money path.

## 2. Architecture

Three tiers, cheapest first. **Tier 0 is deterministic code and runs every day. Tiers 1–2 are LLM passes that run on the Mac via `claude -p` (Claude Pro subscription, `--model sonnet` = Sonnet 5 — zero API spend), and only when Tier 0 found something / it's the weekly slot.**

### Roles

- **Sentinel** (Jetson, deterministic Node) — runs all probes, emits a structured snapshot. No LLM. Writes `pm:sysloop:snapshot:<date>` + `ops/health/<date>.json`, and its own heartbeat `pm:sysloop:last-run`.
- **Cross-watch** (Mac, deterministic) — the one thing the Jetson can't detect is its own death. The Mac side checks `pm:sysloop:last-run` staleness (and the Jetson checks `pm:companion:last-seen` — mutual watch, already half-built).
- **Analyst** (Mac, `claude -p`, daily, conditional) — reads only the *summarized anomaly delta* (new anomalies vs. yesterday, capped ~4k tokens), classifies each into a typed finding (bug / regression / stale-surface / UX / test-gap / doc-drift), dedupes against the findings ledger by fingerprint, escalates new P1s to Telegram. Skipped entirely on quiet days.
- **Researcher** (Mac, `claude -p` with read-only repo access, weekly) — reasons over the week's snapshots, error clusters, open findings, and recent commits. Produces the durable artifacts: product-health report, proposed patches, proposed failing tests, doc/risk-register diffs, Obsidian updates.
- **Skeptic** (second `claude -p` pass, weekly, proposals only) — same pattern as `lib/evaluator.js`: separate prompt, rubric-scored (Is the evidence cited and reproducible? Is this the smallest fix? Does it touch an invariant? Would it break a test?). Proposals it can't confirm are labeled PLAUSIBLE, not CONFIRMED, and P1 claims without runtime evidence get downgraded. Like the investing evaluator: **it can only demote or reject, never upgrade.**
- **Sam** — the only writer to `main`, the only deployer, the only approver.

### Cadence

| When | What | LLM? |
|---|---|---|
| 18:15 ET Mon–Fri (after verify-ledgers at 18:00) | Sentinel full snapshot on Jetson | No |
| Every 30 min (Mac, piggybacks executor poll or its own PM2 cron) | Cross-watch: Jetson liveness, companion-vs-approved-proposal staleness | No |
| ~18:30 ET daily, only if snapshot delta is non-empty | Analyst triage | `claude -p` (1 call max) |
| Sunday 10:00 ET | Researcher deep review + Skeptic pass | `claude -p` (2–4 calls max) |
| Monthly (v2) | Meta-review: loop grades its own precision | `claude -p` (1 call) |

### Artifacts

| Artifact | Where | Written by | Git-tracked |
|---|---|---|---|
| Daily snapshot | `ops/health/<date>.json` + Redis (7d TTL) | Sentinel | No (gitignored; last 30 kept) |
| Finding | `ops/findings/F-<yyyy>-<nnn>-<slug>.md` (frontmatter: id, fingerprint, severity, status: open/ack/fixed/regressed, occurrences) | Analyst | Yes |
| Weekly product-health report | `ops/reports/<isoweek>-product-health.md` | Researcher | Yes |
| Proposed patch | `ops/proposed-patches/<finding-id>.diff` (+ optional local branch `sysloop/<finding-id>`, never pushed) | Researcher | Yes (the .diff) |
| Proposed failing test | `ops/proposed-tests/<finding-id>.test.js` | Researcher | Yes |
| Doc/risk-register diffs | inside the weekly report as fenced diffs | Researcher | Yes |
| Obsidian updates | vault `Projects/portfolio-manager.md` + monthly log append | Researcher (runs on the Mac, vault is local) | n/a |

### Automatic vs. propose-only

**May do automatically:** run read-only probes; write its own Redis keys (`pm:sysloop:*` only), `ops/` files, and Telegram alerts; append to Obsidian vault notes; commit `ops/` artifacts on a `sysloop/ledger` branch (or leave uncommitted for Sam — v1 leaves them uncommitted).

**Must only propose (Sam reviews and applies):** any change to `lib/`, `jobs/`, `scripts/`, `config/`, `tests/`, docs, dependencies; any deploy; any PM2/cron change; any dashboard change; anything touching auth, risk limits, or the proposal/execution path — these are hard-denied even as *generated diffs get flagged* if they touch files listed in `INVARIANTS.md`'s money paths.

## 3. First implementation slice (1–2 sessions)

**Session 1 — Sentinel (Jetson side, all deterministic, ~0 new dependencies):**
1. Instrument `scheduler.js` with a job wrapper writing `pm:job:<name>:last-run` = `{ts, ok, durationMs, error?}` (this is the deferred item from LOOP-DESIGN §7 — the system loop's first act is closing that gap).
2. `lib/sysloop/checks.js` — pure functions, one per check (§5 checks 1–4, 6–11 below), each returning `{id, ok, severity, evidence}` from injected inputs so they're unit-testable with fake data.
3. `lib/sysloop/fingerprint.js` — normalize + hash for error clustering and finding dedupe.
4. `jobs/system-sentinel.js` — gathers inputs (PM2 jlist, `/health`, Redis, Sheets headers, log tails since last run), runs checks, writes snapshot, Telegrams P1s only. Cron `15 18 * * 1-5` + `npm run sysloop:check`.
5. `tests/sysloop.test.js` — fake snapshot inputs → expected findings.

**Session 2 — Analyst + Researcher (Mac side):**
1. `scripts/sysloop-triage.mjs` — pulls the snapshot delta from Redis, summarizes to ≤4k tokens, one `claude -p` call with restricted tools, writes/updates `ops/findings/*.md`, Telegram for new P1s. Rate-limited via `pm:sysloop:triage:<date>` (1/day hard cap).
2. `scripts/sysloop-weekly.mjs` — assembles the week (snapshots, clusters, open findings, `git log --oneline` for both repos), one Researcher call + one Skeptic call, writes the report + proposed tests/patches + Obsidian appends.
3. New Mac PM2 process `portfolio-sysloop` (same deploy pattern as `portfolio-executor`: runs from the working tree). Both scripts live in `portfolio-manager/scripts/` since the Mac has the clone.
4. Guardrailed `claude -p` invocation (see §7).

Deliberately **not** in the first slice: signed-in browser flows, patch generation beyond diffs for already-diagnosed findings, GitHub issues, dashboard UI.

## 4. v2 / v3 roadmap

**v2 (after 2+ weeks of stable v1 signal):**
- Signed-in dashboard smoke flows via Playwright/agent-browser with a dedicated Clerk test user (Client role, zero real units): sign in → `/investors` renders → `/approvals` blocked for Client → FundManager test path for approvals rendering. Weekly, on the Mac.
- Approvals UX metrics: time-from-proposal-to-decision distribution, proposals expired unseen → UX findings ("Sam never saw it" is a product bug).
- Patch-first workflow: recurring finding (fingerprint hit ≥2) automatically gets a failing test skeleton *before* a patch is proposed — test-driven repair.
- Monthly meta-review: precision/recall of the loop itself (findings Sam marked useful vs. dismissed, incidents the loop missed). The loop's own Track Record tab, effectively.
- Dashboard `/system` page (manager-only) rendering the latest snapshot + open findings.
- First patch proposals seeded from the known risk register: holiday calendar for `isMarketOpen()`, `claude -p --output-format json` for the companion, HMAC verify-on-read.

**v3:**
- Generalize `lib/sysloop/` into a harness Jordan and Aide can reuse (checks-as-pure-functions + snapshot + findings ledger is project-agnostic).
- Loop-maintained eval suite: recurring finding classes become permanent regression checks automatically proposed into `tests/`.
- Self-tuning thresholds (staleness windows, cluster-growth alarms) proposed by the monthly meta-review.
- GitHub issue mirroring for findings (repos are private; local markdown stays canonical).
- Companion may *apply* an approved system patch locally and run the test suite to verify it — still never pushes, never deploys.

## 5. The checks (Tier 0, all deterministic)

| # | Check | How | Finding severity |
|---|---|---|---|
| 1 | Jetson PM2 health | On Jetson: `pm2 jlist` → `portfolio-manager` online, restart-count delta since last snapshot (flapping), memory ceiling | Offline P1; flapping P2 |
| 2 | Backend `/health` | `GET localhost:3200/health` → every dep boolean (`redis`, `sheetsAuth`, `anthropicKey`, `webhookSecret`, `telegram`) must be `true` | Any `false` = P1 (this exact class ran silent for 3 days once) |
| 3 | Scheduler freshness | For each job, `pm:job:<name>:last-run` vs. its cron expectation (research-scan must have run by 18:00 on a trading day, etc.). Missing key = never ran = P1. Also flags `ok:false` runs | Missed cron P1; failed run P1/P2 by job |
| 4 | Vercel dashboard health | Signed-out probes: `/` → 307 to `/sign-in`; `/sign-in` → 200; `/api/portfolio` → 401; `/api/proposals` → 401; latency budget | 5xx/timeout P1. **A 200 on a signed-out API = P0 security regression, immediate Telegram** |
| 5 | Dashboard user-flow smoke | v1: API-shape checks only. v2: Playwright signed-in flows (Clerk test user) | P2 |
| 6 | Approvals flow | Proposals `Pending` >48h (Sam isn't seeing them); `Executing` stuck >2 poll cycles; **approved-but-unexecuted >30 min during market hours** (ships risk-register mitigation #17); expired-unactioned count | Stuck Executing P1; rest P2 |
| 7 | Companion heartbeat | `pm:companion:last-seen` staleness — informational when idle, P1 when stale *while approved proposals wait* during market hours | P1/P3 contextual |
| 8 | Redis queue sanity | Every id in `pm:approval_proposals` resolves to a valid `pm:approval_proposal:{id}` matching the canonical schema (`proposals.ts` shape); no orphans; `pm:breaker:state` parseable and a known tier; `pm:hwm:portfolio` a sane number; sysloop's own keys within TTL | Schema drift P1 (three-copy schema is mistake-class #2) |
| 9 | Sheets schema + staleness | Header row of each tab vs. expected-schema constants; last Performance row = last trading day; Holdings timestamp = today (trading days); Track Record row count never decreases | Header drift P1; stale data P2 |
| 10 | Proposal lifecycle integrity | Reuse `lib/reconcile.js` output + assert: every Trade Ledger orderId ↔ a signed approved proposal; no fulfilled proposal without a ledger row; no ledger row without HMAC fields | Any mismatch P1 |
| 11 | Log error clustering | Tail PM2 out/error logs *since last snapshot offset* (check file mtime first — stale-log lesson), strip timestamps/ids, fingerprint lines, count clusters. New cluster or 3× growth = anomaly. LLM never reads raw logs, only top-cluster exemplars | New cluster P2, growth P1 |
| 12 | Stale docs / risk register | Deterministic: file paths referenced in `docs/*.md` that no longer exist; `RISK_REGISTER.md` items whose "Mitigate" is now shipped (marker comments). Weekly Researcher pass: compare the week's `git log` to docs and flag contradicted claims | P3 (doc-drift finding type) |
| 13 | Missing-test suggestions | Findings ledger: fingerprint recurrence ≥2 → Researcher proposes a failing-test skeleton in `ops/proposed-tests/` citing the finding; also flags `jobs/*.js` code paths implicated in clusters that have no test coverage | P3 (test-gap finding type) |

## 6. Findings → durable improvements

The pipeline is: **anomaly → finding (deduped, typed, evidence-linked) → weekly synthesis → durable artifact → Sam merges → finding closed → recurrence watched.**

- **Findings ledger** (`ops/findings/`, git-tracked markdown) is the loop's memory. Fingerprints make recurrence measurable; a `fixed` finding whose fingerprint reappears flips to `regressed` and escalates one severity level — that's the loop detecting that a fix didn't hold.
- **Failing tests before patches** for anything recurring — the test is the durable artifact even if the patch is rejected.
- **Proposed patches** as `.diff` files with the finding id, evidence, and skeptic verdict attached. Sam applies with `git apply`, reviews, commits himself.
- **Risk-register updates** as diffs in the weekly report — new risks the loop observed, mitigations now shipped, stale entries.
- **Obsidian**: weekly job appends a short health summary to vault `Projects/portfolio-manager.md` and the monthly log — so Jordan and future Claude sessions inherit the system's health picture.
- **Weekly product-health report**: one page — uptime/cron hit-rate, new/open/closed findings, error-cluster trend, proposal-flow stats, top 3 recommended actions. This is also the demo-credibility artifact: a system that publishes its own health report is show-off-ready in exactly the way the operating goal asks for.
- **GitHub issues**: deferred to v3; local markdown has less friction and the repos are private.

## 7. Guardrails (hard, enforced in code not prompts)

1. **No autonomous deploys.** The loop never runs `git push`, `pm2 restart` (except its own `portfolio-sysloop` via Sam), `vercel`, or `jet`. Deploy verbs are simply absent from its code and denied to its `claude -p` tool allowlist.
2. **No trading surface.** Sysloop code never imports proposal-creation, execution, or accounting modules for writing; its Redis writes are namespaced `pm:sysloop:*` and enforced by a single `sysloopRedisWrite(key, ...)` helper that throws on any other prefix. The `claude -p` invocations run with `--strict-mcp-config` and no MCP servers, so the Robinhood MCP is unreachable even from the Mac.
3. **No secret printing.** Snapshots follow the `/health` pattern: booleans and counts only, never values. The Analyst/Researcher prompts receive summaries, never `.env` content or raw logs (clusters are pre-redacted exemplars).
4. **No destructive git.** Allowed: `status`, `log`, `diff`, `branch` (create `sysloop/*` only), `apply --check`. Denied: push, reset, checkout of non-sysloop branches, clean, filter-anything.
5. **Read-only by default.** Write surface is exactly: `ops/**`, `pm:sysloop:*`, Telegram, vault appends. Everything else is a proposal artifact.
6. **Fail closed on auth/security uncertainty.** A probe that can't authenticate or gets an unexpected auth response reports `UNKNOWN` + alert, never `ok`. A signed-out endpoint returning 200 is treated as a live security incident (P0 Telegram), not a finding to batch.
7. **`claude -p` sandboxing:** `--allowedTools "Read,Grep,Glob"` plus a whitelisted read-only Bash set for the Researcher; cwd pinned to the repo; `--max-turns` capped; output schema-validated (`--output-format json`) before anything is written — a malformed or tool-refusing run produces *no* findings rather than garbage findings (mistake-class #5: absent evidence is not passing evidence).

## 8. Cost controls

- **Tier 0 costs nothing** and answers most questions. A healthy week = 5 snapshots, 0 LLM calls until Sunday.
- **All LLM work runs as `claude -p` on the Mac under the Pro subscription** — same pattern as the companion executor, $0 API. Every call pins `--model sonnet` (Sonnet 5, via `SYSLOOP_MODEL`); Opus/Fable are Max-tier and unnecessary for this loop. If a run must fall back to API (Mac away for days), triage uses Haiku and the weekly stays on Sonnet (per the Jordan cost-guardrails rule: rate-limit anything agent-shaped).
- **Hard rate caps in Redis:** `pm:sysloop:triage:<date>` (1/day), `pm:sysloop:weekly:<isoweek>` (1/week), monthly meta 1/month. The scripts check-and-set before invoking anything.
- **Evidence budget:** the summarizer truncates the Analyst's input at ~4k tokens (top clusters, anomaly delta only — never full snapshots) and the Researcher's at ~12k. Deterministic pre-summarization, not "the model will skim."
- **Delta-driven:** the Analyst runs only when `newAnomalies > 0`. No news is no tokens.
- **Weekly deep vs. daily light** is structural: dailies are deterministic + at most one small triage; all reasoning-heavy work batches into Sunday when markets are closed and nothing competes.

## 9. File / module layout

```
portfolio-manager/
  jobs/system-sentinel.js          # Tier 0 daily job (Jetson cron 18:15 ET Mon–Fri)
  lib/sysloop/
    checks.js                      # pure check functions (unit-tested)
    fingerprint.js                 # normalization + hashing for clusters/findings
    snapshot.js                    # gather inputs, assemble/store snapshot
    findings.js                    # ledger read/write/dedupe/recurrence
  scripts/
    sysloop-triage.mjs             # Tier 1 Analyst (Mac, claude -p, daily-conditional)
    sysloop-weekly.mjs             # Tier 2 Researcher + Skeptic (Mac, Sunday)
  tests/sysloop.test.js
  ops/
    health/                        # daily snapshots (gitignored, last 30 kept)
    findings/                      # git-tracked finding files
    reports/                       # weekly product-health reports
    proposed-patches/              # *.diff for Sam to git-apply
    proposed-tests/                # failing-test skeletons
```

Mac PM2: new process `portfolio-sysloop` (thin cron wrapper invoking the two scripts on schedule), deployed like `portfolio-executor` — working tree is the deploy. Dashboard repo gets nothing in v1 (the `/system` page is v2). Scheduler instrumentation is the only touch to existing files: a `wrapJob(name, fn)` in `scheduler.js` — additive, inside the existing job try/catch discipline.

## 10. Test plan & success criteria

**Unit:** every check in `checks.js` takes injected inputs → deterministic finding output; fixtures for healthy/degraded/broken states. Fingerprint stability tests (same error, different timestamp/id → same hash).

**Fault injection (staging-style, run once before trusting it):**
- Stop `portfolio-executor` → companion-staleness finding next snapshot; approved-proposal variant fires within 30 min during market hours.
- Rename a Holdings header in a copy sheet → schema-drift P1.
- Seed a fake `Pending` proposal 3 days old → approvals-flow finding.
- Write a novel error line into the PM2 log → new-cluster finding with correct fingerprint.
- Unset `TELEGRAM_BOT_TOKEN` in a local run → `/health` dep false → P1 (and confirm it fails closed, not silent).
- Feed the Analyst a prompt-injection-shaped log exemplar → confirm findings are schema-validated and nothing outside `ops/` was written.

**Success criteria:**
- *2 weeks:* every trading day has a snapshot; zero missed-cron false positives on holidays (or the holiday gap becomes the loop's first patch proposal); noise budget ≤2 dismissed findings/week, else thresholds get tuned before adding checks.
- *30 days:* ≥3 loop-originated improvements merged by Sam (a patch, a test, a doc fix all count); ≥1 real incident caught by the loop before Sam noticed it himself; weekly reports exist for every week and read cleanly enough to show a technical friend.
- *Always:* zero writes outside the declared surface; zero LLM calls beyond the rate caps; zero API dollars in a normal week.
- *The meta-signal (v2):* the loop's precision (findings Sam acts on ÷ findings raised) trends up — the same calibration discipline the investing loop applies to its agents, applied to the loop itself.
