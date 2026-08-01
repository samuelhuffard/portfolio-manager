# Observation-Week Offline Release Plan

**Status:** execution plan for local/offline preparation; no deployment authority  
**Window:** the five Phase 0 observation trading days following the 2026-07-20 parity release  
**Base:** `f36b388` (`main` / `mandate-v3`)  
**Primary authority:** [portfolio-master-plan.md](portfolio-master-plan.md)  
**Strategic context:** [HIGH-LEVERAGE-EXECUTION-PLAN.md](HIGH-LEVERAGE-EXECUTION-PLAN.md)
**Substantive delivery standard:** [SUBSTANTIVE-OFFLINE-EXECUTION-PLAN.md](SUBSTANTIVE-OFFLINE-EXECUTION-PLAN.md)

## 1. Purpose and release boundary

By the end of the five-day observation window, prepare **one coherent offline
integration branch** that can be pushed for review without changing the system being
observed. The branch must be a clean, reviewable answer to the next questions—not a
grab bag of speculative features.

The desired result is a single Git review surface containing documentation, contracts,
fixtures, pure local tools, and review evidence that prepare the next releases. It is
**not** authorization to deploy every item in that surface together.

The release train deliberately separates three classes:

| Class | May be included in offline integration branch | Deployment rule after observation |
| --- | --- | --- |
| **D / R2** — docs, fixtures, pure contracts, disconnected local tooling | Yes, after tests and independent review | May be pushed together; deploy only if proven inert or explicitly approved |
| **R1** — research policy / evaluator / evidence behavior | Yes, only with cohort and measurement documentation | Declared research release; new SKILL cohort; must state whether it can only reject more or could change approvals |
| **S1 / S2** — signing, money, observer, receipts, breaker, financial cutover | Design and release dossiers only | Separate independently reviewed safety release with explicit reset and rollback; never bundled as convenience work |

The offline integration branch is a **candidate**, not a production branch. Its merge,
push, and deployment decisions remain separate.

The W0–W5 artifacts below are control foundations. The linked substantive plan sets
the higher end-of-week evidence bar; a template or dossier is not completion by itself.

## 2. Non-negotiable constraints

During the observation window, this plan must not:

- modify `mandate-v3`, `main`, Jetson, dashboard, companion, production Redis,
  Sheets, Postgres, broker state, secrets, feature flags, cron, PM2, or migrations;
- invoke a production Anthropic key, a paid vendor, or a live broker/data workflow;
- create, mutate, approve, sign, execute, reserve cash for, or expire a real proposal;
- claim an offline fixture, local test, or synthetic receipt is an organic research
  sample or a Phase 0 observation day;
- lower a mandate/evaluator/risk threshold to create a proposal; or
- stage `node_modules`, `.env`, credentials, private task transcripts, or unrelated
  worktree changes.

Every packet must run deterministically from fixtures or dependency injection. If work
needs a live state, a paid call, a secret-bearing environment, or a production write,
it is not a week-of-observation packet.

## 3. Release-train topology

### Planned branch structure

1. Start an integration branch from `f36b388`, tentatively named
   `observation-week-release-2026-07-21`.
2. Bring in only reviewed Phase 1 commits `29cc003` and `2afc519`, then the planning
   documents currently staged in the isolated Phase 1 worktree.
3. Treat `fbe96f9` (pure proposal-quality shadow harness) as a candidate packet,
   not an automatic cherry-pick. Re-run its tests, inspect imports, and integrate it
   only if it remains fully disconnected from network, models, Redis, Sheets,
   proposals, signatures, and schedulers.
4. Do **not** wholesale merge `portfolio-manager-observation-offline`; it predates the
   parity baseline and has an incompatible history. Recover a specific artifact only
   after a file-level comparison against `f36b388` and current parity behavior.
5. Keep `f0cad09`'s fresh-data MU script out of this integration branch unless it is
   changed to fixture-only or receives a separate, non-production credential/cost
   decision. A script that calls live data and models is not observation-safe merely
   because it avoids Redis and proposals.
6. Treat `f93f188` cadence documentation as optional. Include it only if it remains
   documentation-only and does not alter a scheduled job, observer expectation, or
   policy gate.

### Integration rule

No commit enters the integration branch merely because it already exists locally. Each
candidate needs a packet owner, change class, allowed inputs, tests, expected output,
and stop condition in the table below.

## 4. End-of-week deliverables

### W0 — Release control and documentation reconciliation

