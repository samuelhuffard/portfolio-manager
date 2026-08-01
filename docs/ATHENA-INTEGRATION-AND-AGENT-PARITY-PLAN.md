# Athena Integration and Agent-Parity Plan

> **Status: approved planning direction only. No implementation, activation,
> deployment, authority expansion, or data purchase is authorized by this file.**

**Plan date:** 2026-07-15 ET  
**Athena source reviewed:** [`Cubanso24/stock-llm@483a68b`](https://github.com/Cubanso24/stock-llm/tree/483a68b9cddcea9efe08be05b65d910903c6a324)  
**Primary label:** SKILL, with TRUST requirements at the service, provenance,
freshness, and proposal-lineage boundaries

## 1. Decision

Portfolio Manager should **not build a competing Athena from scratch**. Athena
should be evaluated as the shared public-company research platform for all three
specialist agents, while Portfolio Manager remains the authority for:

- the three specialist mandates and mandate-specific judgment;
- current portfolio, lots, cash, ownership, and broker truth;
- deterministic risk limits and sizing ceilings;
- the independent proposal evaluator;
- immutable proposal lineage, human approval, execution, and reconciliation; and
- cross-agent capital allocation through Agent 4.

The target is one strong research substrate feeding three equally capable
specialists. The specialists differ in what they seek, how long they expect to
hold it, how they value it, and what invalidates it. They do not differ in access
to research, discovery, evidence quality, workflow rigor, or proposal safeguards.

## 2. Why the conclusion changed after reviewing Athena's source

Portfolio Manager's current integration makes Athena look like a small optional
dossier. The underlying repository is substantially more capable. At the reviewed
commit it contains roughly 100,000 lines of Python, 145 commits, 110 test modules,
and more than 300 declared tests. Source inspection found:

- PostgreSQL-backed prices, filings, filing documents, financial snapshots and
  history, consensus, peer, positioning, underwriting, decisions, predictions,
  forecasts, guidance, outcomes, post-mortems, RAG, and training records;
- SEC filing hydration, XBRL financial facts, Form 4 parsing, transcripts and
  prepared remarks, company/IR documents, macro data, news, consensus, peers,
  short interest, candidate sourcing, and full deep dives;
- specialist analyses for underwriting, business quality, product/moat,
  competition, leadership, management communication, capital allocation,
  catalysts, filings, news, macro, valuation, and red-team review;
- deterministic multi-method valuation, CAPM/WACC and consensus-derived inputs,
  reverse DCF, peer comparisons, a seeded Monte Carlo value distribution, and
  explicit missing-input/confidence handling;
- claim/evidence safeguards, falsifiable theses, kill criteria, prediction and
  forecast ledgers, benchmark-relative outcome grading, shadow null strategies,
  confidence calibration, post-mortems, learned lessons, and an earned autonomy
  ladder; and
- a read-only, token-protected agent boundary that explicitly excludes trading.

This is not merely a scraper or one valuation model. It is an institutional-style
public-equity research workflow with a meaningful accountability loop.

Sam also reports that Athena's owner is paid to provide the system to a working
hedge-fund professional and that it performs a substantial portion of that user's
public-company research. That is meaningful external-use evidence and a reason to
take the integration seriously. It is not, by itself, proof of Athena's current
runtime coverage, data correctness, or investment edge in Portfolio Manager's use
case; those still require the gates below.

### The integration mismatch

Athena internally builds a full investment case containing financial facts,
valuation cases and assumptions, methodology, underwriting, case sections,
evidence IDs, source documents, deep-dive results, and exported case workbooks.

Portfolio Manager currently calls `GET /api/agent/ticker/{ticker}`, whose partner
payload is intentionally reduced to:

- a compact decision;
- headline valuation;
- short underwriting summary and bear case;
- peer summary;
- insider/short positioning; and
- next earnings date.

Portfolio Manager then converts at most six sections into opaque text capped at
500 characters per section before placing them in the generator prompt. This is a
safe initial adapter, but it consumes the conclusion layer rather than Athena's
research process, evidence graph, methodology, or accountability record.

**Revised assessment:**

| Option | Current fit | Verdict |
| --- | ---: | --- |
| Athena as a shared, versioned research substrate | **9/10** | Preferred direction after contract and runtime validation. |
| Existing compact Athena adapter | **3/10** | Safe but far too lossy to deliver Athena's real value. |
| Build a separate Portfolio Manager “Athena” | **3/10** | Duplicates a mature system and creates two drifting research platforms. |
| Copy Athena code directly into Portfolio Manager | **4/10** | High coupling, language/runtime mismatch, ownership risk, and expensive merge burden. |

The score required for activation is **8/10 after observed contract, data-quality,
freshness, latency, coverage, and lineage evidence**. Source sophistication alone
does not satisfy that gate.

## 3. Important limits discovered in the source review

Athena's depth does not mean Portfolio Manager should blindly trust every output.

1. **Source quality is mixed.** SEC filings and Form 4 data are strong primary
   sources, but consensus, peers, short interest, portions of financial fallback,
   and some market data still use Yahoo Finance; news uses NewsAPI/RSS. Athena's
   analytical workflow is deeper than its weakest upstream source.
2. **Its action language is not our mandate language.** Athena's `ADD`,
   `WATCH_ADD`, and `PAUSE_BUY` logic includes Athena watchlist floors and ceilings.
   Those conclusions must remain advisory to Portfolio Manager's three mandates.
3. **Its partner endpoint is fail-soft and conclusion-first.** Missing sections
   are omitted rather than failing the request. Portfolio Manager needs explicit
   completeness, freshness, conflict, and methodology metadata before using a
   package as proposal-critical evidence.
4. **Source code is not runtime proof.** Athena's production coverage, backlog,
   freshness, model quality, data gaps, calibration sample, restore health, and
   per-ticker completeness must be measured from its actual runtime.
5. **No repository license was present at the reviewed commit.** Public visibility
   does not grant permission to copy, modify, redistribute, or commercially use
   the code. Sam and Athena's owner should explicitly agree on API use, permitted
   integration, data handling, interface support, and any future code sharing.

These limits argue for a formal service contract and source bakeoff, not for
discarding Athena.

## 4. Target system boundary

```text
Public/company/market sources
            |
            v
  Athena research platform
  - ingestion and normalization
  - full investment case
  - specialist research modules
  - valuation and red team
  - predictions, grading, lessons
            |
            | versioned Evidence Package (read-only)
            v
  Portfolio Manager evidence intake
  - schema/provenance validation
  - freshness and conflict policy
  - point-in-time snapshot + fingerprint
            |
            v
  Shared candidate and evidence bus
       /          |          \
  Agent 1      Agent 2      Agent 3
  short        medium       long
  horizon      horizon      horizon
       \          |          /
            v
  one evaluator / one proposal compiler
            |
            v
  Agent 4 -> Sam -> deterministic execution
```

Athena supplies company research. Portfolio Manager supplies mandate judgment and
portfolio authority. Neither silently owns the other's role.

## 5. What must be equal across Agents 1, 2, and 3

All three agents receive:

- the same eligible-catalog discovery machinery;
- the same holdings, event, catalog, and exploration candidate feeds;
- the same Athena evidence package and access to every underlying evidence class;
- the same point-in-time and provenance contract;
- the same freshness, missing-data, source-conflict, and completeness rules;
- the same claim/citation requirements and fact-vs-inference discipline;
- the same research stages: discover, gather, underwrite, challenge, evaluate,
  compile, observe outcome, and learn;
- the same independent evaluator and one-revision limit;
- the same portfolio/risk/ownership/compiler safeguards;
- protected research capacity so one agent cannot starve the other two; and
- the same performance, calibration, and post-mortem accountability.

Static watchlists may remain priority lists or curated idea inputs. They must not
remain the boundary of Agents 2 and 3 once the catalog, evidence, and lineage gates
pass.

## 6. What should remain mandate-specific

Equal power does not mean identical scoring or identical ideas.

| Agent | Mandate-specific emphasis |
| --- | --- |
| **Agent 1 — short-term/high-velocity** | Growth and estimate acceleration, near-term catalysts, relative volume/liquidity, price structure, runway, fast deterioration, and short re-underwrite/exit windows. |
| **Agent 2 — medium-term momentum** | Trend persistence, relative strength, revision breadth, industry cycle, institutional confirmation, guidance/catalysts, and dead-money opportunity cost. |
| **Agent 3 — long-term compounder** | ROIC and incremental ROIC, FCF conversion, reinvestment runway, balance-sheet durability, moat evidence, management capital allocation, governance, and normalized long-term valuation. |

Mandate adapters may differ in eligible screens, factor weights, thesis-critical
evidence, valuation method, catalyst horizon, entry/exit bars, kill criteria,
position constraints, and re-underwriting cadence. Every agent can still inspect
every evidence class; the mandate determines relevance and required proof.

## 7. Athena Evidence Package contract

Do not merely increase the current text cap. Define a versioned, typed,
point-in-time contract exposed through a read-only partner endpoint. At minimum it
should include:

**Offline contract reference (not runtime wiring):**
`contracts/athena-evidence-package.js` defines `AthenaEvidencePackage-v1` and its
deterministic canonical SHA-256 fingerprint. The companion fixtures validate the
complete, partial, stale, conflicting, failed, unavailable, version-drift, and
provenance-failure paths without calling Athena or Portfolio Manager runtime code.
This freezes a local acceptance shape only; it does not establish a partner endpoint
or permission to ingest, store, or use Athena data.

The unresolved production choices remain deliberately explicit: Athena owner
permission/license and data-handling terms, stable endpoint/version-change support,
actual source coverage/freshness/latency, retention/restore semantics, and the
mandate-specific role of each evidence field. The contract therefore carries facts
and analytical provenance but no action, approval, sizing, proposal disposition,
order, execution, or Portfolio Manager authority.

### Identity and versions

- ticker, CIK, exchange, share class, currency, and corporate-action identity;
- Athena source revision, methodology version, model routes, and package schema;
- immutable package ID/fingerprint and generation timestamp;
- research-run ID and the last successful refresh for each module.

### Source facts and provenance

- financial facts and history with units, periods, filed/available/retrieved times;
- consensus and revision data with contributor count and snapshot age;
- prices, liquidity, corporate actions, and quote timestamps;
- filings, transcripts, IR documents, news, guidance, insider, short-interest,
  peer, and macro evidence IDs;
- source tier, canonical URL/accession, raw excerpt/value, normalized value, and
  conflict status for every proposal-critical claim.

### Analytical outputs

- full underwriting and specialist modules, including `PARTIAL` reasons;
- bull case, bear case, thesis threats, catalysts, and falsifiable kill criteria;
- every valuation case with inputs and assumptions, not only the final value;
- Monte Carlo distribution and whether each prior came from observed dispersion
  or a documented fallback;
- adversarial verdicts and unresolved objections;
- guidance credibility, predictions, forecast outcomes, and relevant learned
  lessons where sample gates are met.

### Quality metadata

- module-level completeness and freshness;
- missing inputs and failed/deferred acquisition reasons;
- source conflicts and plausibility warnings;
- claim-level support state;
- Athena's stated confidence separately from its earned/calibrated confidence;
- whether the evidence is suitable for discovery, comparison, underwriting, or
  proposal-critical use.

Portfolio Manager stores the exact accepted package or its content-addressed
snapshot in the append-only research record. A later Athena refresh never rewrites
what a proposal knew at decision time.

## 8. Data-source plan: improve Athena, do not duplicate ingestion

Paid data should enter through Athena's ingestion/evidence layer and then reach all
three Portfolio Manager agents through the same package. Portfolio Manager should
not build a second parallel vendor-ingestion stack unless a hard boundary requires
it.

### Free/primary backbone

- SEC EDGAR/XBRL, filings, exhibits, proxies, Form 4, and first-party IR material;
- FRED/ALFRED point-in-time macro vintages;
- company earnings releases, presentations, guidance, and transcripts when
  lawfully available; and
- current market/reference data already used, subject to measured validation.

### Vendor bakeoff before purchase

Use a fixed 30-company golden set covering sectors, company sizes, loss-makers,
share classes, corporate actions, recent earnings, and deliberately conflicting
facts. Compare Athena's present providers against candidate vendors on:

- point-in-time correctness and restatement behavior;
- coverage and missingness;
- estimate age, contributor counts, and revision history;
- transcript/IR provenance and usage rights;
- share-class, split, delisting, and corporate-action accuracy;
- latency, reliability, and historical depth;
- internal/commercial licensing; and
- cost per fully underwritten company.

Start with free trials for FMP and Fiscal.ai. FMP Premium is the first modest paid
candidate if it materially improves fundamentals, calendars, and estimates;
Ultimate should be considered only if transcripts/13F evidence demonstrably
improves decisions. Massive is a targeted market/reference-data candidate.
Intrinio or Quartr become justified only if the cheaper providers fail the golden
set or the project moves into a commercial/institutional budget.

No vendor DCF, rating, AI recommendation, or price target becomes an authoritative
gate. Vendors provide observations; Athena and Portfolio Manager preserve their
own transparent methodology.

## 9. Delivery plan and master-plan crosswalk

### During master Phase 0 — observe, specify, do not activate

Allowed work is documentation, runtime evidence review, permission/licensing
conversation, contract design, and offline source comparison. Keep Athena disabled
in Portfolio Manager production. Do not change live research prompts, candidate
selection, schedules, proposal semantics, or observer coverage.

**Output:** accepted architecture direction, documented ownership boundary, and a
runtime capability/coverage report. This is D/R2 work only while isolated.

### Master Phase 1 — mandates and integration contract

- Resolve Q-001–Q-004 and define thesis-critical evidence per mandate.
- Agree with Athena's owner on permitted API use, data/license boundaries,
  service expectations, versioning, and change notification.
- Freeze `AthenaEvidencePackage-v1` and failure semantics.
- Define the common candidate bus and the exact equal-capability invariant.
- Preserve Athena conclusions as advisory; Portfolio Manager mandates remain
  authoritative.

**Gate:** all three agents have testable mandate adapters and one accepted evidence
contract; no missing investment rule is invented in code.

### Master Phase 2 — durable point-in-time truth

- Expose or add the full read-only evidence-package endpoint in Athena.
- Ingest packages into Portfolio Manager's append-only research store in shadow.
- Record fingerprints, versions, source timing, completeness, conflicts, and
  reruns without changing the live proposal path.
- Prove contract compatibility, idempotency, retention, restore, and source
  chronology.

**Gate:** a stored package can reproduce exactly what every agent saw; missing or
changed sections cannot silently pass as complete.

### Master Phase 3 — coverage and analytical quality

- Run the vendor golden-set bakeoff inside Athena.
- Expand Athena/company evidence coverage across the eligible catalog.
- Give all three agents the same evidence and discovery coverage in shadow.
- Implement mandate-specific evidence adapters and special-sector economics.
- Measure source conflicts, false precision, freshness, completeness, and
  valuation plausibility.

**Gate:** master-plan catalog targets pass; at least 95% is classified, at least
90% is fresh or explicitly unavailable, no special sector uses ordinary-company
economics, and no agent has a structurally weaker input path.

### Master Phase 4 — shared attention in shadow/canary

- Feed one common candidate stream to all three agents.
- Let each mandate rank the stream independently.
- Compare the current workflow, Athena-compact workflow, and full-package workflow
  using research-quality and matured outcome metrics.
- Preserve holdings, mandatory exits, protected capacity, and immediate rollback.

**Gate:** at least 20 clean shadow/canary trading days show improved evidence use
or matured signal without lost holding coverage, unacceptable concentration,
budget overrun, or increased unsupported claims.

### Master Phase 5 — one compiler and complete lineage

- Route all three agents through the same
  `ResearchIntent → AthenaEvidencePackage → EvidenceSnapshot → StrategyProposal`
  lineage inside Portfolio Manager's canonical compiler.
- Bind the package fingerprint, mandate/version, agent-specific analysis,
  evaluator result, kill criteria, sizing, expiry, and SELL ownership to every
  actionable proposal.
- Expand Agents 2 and 3 beyond static watchlists only through the existing reviewed
  catalog canary.

**Gate:** no proposal path bypasses the compiler; every action is reproducible from
one point-in-time package and one mandate; Athena still cannot approve or execute.

### Master Phases 6–8 — earn confidence independently

- Grade each mandate at its correct horizon and benchmark.
- Separate Athena's contribution, the mandate adapter's contribution, the
  evaluator's contribution, and Agent 4's allocation contribution.
- Require sample size, calibration, regime coverage, and post-mortem evidence for
  each agent separately.
- Do not promote all agents merely because one mandate succeeds.

**Gate:** all three agents clear the same process/readiness standard, while each
clears skill gates on its own horizon. Equal power is architectural; earned skill
remains empirical.

## 10. Acceptance metrics

### Equal-capability metrics

- 100% shared evidence classes and discovery channels available to all agents;
- equivalent protected research capacity and failure visibility;
- no static-watchlist-only dependency after the Phase 5 canary;
- identical completeness, citation, evaluator, and compiler standards; and
- separate mandate outcomes with comparable lineage quality.

### Analytical-depth metrics

- 100% of proposal-critical claims trace to evidence IDs;
- zero silent stale, conflicting, missing, or fallback-derived critical inputs;
- valuation cases expose assumptions, methodology, and sensitivity;
- every proposal includes a serious disconfirming case and falsifiable kill
  criteria;
- source and module completeness visible at decision time;
- fewer unsupported-claim and implausible-valuation flags than the current
  compact integration; and
- measurable improvement over the current candidate-selection/research baseline,
  not merely longer reports.

### Operational metrics

- contract/version drift fails closed;
- Athena failure cannot remove holding monitoring or corrupt a Portfolio Manager
  run;
- latency and cost stay inside predeclared budgets;
- source refresh and research completion are independently observable; and
- no Athena endpoint can approve, sign, execute, or mutate Portfolio Manager
  financial state.

## 11. Explicit non-goals

- Do not merge the two repositories.
- Do not copy Athena code without written permission.
- Do not make Athena a fourth investment mandate or let it compete for capital.
- Do not use Athena's watchlist floors/ceilings as Portfolio Manager authority.
- Do not equate report length with research quality.
- Do not buy expensive data before the golden-set test proves the gap.
- Do not activate the deeper integration during the current Phase 0 observation
  window.
- Do not use this plan to promote autonomy or claim investment edge.

## 12. Near-term work program — next two to three weeks

This is the approved target sequence while Phase 0 observes the pinned production
release. Calendar weeks are planning aids, not permission to skip a gate. Work may
move faster or slower, but its order and production boundary remain fixed.

### Operating boundary for the entire period

- Keep the observed production code, schedules, prompts, candidate selection,
  proposal semantics, authority, accounting, and observer behavior frozen.
- Perform roadmap work in an isolated branch or worktree. Commit frequently and
  push the non-production branch for backup only if no deployment automation tracks
  it; do not merge or deploy it during Phase 0.
- Use fixtures, synthetic cases, immutable historical observations, or explicitly
  shadow-only data. Do not write to production ledgers or financial state.
- A validity-breaking TRUST defect may be repaired and deployed through the master
  release protocol, with the required observation reset. Analytical weakness alone
  is recorded and deferred rather than patched into the live cohort.

### Week 1 target — runtime truth, permission, and mandate decisions

1. **Athena owner and runtime packet [BOTH].** Confirm permitted API/code use,
   data-handling boundaries, supported interface expectations, version/change
   notification, and service ownership. Produce a sanitized runtime capability
   report covering actual ticker coverage, module completeness, freshness, backlog,
   latency, failure behavior, calibration/outcome samples, restore status, and cost.
2. **Q-001–Q-004 decision packet [SKILL/BOTH].** Resolve Agent 1 balance-sheet
   definitions, estimate freshness, quote/relative-volume freshness, and the
   optional-versus-thesis-critical role of consensus and 13F evidence. Record the
   accepted answers in the canonical decision register; do not invent defaults in
   code when an answer is still missing.
3. **Equal-agent invariant [BOTH].** Freeze the requirement that Agents 1–3 receive
   the same discovery channels, evidence classes, research stages, evaluator,
   capacity protection, failure visibility, lineage, and accountability. Document
   only the mandate-specific differences: horizon, eligible economics, factor
   emphasis, valuation method, catalyst window, entry/exit bar, kill criteria,
   risk limits, and re-underwriting cadence.

**Week 1 exit:** permission and runtime unknowns are explicit; Q-001–Q-004 are
answered or visibly blocked; no agent's weakness is disguised as a mandate choice.

### Week 2 target — contract and source-quality design

4. **Freeze `AthenaEvidencePackage-v1` [BOTH].** Define the typed, read-only,
   point-in-time contract, including identities, versions, full analytical modules,
   source evidence, valuation assumptions, freshness, completeness, conflicts,
   partial/failure reasons, calibrated confidence, and immutable fingerprint.
   Include valid, partial, stale, conflicting, drifted-version, and unavailable
   fixtures plus fail-closed acceptance rules.
5. **Thirty-company golden set [SKILL].** Predeclare a difficult cross-sector set
   spanning company sizes, special sectors, loss-makers, share classes, corporate
   actions, recent earnings, and intentionally conflicting facts. Define expected
   facts, point-in-time dates, research questions, and scoring rules before looking
   at vendor results.
6. **Vendor bakeoff protocol [BOTH].** Compare Athena's present sources with free
   trials from FMP and Fiscal.ai first, then consider Massive, Intrinio, or Quartr
   only for proven gaps. Measure point-in-time correctness, restatements, coverage,
   estimate age and breadth, transcripts/IR provenance and rights, corporate
   actions, reliability, latency, history, and cost per fully underwritten company.
   Do not purchase a source merely because it provides more fields.
7. **Common candidate-bus design [SKILL].** Define one eligible discovery stream
   available to all agents, with mandate-specific ranking layered after shared
   eligibility. Static watchlists remain priority/curation inputs, not capability
   boundaries.

**Week 2 exit:** the evidence contract and golden-set methodology are reviewable;
every proposed paid source maps to a measured deficiency; agent parity is testable.

### Week 3 or immediately after Phase 0 — offline proof and shadow candidate

8. **Three-way offline comparison [SKILL].** On identical companies and decision
   dates, compare the current Portfolio Manager workflow, the compact Athena adapter,
   and the full package. Grade factual correctness, traceable support, valuation
   plausibility, disconfirming analysis, kill criteria, missing-data honesty,
   unsupported claims, evaluator results, latency, and cost. Report length is not a
   quality metric.
9. **Local full-package intake [BOTH].** Only after permission and contract gates
   close, implement validation and append-only point-in-time storage locally. Prove
   fingerprint stability, idempotency, chronology, contract-drift failure,
   partial-package handling, retention/restore, and complete isolation from holdings
   monitoring and financial state. Feed the identical accepted package to three
   mandate adapters in replay or shadow; do not connect it to live proposals.
10. **Post-Phase-0 release decision [BOTH].** Prepare one independently reviewed,
    shadow-only release candidate. Its first deployment may collect and compare full
    packages, but must not alter live selection, thresholds, proposal compilation,
    evaluator authority, Agent 4 authority, execution, or accounting. Positive
    canary work remains gated by the master Phase 3–4 evidence requirements.

**Near-term definition of done:** the team can show what Athena actually does in
runtime, what it is permitted to expose, exactly what all three agents receive,
which differences are mandate-specific, where current sources are deficient, and
whether the full package improves research quality offline. This period does not
end with live Athena-driven investing.

### Explicitly deferred during this program

- a duplicate in-house Athena or repository merge;
- live prompt/threshold tuning, positive candidate canaries, or removal of
  production watchlist boundaries;
- Agent 4 authority, autonomous approvals, execution changes, or outside capital;
- canonical-money cutover, signature changes, or unrelated dashboard expansion;
- expensive data contracts without golden-set evidence; and
- claims of alpha or institutional readiness from architecture or report depth.

## 13. Next decision, not next implementation

After the current observation period, the next design meeting should include Sam
and Athena's owner and answer:

1. Is Athena intended to support this Portfolio Manager integration, and under
   what permission/license/service arrangement?
2. Which internal full-case fields can become a stable read-only partner contract?
3. What are Athena's actual production coverage, freshness, backlog, calibration,
   and restore results today?
4. Which current data gaps are worth paying to remove first?
5. Which evidence fields are thesis-critical for each of the three canonical
   mandates?

Only after those answers should this plan be decomposed into implementation
packets in `RESEARCH-ROADMAP-EXECUTION-GUIDE.md`.
