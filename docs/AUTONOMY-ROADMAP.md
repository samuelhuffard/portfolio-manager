# Autonomy Roadmap — North Star

**The goal:** an agent that trades its mandate fully autonomously — discovers across the entire market, researches deeply enough to act with confidence, and executes without Sam's per-trade approval — earning that autonomy from evidence, not optimism.

**How to use this doc:** this is the project's north star for future sessions. Before starting significant work, find the current phase (check the Status lines), verify its entry criteria are actually met against live state, and work on THAT phase. Resist skipping ahead — each phase's exit criteria are the next phase's foundation. When a phase completes, update its Status here in the same commit as the work.

**What never changes, in any phase** (see `INVARIANTS.md`; these survive full autonomy):

- Nothing upgrades: risk engine, evaluator, conviction, breaker can only block/shrink/downgrade.
- Everything fails closed: missing config, unparseable model output, absent fields → refuse, loudly.
- Deterministic gates before expensive AI; deterministic checks after.
- Untrusted text is fenced before any model sees it.
- Money math lives in pure, tested `lib/` functions.
- Ledgers are append-only and signed; execution ordering (`Executing` → order → ledger → fulfilled, `ref_id` = proposal id) is never reordered.
- Autonomy changes the *approver*, never the *pipeline*.

---

## Phase 0 — Full-market discovery funnel ✅ SHIPPED 2026-07-05 (`bc7dbb7`)

Catalog (nightly NYSE/NASDAQ listing + quotes + paced sector enrichment) → philosophy screen → daily slate (holdings → movers → ranked → exploration) → 12-review AI budget → research ledger memory. Agent-1 on `source: catalog`; watchlist is loud fallback only.

**Status: deployed, enrichment converging (249/4392 on night one).**

## Phase 1 — Prove the funnel at full width (~2–4 weeks of runtime, near-zero build)

The discovery machinery must be *observed* working before deeper layers are built on it.

Exit criteria (all from live evidence, not code reading):

- Sector enrichment plateaus (≥90% of catalog enriched; `/health` `universe.sectorEnriched`).
- Screened pool reaches steady state (expect low hundreds for the tech mandate) and the 5:15pm slate log shows all four buckets populating daily.
- Exploration rotation demonstrably cycles: research ledger accumulates names/week ≈ budget minus holdings/movers, with no ticker starving the rotation.
- Research cooldown observed working (a HOLD is not re-reviewed within 14 days except via movers).
- Evaluator rejection rate is neither 0% (too soft) nor so high that nothing ever reaches the queue — track weekly via the scorecard.
- No missed crons (`pm:job:universe-refresh:last-run` fresh every weeknight).

Build items allowed in this phase: observability only (e.g., surface slate composition + ledger coverage in the dashboard or weekly review). No pipeline changes.

## Phase 2 — Stage-2 deep dossier loop (the confidence gap)