**Class:** D  
**Owner:** primary reviewer  
**Outcome:** one source of truth for what the offline branch contains and what it
does not authorize.

- Keep the master plan, high-leverage plan, research roadmap, autonomy roadmap,
  execution guide, and Phase 1 baseline mutually consistent.
- Record the parity release as the live baseline: equal workflow/trust for Agents
  1–3; different mandates/horizons; Agent 4 shadow-only; five-day observation.
- Add this document to the master-plan supporting-document index.
- Create `docs/OBSERVATION-WEEK-RELEASE-NOTES.md` before review freeze. It must list
  every included commit/file, class, runtime impact, test command, rollback posture,
  excluded candidate, and post-observation decision.
- Maintain a simple candidate manifest with `included`, `held`, or `rejected` status
  and reason. No undocumented file lands in the final branch.

**Control records:** [candidate manifest](OBSERVATION-WEEK-CANDIDATE-MANIFEST.md)
and [draft release notes](OBSERVATION-WEEK-RELEASE-NOTES.md). These remain living
records until the Day 5 review freeze.

**Acceptance:** Markdown links resolve; no stale current-state claims remain; no plan
silently changes a master gate; `git diff --check` is clean.

### W1 — Phase 1 policy and mandate-freeze packet

**Class:** D / Phase 1 preparation  
**Owner:** Sam + investing partner for choices; builder for schemas/fixtures  
**Outcome:** a future engineer can encode mandates without guessing.

- Preserve the existing Q-001–Q-004 worksheet and add a decision-record template:
  exact rule, source hierarchy, exception, owner/date, policy version, affected
  mandate, and required regression fixture.
- Produce a compiled mandate specification template for each specialist. It must
  distinguish: shared workflow invariant; universe eligibility; ranking/valuation;
  evidence criticality; freshness; entry/abstention/exit; horizon/benchmark; risk;
  special-sector substitutions; and known unresolved fields.
- Add a workflow-parity versus mandate-divergence matrix. A testable invariant must
  show that Agents 1–3 have equal discovery/evidence/evaluator/risk/ownership power,
  while a distinct test fixture shows their accepted policy can produce different
  rankings or abstentions on the same dated evidence.
- Keep unresolved policy as explicit `unavailable` / `non_actionable`; no default
  EBITDA, consensus, quote freshness, or 13F rule may be invented.

**Acceptance:** all three templates compile from the same schema; every open policy
appears once in the decision register/worksheet; no source file modifies live mandate
or scoring behavior.

**W1 artifacts:** [compiled mandate specifications](PHASE-1-COMPILED-MANDATE-SPECIFICATIONS.md)
and the expanded [policy worksheet](PHASE-1-POLICY-WORKSHEET.md).

### W2 — Measurement, Bench-30, and golden-set freeze

**Class:** D / R2 local-only  
**Owner:** research lead + independent reviewer  
**Outcome:** the next research release can be judged rather than merely observed.

- Define versioned schemas/fixtures for:
  - `QualifyingSetup`, `OrganicProposal`, `ResearchExclusion`, and
    `GeneratorDegraded`;
  - per-stage margin/terminal-reason telemetry;
  - blind-grading rubric and reviewer output; and
  - golden-set slot, decision time, retrieval receipt, expected facts, source tier,
    restatement/corporate-action state, and expected missingness.
- Create a 30-slot golden-set manifest with no current vendor results. Include normal
  operating companies, banks/insurers/REITs, thin coverage, stale estimates,
  restatements, share-class/corporate-action traps, and negative cases.
- Add chronology validators that reject `retrievedAt > decisionTime`, future facts,
  missing source tiers, mutable fixtures, and mixed policy versions.
- Review the proposal-quality shadow harness (`fbe96f9`) against this schema. If it
  passes the disconnect audit, integrate it as a fixture-only local diagnostic;
  otherwise hold it and document why.
- Do not run live model or vendor comparisons this week. The weekly artifact is the
  harness and frozen corpus, not a performance result.

**Acceptance:** fixture-only tests prove good evidence can be `review_ready`, weak or
misclassified evidence blocks, and time travel fails closed; every report labels itself
synthetic/local and non-promotional.

**W2 artifact:** [Bench-30 and golden-set freeze](BENCH30-AND-GOLDEN-SET-FREEZE.md).

### W3 — Proposal-lineage freeze packet

