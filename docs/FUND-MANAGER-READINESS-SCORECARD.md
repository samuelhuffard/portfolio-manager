# Portfolio Manager — Fund-Manager Readiness Scorecard

**Status date:** 2026-07-16 ET  
**Current overall rating:** **6.6 / 10**  
**Purpose:** a durable, candid progress view of whether the whole system is becoming
something a respected fund manager would trust, operate, explain, and stand behind.

This is not a claim of investment performance, legal readiness to manage outside
capital, or production promotion. The master plan owns gates and authority. This
scorecard summarizes maturity and must yield to runtime evidence when they conflict.

## Rating scale

| Score | Meaning |
| ---: | --- |
| 1–2 | Idea, experiment, or largely unproven capability. |
| 3–4 | Working prototype with major gaps or fragile integration. |
| 5–6 | Credible supervised system, but material weaknesses still require operator compensation. |
| 7–8 | Professional foundation with strong controls and evidence; remaining gaps are bounded and visible. |
| 9 | Institution-grade capability proven across sustained real operation and adverse conditions. |
| 10 | Exceptional, durable, independently defensible standard. Code and tests alone cannot earn this. |

Decimals are deliberate. They show direction without pretending the assessment is a
precise scientific measurement.

## Scoring rules

1. Rate the working whole, not the amount of code or number of planned features.
2. Weight evidence in this order: current production proof, matured forward outcomes,
   independently verified offline implementation, then plans. Plans alone earn no
   score increase.
3. Offline work may improve architecture confidence, but it does not receive full
   operational credit until deployed and observed safely.
4. An open critical incident, unexplained restart, broken money-path invariant, or
   material data-integrity failure lowers the relevant score immediately.
5. Safety and research skill remain separate. Reliability cannot substitute for edge;
   performance cannot excuse unsafe operation.
6. Update this document after a material implementation wave, deployment, incident,
   gate result, or meaningful body of matured outcome evidence. Do not adjust it for
   cosmetic churn.
7. Every change records the old score, new score, evidence, and remaining limitation
   in the dated history below.

## Current ratings