**Why this is the binding constraint:** proposal-time analysis today is one pass at headline depth (quant + 3 Tavily headlines + filing *titles* + macro). The evaluator correctly rejects theses the system cannot evidence (see the MU rejection, 2026-07-05: right verdict, but the system *couldn't* have verified the claim either way). Full autonomy needs evidence depth, not more trust. This was deferred by design in `LOOP-DESIGN.md` §7 — build it here.

Spec (two-stage research; stage 1 is the existing scan, unchanged):

- **Trigger:** stage-1 output of BUY/SELL intent (before the evaluator) promotes the ticker to a dossier pass. HOLDs never pay for depth.
- **Evidence fetch (deterministic):** EDGAR full-text sections (MD&A, risk factors, latest 10-Q/10-K financial highlights) via `lib/edgar.js` extension; earnings surprise history (`fetchEarningsSurprise` exists); analyst trend + insider activity (already fetched, currently underused); optionally transcript/news beyond headlines (Tavily full-content mode). ALL of it through `sanitizeEvidenceItems` fencing — no exceptions.
- **Dossier (one structured LLM call):** bull case, bear case, variant view vs. consensus, each claim carrying an `evidenceId` pointing at a fetched item. Claims without an evidenceId are auto-prefixed UNVERIFIED and cannot support the action (extends the existing rule).
- **Evaluator upgrade:** grades the dossier against its evidence list — "is every load-bearing claim evidenced?" becomes checkable instead of judgment. Downgrade-only, fail-closed, one revision max: unchanged.
- **Persistence:** dossier stored (Redis, TTL ~90d, keyed `pm:dossier:<agentId>:<ticker>:<date>`), linked from the proposal's rationale so the approval queue (and later, the audit trail of an autonomous trade) shows the full case. Research ledger entry gains `dossierRef`.
- **Cost control:** dossiers only on actionable intents (historically 0–5/day), hard daily cap (config key, consumed-verified), Opus for the dossier evaluator only if scan volume stays low.

Exit criteria: ≥2 weeks where every queued proposal carries a dossier; evaluator critiques cite evidenceIds; Sam's subjective read is that proposals are decision-grade without him doing his own research.

**Status: not started.**

## Phase 3 — Enforcement completeness (a machine can't be trusted with rules a human was silently covering)

The human gate currently absorbs every gap between what the mandate *says* and what code *enforces*. Close the gaps before measuring autonomy readiness:

- Config-claims audit: every key in `risk-limits.json` either enforced in code or deleted (`rebalanceFlagPct`, `maxCashReservePct`, etc. are known dead). Grep-consumed check per CHANGE_MAP rule.
- Memo-vs-code audit: every clause in `AGENT-ONE-PLAN.md` entry gates maps to a named code check (e.g., "≥2 kill criteria" — code historically accepted 1).
- Ledger verify-on-read: HMAC verification wherever ledgers are *read* for decisions, not just the nightly job.
- Agents 2/3 decision: either give them real mandates + the same gate parity as agent-1, or disable their scans. A mandate-less agent proposing trades is noise in the autonomy data.
- Alerting completeness: every dropped OUTPUT path Telegrams (re-audit against mistake class #1); a silent failure under autonomy is an unbounded loss window.

Exit criteria: a written pass over memo + configs with zero unenforced claims; tests for each newly enforced gate.

**Status: not started.**

## Phase 4 — Autonomy readiness measurement (no build beyond metrics; the phase IS the data)

The gate is retired from evidence. The metric: **agreement rate** — of proposals where generator proposed and evaluator APPROVED, what fraction did Sam also approve, and did Sam ever approve something the evaluator rejected?

- Add agreement tracking to the weekly scorecard (approve/reject splits already exist; add the conditional-on-evaluator cut).
- Also track matured outcomes: 30d hit-rate and alpha of Sam-approved vs. Sam-rejected proposals. If Sam's rejections aren't adding alpha over the evaluator's, the gate is provably redundant.
- Readiness threshold (proposed, revisit when data exists): ≥8 consecutive weeks of ≥95% agreement on evaluator-approved proposals, ≥20 decisions in sample, zero evaluator-rejected proposals Sam overrode to approve, and no breaker tier ≥ REDUCE during the window caused by agent trades.

Exit criteria: the threshold met, or a documented decision that it wasn't and why (that's a Phase 2/3 regression signal, not a failure).

**Status: not started — data collection effectively began when the evaluator shipped (2026-07-02).**

## Phase 5 — Graduated autonomy (the only phase that touches INVARIANTS.md)

Never binary. Sequence, each step gated on weeks of clean history at the prior step:

1. **Auto-execute small BUYs:** evaluator-APPROVED proposals below a dollar cap (start ~$250) execute without approval; everything above still queues. SELLs still queue (exits are already automated via the exit monitor's separate path).
2. **Raise the cap stepwise** ($250 → $1k → position-sizing limit) on clean history.
3. **Auto-execute ordinary SELLs** under the same regime.
4. **Full autonomy** with Sam on notification-only (Telegram per trade, daily digest, weekly review unchanged).

Non-negotiable design constraints for the executor change:

- This revises invariant #1 — the change MUST update `INVARIANTS.md`, `read-only-broker.test.js` expectations, and the three proposal-schema copies deliberately and in one reviewed change. It is a project, not a patch.
- The signing discipline stays: an auto-approved proposal gets a *system* HMAC signature (new key, distinct from Sam's approval key) so the executor still refuses unsigned work and the audit trail distinguishes human from system approvals.
- Kill switches, pre-wired and tested BEFORE step 1: breaker tier ≥ REDUCE pauses all auto-execution (queue-only mode); a Telegram command and a dashboard toggle both flip the system back to human-gate instantly; auto-execution has a daily dollar budget and a max-trades/day cap.
- Any reconciliation mismatch, ledger verification failure, or evaluator-bypass detection → immediate fallback to human gate + Telegram.

**Status: not started. Do not begin any part of this phase without Sam explicitly initiating it in-session.**

---

## Standing guidance for sessions using this doc

- Verify phase status against live state (health endpoint, Redis, logs, scorecards) before building — statuses here are point-in-time.
- Read `CHANGE_MAP.md` for the files each change touches; `portfolio-manager-code-lessons` memory for the mistake classes.
- Prefer finishing the current phase's exit criteria over starting the next phase's build.
- Cost discipline: every new LLM call gets a consumed, budget-style config cap (Sam's standing guardrail).
- When Sam asks "can it trade on its own yet?", the answer is this doc's Phase 4 metrics — pull the real numbers.