**Class:** D / high-risk design preparation  
**Owner:** primary reviewer + security/cross-repo reviewer  
**Outcome:** Phase 5 has a frozen, reviewable cutover specification rather than an
implementation-by-accident.

- Extend the existing five-source inventory test so a new proposal source cannot be
  introduced without a declared `ResearchIntent` source and compiler-routing plan.
- Write `docs/PROPOSAL-LINEAGE-V2-FREEZE.md` containing:
  - byte-level signature-v2 payload and canonical serialization reference;
  - strategy/evidence/allocation record invariants;
  - v1 read compatibility and exact outstanding-v1 disposition procedure;
  - backend/dashboard/companion reader-before-writer order;
  - source-by-source migration order and rollback;
  - required contract, forged-lineage, ownership, idempotency, and fill tests; and
  - explicit no-go conditions.
- Cross-check ADR 0004 against the current dashboard/companion paths without editing
  either repository. Record mismatches as an integration checklist, not a local
  workaround.
- Produce an ownership-audit protocol for open lots and unresolved inventory. It may
  use synthetic fixtures; it must not query or mutate production ledgers this week.

**Acceptance:** no ambiguity remains about v2 signature bytes or source order; no v2
writer or migration is added; all five proposal paths are represented; the packet is
ready for independent cross-repo review.

**W3 artifact:** [proposal-lineage v2 freeze](PROPOSAL-LINEAGE-V2-FREEZE.md).

### W4 — Agent 4 shadow-policy packet

**Class:** D / Phase 1 preparation  
**Owner:** Sam + investing partner for choices; builder for contracts/fixtures  
**Outcome:** Agent 4 can be evaluated in shadow later without stealth authority.

- Create a versioned policy worksheet/schema for objective, virtual strategy budgets,
  allocation caps, concentration/conflict handling, regime inputs, freshness,
  explanation, cadence, abstention, demotion, and rollback.
- Lock the negative boundary in both prose and fixtures: no origination, amendment,
  forced sale, order authority, approval key, or bypass of specialist-owned SELL lots.
- Define a paired shadow-record format: immutable specialist proposal fingerprint,
  portfolio/risk snapshot ID, policy version, Agent 4 decision, reasons, virtual
  allocation effect, and Sam's independent decision/outcome label.
- Add synthetic conflict fixtures: duplicate thesis, concentration breach, stale
  portfolio snapshot, unowned SELL, budget exhaustion, and disagreement with Sam.

**Acceptance:** every fixture either fails closed or yields an explainable shadow-only
decision; no scheduler, API write route, approval path, or broker import is added.

**W4 artifact:** [Agent 4 shadow policy packet](AGENT-4-SHADOW-POLICY-PACKET.md).

### W5 — Trust-hardening release dossiers

**Class:** D now; separate S1/S2 candidates later  
**Owner:** security/money-path reviewer  
**Outcome:** the largest-capital blockers are specified precisely enough to review and
release one at a time after observation.

Prepare four dossiers, each with scope, threat, exact affected keys/records, proposed
contract, migration/rollback, test matrix, production evidence, and clock effect:

1. **Authenticated operational evidence:** bind critical upstream observation inputs
   (receipts, heartbeats, job history, restart baseline) to authenticated,
   replay-resistant records before the final observer attestation.
2. **Operational-key retirement:** dedicated-key-required signing, cutover epoch,
   historical legacy scope, re-sign/attestation procedure, and tested fallback removal.
3. **Fresh valuation controls:** content-bound quote freshness for breaker, sizing,
   concentration, and cutover parity; stale input becomes UNKNOWN and blocks new BUYs.
4. **Financial-truth cutover:** signed capital-flow performance attribution plus an
   event/drill-based Postgres cutover gate, named divergence arbiter, auto-freeze,
   rollback, and provider-native recovery requirement.

**Acceptance:** each dossier can be classified independently as S1 or S2 before any
code exists. None is merged into an R1 proposal-quality release.

**W5 artifact:** [trust-hardening release dossiers](TRUST-HARDENING-RELEASE-DOSSIERS.md).

## 5. Observation-day schedule

The schedule is expressed as observation days rather than calendar dates. If a day
fails or the observation window resets, continue offline work but do not compress the
review or deployment gates.

