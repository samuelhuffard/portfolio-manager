# Q-001 — Agent 1 balance-sheet definitions (DRAFT for Sam + investing partner)

> **Status: DRAFT — not accepted, not implemented.** Nothing in this file scores
> anything. `lib/mandate-evidence.js` deliberately masks `balanceSheet` to `null`
> until this document is approved and transcribed into
> `docs/RESEARCH-DECISION-REGISTER.md`. Approve, redline, or reject each item.

## Why this is blocking

`balanceSheet` is worth **10 points** to Agent 1 and **12 points** to Agent 2
(`config/scoring/mandate-v2.js` → `catC(margin, val, bs)`). It is one of five unbound
metrics, and the actionability bar in `lib/mandate-score.js` requires
`maxAvailable >= 80`.

Current bindable points, per `BOUND_METRICS_BY_AGENT`:

| Agent | Bound today | Max available | Bar |
|---|---|---|---|
| agent-1 | revGrowth 15 · epsTrajectory 18 · marginTrend 12 · peerValuation 8 | **53** | 80 |
| agent-2 | revGrowth 17 · epsTrajectory 16 · marginTrend 10 · peerValuation 8 | **51** | 80 |

With consensus estimates landing (`revBeat` + `estimateRevisions` = 22 for Agent 1),
Agent 1 reaches **75** — still short. Approving this document adds the last 10 points
and takes Agent 1 to **85**, clearing the bar without requiring 13F ingestion. That is
the decision recorded for Q-004: consensus is thesis-critical, 13F is optional.

## What the mandate asks for and what EDGAR can actually supply

The mandate's absolute-threshold requirement (`ABSOLUTE_TABLE_REQUIREMENTS`) is:

> `balanceSheet: "leverage + interestCoverage OR cashRunwayQuarters"`

`lib/edgar-metrics.js` already derives interest coverage, cash-runway quarters, and an
equity ratio from XBRL. What it cannot do is decide the *economics* — which is what the
four questions below settle. Each proposal names the exact `us-gaap` concept chain so
the implementation is unambiguous and testable.

---

## D1 — `isProfitable` / `isPreProfit`

**Proposal.** A company is `isProfitable` when **operating income is positive across
the trailing four reported quarters in aggregate** (TTM `OperatingIncomeLoss`).
Otherwise `isPreProfit`.

- Concept chain: `OperatingIncomeLoss` → `IncomeLossFromContinuingOperationsBefore...`
- Rationale: operating income (not net income) keeps one-time tax, litigation, or
  impairment items from flipping a structurally profitable company into the pre-profit
  track. TTM (not latest quarter) prevents seasonality from toggling the label.
- **Consequence:** the label routes which absolute band applies — `isPreProfit` names
  are scored on `cashRunwayQuarters`, profitable names on `leverage + interestCoverage`.

**Alternative if you disagree:** use TTM net income (`NetIncomeLoss`), which is
stricter and will classify more companies as pre-profit.

## D2 — `netCash`

**Proposal.** `netCash = (cash and equivalents + short-term investments) − total debt`,
measured at the latest reported instant.

- Cash: `CashAndCashEquivalentsAtCarryingValue` + `ShortTermInvestments`
- Debt: `LongTermDebtNoncurrent` + `LongTermDebtCurrent` + `ShortTermBorrowings`
- **Excluded:** restricted cash (`RestrictedCashAndCashEquivalents...`). Cash a company
  cannot deploy should not offset debt.
- **Open sub-question for you:** should operating leases
  (`OperatingLeaseLiabilityNoncurrent`) count as debt? Post-ASC-842 they sit on the
  balance sheet. **Draft position: exclude them** — including them makes
  asset-light retail/restaurant names look far more levered than the market treats
  them. Flag if you want them in.

## D3 — EBITDA fallback order and `netDebtEbitda`

**Proposal.** Compute EBITDA in this order, first available wins:

1. `OperatingIncomeLoss` + `DepreciationDepletionAndAmortization`
2. `OperatingIncomeLoss` + (`DepreciationAndAmortization` or `Depreciation` + `AmortizationOfIntangibleAssets`)
3. `NetIncomeLoss` + `IncomeTaxExpenseBenefit` + `InterestExpense` + D&A
4. Otherwise **null** — never approximate EBITDA with operating income alone.

`netDebtEbitda = (total debt − unrestricted cash and short-term investments) / TTM EBITDA`.

**Negative or zero EBITDA:** `netDebtEbitda` is **null**, not a large positive or
negative number. The company is then scored on the pre-profit path (D1) via cash
runway. A negative denominator produces a ratio that sorts as "excellent" if scored
naively — this is the single most dangerous failure mode in this metric.

**Zero debt:** `netDebtEbitda` is **0** (not null) and interest coverage takes the
existing zero-debt sentinel in `lib/edgar-metrics.js` — a debt-free company should
score full marks on leverage, not be treated as unmeasurable.

## D4 — Financial companies

**Proposal.** Banks, insurers, and REITs are **out of scope for this definition set**
and continue to fail closed. `lib/mandate-evidence.js` already returns
`supported: false` for any non-null `sector`, and the Phase 3 exit gate explicitly
requires that special sectors are not scored with ordinary-company economics. Leverage
and interest coverage are not meaningful for a bank; CET1 / NPAs / charge-offs are, and
those belong to the separate special-sector adapter work.

**No action needed from you here unless you disagree** — this is the status quo, stated
so it is recorded rather than assumed.

---

## Proposed absolute-threshold bands

Once D1–D4 are settled, these are the bands the scorer would use. Bands follow the
mandate's 100/75/50/0 structure. **These numbers are the least researched part of this
draft and are where your partner's judgement is most valuable.**

**Profitable companies** (score the better of the two rows):

| | 100% | 75% | 50% | 0% |
|---|---|---|---|---|
| `netDebtEbitda` (lower better) | ≤ 0 | ≤ 1.0 | ≤ 2.5 | > 2.5 |
| `interestCoverage` (higher better) | ≥ 12× | ≥ 6× | ≥ 3× | < 3× |

**Pre-profit companies:**

| | 100% | 75% | 50% | 0% |
|---|---|---|---|---|
| `cashRunwayQuarters` | ≥ 12 | ≥ 8 | ≥ 6 | < 6 |

The 6-quarter floor matches the runway threshold already referenced in
`docs/MANDATE-V2-INGESTION.md` ("runway ≥6q, coverage ≥2–4×"). I raised the coverage
bands above that note's range because 2× coverage is thin for a long-term compounder;
say if you want them returned to the mandate's original 2–4×.

## What happens after you approve

1. Transcribe the accepted definitions into `docs/RESEARCH-DECISION-REGISTER.md` as the
   Q-001 resolution.
2. Bind them in `lib/mandate-evidence.js` (remove the `balanceSheet: null` mask) and add
   the band table to `config/scoring/absolute-thresholds.js`.
3. Tests for each edge case above — negative EBITDA, zero debt, restricted cash,
   missing D&A concepts — before anything scores.
4. This changes scoring, so per the master plan's reset rules it **opens a new research
   cohort**; prior comparability evidence does not carry over.