| Category | Weight | Rating | Why it is here now | What most clearly earns the next point |
| --- | ---: | ---: | --- | --- |
| **1. Research breadth and depth** | 15% | **6.4** | Written specialist mandates, deterministic screening, filings/news inputs, point-in-time research primitives, and the verified offline Athena package provide a serious foundation. Live breadth remains uneven, Agents 2/3 are still static-watchlist-bound, the current Athena adapter is lossy and disabled, and source depth has not passed the golden-set bakeoff. | Complete the 30-company golden set, prove broad eligible-universe coverage, integrate deeper evidence without losing provenance, and show consistently strong research dossiers across sectors. |
| **2. Evaluator pipeline** | 10% | **6.9** | The generator and evaluator are separate, revisions are bounded, failures close safely, and numerical/suspect-evidence diagnostics exist. Offline contradiction admission now rejects an APPROVE with failed checks. Production still cannot cleanly distinguish malformed/truncated generator output from an investment HOLD, the stricter admission policy is not live, and current-version organic approval evidence is thin. | Deploy explicit generator-degradation accounting and contradiction admission after the freeze, then prove clean organic APPROVE/REJECT behavior over a meaningful sample. |
| **3. User experience** | 8% | **6.3** | Sam has a real dashboard, human approval flow, health visibility, agent surfaces, Sheets records, and alerts. The operating experience is still spread across dashboard, Sheets, Telegram, documentation, and specialist endpoints; it is more capable than cohesive. | Produce one polished operating cockpit with obvious priorities, explanations, drill-down evidence, incident state, and a rehearsal-quality daily/weekly fund-manager workflow. |
| **4. Dashboard backend** | 7% | **7.2** | The Vercel dashboard is backed by signed approval contracts, companion health, Redis state, aggregate research telemetry, and guarded data paths. It remains coupled to a transitional Sheets/Redis/Postgres architecture, and not every displayed state comes from one canonical, freshness-bound source. | Finish canonical read boundaries, unify freshness/error semantics, prove degraded-mode behavior, and make every critical dashboard number traceable to one authoritative record. |
| **5. Data quality and provenance** | 10% | **7.5** | Transactional Postgres/Sheets parity is currently MATCH; signatures, source identity, point-in-time records, chronology, coverage, and missing-data behavior are unusually explicit. Valuation is honestly NON_COMPARABLE, external-source quality is uneven, and several investment-policy definitions remain unresolved. | Produce comparable content-bound valuations, close the remaining policy definitions, pass provider/source bakeoffs, and sustain complete point-in-time coverage without silent gaps. |
| **6. Continuity across agents, workflows, and records** | 8% | **7.0** | Stable machine IDs, versioned mandates, strategy-owned lots, proposal lineage, shared evidence concepts, and the offline candidate bus connect many stages coherently. Continuity is weakened by multiple stores/surfaces, historical contract versions, static versus catalog discovery differences, and offline improvements not yet wired into the live workflow. | Demonstrate one end-to-end lineage from shared candidate facts through independent agent judgment, evaluation, approval, fill, accounting, outcome, and learning across all three agents. |
| **7. Risk controls and capital safety** | 12% | **8.4** | Human approval, signed immutable proposals, deterministic breakers, ownership-aware exits, budget caps, reconciliation, fail-closed behavior, and bounded Agent 4 authority form the strongest part of the system. The ten-day TRUST window is not yet complete, canonical money reads have not cut over, and later autonomy has not earned promotion. | Complete the clean TRUST window, prove recovery and rollback under real operation, close canonical-store gates, and retain the same controls through later authority changes. |
| **8. Operational reliability and observability** | 8% | **7.2** | Production is online, health is green, unstable restarts are zero, parity is clean, and monitoring is extensive. The scheduled holdings and reconciliation consumers now run on the always-on Jetson under a read-only role, while the Mac is structurally execution-only. Both post-cutover workflows passed account-bound canaries, but ordinary scheduled close evidence and the ten-day window are still required. | Accumulate ten clean days with no unexplained restart or required-workflow ambiguity, prove every ordinary after-close receipt completes on the Jetson, then continue publishing reliable weekly operating-health evidence. |
| **9. Security and auditability** | 6% | **7.2** | Signed records, HMAC verification, dedicated keys, prompt-injection fencing, bounded logs, secret-handling rules, append-only evidence, and incident findings provide strong audit structure. The recent credential-exposure/rotation incident and the complexity of legacy verification paths show that operational security still needs sustained proof. | Demonstrate clean rotation/expiry procedures, simplify legacy trust paths, complete recurring security regression evidence, and avoid new credential or provenance incidents over time. |
| **10. Measurement and learning system** | 7% | **6.5** | Outcome conservation, point-in-time observations, policy strata, counterfactual selection, backtest scaffolding, weekly scorecards, and reproducible reports create a credible learning spine. Mature samples, accepted cost assumptions, outcome ownership/cadence, and calibrated feedback are still insufficient. | Freeze cost/outcome policies, collect mature forward cohorts, demonstrate lessons that measurably improve later decisions, and independently reproduce the reports. |
| **11. Demonstrated investment edge** | 9% | **2.0** | The system has not yet shown durable benchmark-relative excess return, net of realistic costs, across strategies and regimes. This low score is an evidence statement, not a judgment that the architecture cannot work. | Produce preregistered historical evidence and months of current-version forward outcomes with adequate sample size, realistic costs, benchmark attribution, and no look-ahead or survivorship bias. |

**Weighted overall: 6.6 / 10.** The platform is already a credible supervised
investment operating system with unusually strong safety architecture. It is not yet
a respected-fund-manager-grade system because research breadth is incomplete,
continuity is not fully end to end, ordinary-operation evidence is young, and actual
investment edge remains unproven.

## Update protocol

When a material change is reviewed:

1. Identify which categories it truly affects; most changes should move zero to two.
2. Record architecture/test credit separately from production/forward-evidence credit.
3. Raise a score only when a stated limitation is actually reduced.
4. Lower a score promptly when an incident or contradictory evidence appears.
5. Recalculate the weighted overall score using the frozen weights above.
6. Add one dated history row. Never rewrite an old rating to make progress look smoother.

## Rating history

| Date | Overall | Category changes | Evidence and interpretation |
| --- | ---: | --- | --- |
| 2026-07-16 | **6.6** | Initial eleven-category baseline | Production health/parity and existing controls were considered alongside the verified-but-undeployed O2A/O2B/O3/O4A wave. Offline work received architecture credit only. The 0/10 TRUST streak and absence of demonstrated edge remain explicit. |
| 2026-07-17 | **6.6** | Operational reliability **7.1 → 6.8** | July 16's Mac companion outage delayed required broker-read receipts beyond the immutable observer. `portfolio-keepawake` now provides permanent PM2-managed macOS sleep prevention without changing observer or investment semantics. The weighted rating still rounds to 6.6; restore reliability credit only after clean scheduled evidence. |
| 2026-07-17 | **6.6** | Operational reliability **6.8 → 7.2** | Scheduled holdings and reconciliation ownership moved to the always-on Jetson under an execution-disabled role; the Mac is now read-queue-disabled. Both workflows passed fresh post-cutover account-bound canaries, queues and leases drained, heartbeats were fresh, and both PM2 roles had zero unstable restarts. The score remains below its clean-window ceiling until ordinary scheduled evidence accumulates. |