| Observation day | Primary offline focus | Required end-of-day artifact |
| --- | --- | --- |
| **Day 1** | W0 branch manifest; W1 decision/template structure; inspect candidate branches | Candidate manifest and clean working boundaries |
| **Day 2** | W2 Bench-30/golden-set schemas and chronology tests | Frozen draft corpus with no live/vendor result |
| **Day 3** | W3 lineage-v2 freeze and ownership-audit protocol | Cross-repo compatibility checklist and no-go list |
| **Day 4** | W4 Agent 4 policy/paired-shadow fixtures; W5 dossier drafts | Shadow-only policy packet and four classified safety dossiers |
| **Day 5** | Integrate reviewed D/R2 packets; full verification; independent review prep | Release notes, final manifest, test evidence, held-items list |

This is a dependency order, not permission to skip review. W1 policy answers may remain
pending; in that case, ship only the template and explicit blockers, never a guessed
implementation.

## 6. Candidate inclusion matrix

| Candidate | Planned disposition | Conditions |
| --- | --- | --- |
| Phase 1 baseline / source inventory (`29cc003`, `2afc519`) | Include | Tests pass; inventory remains five-source complete |
| High-leverage / planning reconciliation | Include | Links, authority hierarchy, and stale-status scan pass |
| Proposal-quality fixture harness (`fbe96f9`) | Conditional | Import/disconnect audit, fixture-only tests, no paid/live inputs |
| Fresh-data MU review (`f0cad09`) | Hold by default | Fixture-only rewrite or explicit separate non-production data/model budget decision |
| Cadence planning docs (`f93f188`) | Conditional | Docs-only; no scheduler/observer/policy change; no contradiction with this plan |
| Observation-offline branch | Exclude as a bulk source | Specific artifact may be re-derived only after parity-base comparison |
| Signature-v2 writers/migrations | Exclude | Phase 5 coordinated release only |
| Agent 4 runtime decisions | Exclude | Phase 4 shadow activation only after policy/version gates |
| Operational signing / receipt / breaker / Postgres changes | Exclude | Separate S1/S2 release after independent review |

## 7. Final integration and review checklist

Before the integration branch is offered for push/review:

1. Rebase or recreate it from the approved `f36b388` baseline; do not merge a dirty
   production checkout.
2. Run `git diff --check`, a secret/path scan, the full backend suite, and focused
   tests for every included packet.
3. Run a fixture-only disconnect audit: no included local harness may import or call
   scheduler, server, Redis, Sheets, Postgres, broker, approval, signature, or live
   model/vendor clients.
4. Validate Markdown links and compare master/research/autonomy/guide claims for
   phase, authority, five-day window, parity baseline, and Agent 4 boundaries.
5. Search all proposal writers. Confirm the inventory is complete and that no new
   direct writer is introduced by this branch.
6. Review every diff against the candidate manifest. Remove unrelated files,
   `node_modules`, environment files, generated runtime data, and duplicate branch
   artifacts.
7. Obtain an independent review focused on: policy leakage, time leakage, hidden
   authority, cross-repo assumptions, signature ambiguity, and accidental production
   imports.
8. Publish release notes that distinguish `pushed for review`, `merged`, `deployed`,
   and `gate passed`. They are never synonyms.

## 8. End-of-week decision gate

At the end of the observation window, make these decisions in order:

1. **Observation verdict:** read the signed observer record. If Phase 0 is not clean,
   do not treat the offline branch as a substitute; retain the branch and continue
   the safety window under the master plan.
2. **Offline branch verdict:** accept only D/R2 packets that passed the checklist.
   Push the integration branch for review if clean; otherwise keep it local.
3. **R1 release decision:** select at most one research behavior package. State its
   exact cohort effect and whether it is strictly-more-reject versus potentially
   approval-changing. The latter needs its own A/B evidence and review.
4. **S1/S2 decision:** choose zero or one separately reviewed trust dossier only if
   the risk justifies a reset. Never attach it to R1 merely to save a deployment.
5. **Human-policy decision:** accepted Q-001–Q-004 answers unlock only their named
   mandate work. Pending answers remain visible blockers.

## 9. Definition of done for this week

The week is complete when all of the following are true:

- one clean offline integration branch and candidate manifest exist;
- every included packet is D/R2, fixture-only, test-backed, and reviewable;
- W1–W5 artifacts exist with unresolved human choices visibly pending rather than
  silently encoded;
- no S1/S2 code, signature-v2 writer, migration, Agent 4 authority, vendor intake,
  or production-facing schedule has entered the branch;
- the proposal-quality harness is either safely integrated or explicitly held;
- release notes explain the post-observation decision tree; and
- the signed observation record—not the offline work—determines whether Phase 0
  advanced.
