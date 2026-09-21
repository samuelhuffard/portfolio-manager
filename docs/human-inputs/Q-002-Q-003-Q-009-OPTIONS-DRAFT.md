# Portfolio Manager — Q-002, Q-003, and Q-009 Policy Options

**Status:** DRAFT FOR SAM AND INVESTING PARTNER — not an approved mandate and
not an implementation instruction.  Choose one option (or write a different
one) in each decision.  Codex will encode only the accepted wording in a
versioned, unit-tested policy.

## Why Q-002 and Q-003 come first

The live observation path currently has no rule that can write
`freshnessState: "fresh"`.  It deliberately writes `policy_unresolved` for
present thesis-critical evidence.  Consequently every candidate is incomplete
and non-actionable regardless of score.  Q-002 and Q-003 supply the missing
policy; Q-009 separately restores Agent 2's available points.  This ordering
does not loosen any gate or authorize proposals.

## Q-002 — Current-estimate freshness

**Scope.** Applies to analyst revenue/EPS estimate snapshots used for a new
entry or a holding review.  It does not alter filing collection or let missing
consensus be invented from GAAP figures.

### Choose a normal age limit

| Option | Exact policy text | Trade-off |
| --- | --- | --- |
| A — 7 calendar days | An estimate snapshot is `fresh` only when its provider timestamp is no more than 7 calendar days old at observation time. | Most responsive; more provider refresh failures and fewer covered names. |
| B — 14 calendar days | An estimate snapshot is `fresh` only when its provider timestamp is no more than 14 calendar days old at observation time. | Balanced availability and currency. |
| C — 30 calendar days | An estimate snapshot is `fresh` only when its provider timestamp is no more than 30 calendar days old at observation time. | Highest coverage; greatest risk of pre-event consensus. |

### Choose an event invalidation rule

| Option | Exact policy text | Trade-off |
| --- | --- | --- |
| A — next-session refresh | After reported earnings, new company guidance, or a material filing, the prior estimate snapshot is `stale` at the next regular-market session open and remains so until a newer provider timestamp is observed. | Strongest protection against old consensus. |
| B — two-session grace | The prior snapshot stays fresh for two regular-market sessions after the event, subject to the normal age limit; it is then `stale` until refreshed. | Reduces needless blocking when providers lag. |
| C — earnings/guidance only | Only reported earnings or new company guidance invalidates a snapshot; ordinary filings keep the normal age rule. | Avoids treating routine filings as thesis-changing. |

### Choose the consequence

| Option | Exact policy text |
| --- | --- |
| A — hard candidate block | A missing or stale required estimate writes `freshnessState: "stale"` or `"unavailable"`; the metric is not covered and the candidate cannot be actionable. |
| B — rescale only | A missing or stale estimate is not covered and its points rescale out, but it is not thesis-critical and cannot by itself block actionability. |

**Required implementation facts, whichever option is selected:** retain provider,
provider snapshot timestamp, retrieval timestamp, event type/time when relevant,
and a stable reason code such as `estimate_age_exceeded` or
`estimate_invalidated_by_earnings`.  Never derive an estimate-beat from GAAP
actuals or an undated scalar.

## Q-003 — Entry quote and relative-volume freshness

**Scope.** Applies only to an execution-ready proposal.  Research may continue
outside regular hours, but it must state whether its market evidence is
execution-ready.

### Choose a regular-session quote limit

| Option | Exact policy text | Trade-off |
| --- | --- | --- |
| A — 5 minutes | During the regular US market session, a proposal needs a quote timestamp no more than 5 minutes old. | Strong execution discipline; more refreshes. |
| B — 15 minutes | During the regular US market session, a proposal needs a quote timestamp no more than 15 minutes old. | Practical default for a human-approved system. |
| C — one completed bar | During the regular US market session, a proposal needs the most recent completed 15-minute market-data bar and a quote no older than that bar. | Reproducible bar-based workflow; less responsive intrabar. |

### Choose outside-hours treatment

| Option | Exact policy text |
| --- | --- |
| A — research only | Outside the regular US market session, last regular close may support `research_only`; it never supports an execution-ready proposal. |
| B — limited premarket | A time-stamped premarket quote may support an execution-ready proposal only after a human confirms liquidity; after-hours and prior close remain research-only. |

### Choose re-review trigger after the research snapshot

| Option | Exact policy text | Trade-off |
| --- | --- | --- |
| A — 3% fixed | A fresh review is required when the latest eligible quote differs by 3% or more from the research snapshot's reference price. | Simple, sensitive for low-volatility names. |
| B — 5% fixed | A fresh review is required at 5% or more. | Fewer interruptions; weaker protection. |
| C — volatility adjusted | A fresh review is required at `max(3%, 0.5 × 20-day ATR percent)`.  If ATR is unavailable, the proposal is research-only. | Scales by name volatility; adds an evidence dependency. |

### Choose material-event invalidation

| Option | Exact policy text |
| --- | --- |
| A — issuer events | Reported earnings, new company guidance, or a material company filing makes the proposal research-only until refreshed, regardless of price movement. |
| B — issuer plus broad market | Option A, plus a defined market/regime event list maintained in the mandate.  No free-text model determination qualifies. |

**Required implementation facts:** quote source and timestamp, session label,
reference price/time, relative-volume bar/window and timestamp, event marker,
and a stable reason code.  A stale or unavailable quote must not be relabelled
fresh because it was retrieved recently.

## Q-009 — Agent 2 multi-quarter estimate and EPS persistence

**Scope.** Supplies the still-null inputs `beatsInLatestThree`,
`minimumBeatPct`, `latestBeatPct`, and `missesInLatestThree` from a
point-in-time quarterly estimate history.  It does not let Agent 2 substitute
GAAP EPS, annual estimates, or a later-restated consensus for what was known
before the quarter reported.

### Choose the evidence source and fallback

| Option | Exact policy text |
| --- | --- |
| A — strict point-in-time source | Each quarter needs a provider record containing pre-release consensus, reported result, source timestamp, and whether EPS is adjusted/non-GAAP.  Any missing quarter leaves persistence unavailable and the affected points unscored. |
| B — dated archived source | A dated archived consensus snapshot may qualify when the provider record is unavailable, but it must predate the result and declare its methodology.  Otherwise apply Option A's unavailable result. |

### Choose the beat definition

| Option | Exact policy text | Trade-off |
| --- | --- | --- |
| A — 2% material beat | `beatPct = 100 × (reportedAdjustedEPS − consensusAdjustedEPS) / abs(consensusAdjustedEPS)` when the denominator is nonzero.  A material beat is `beatPct >= 2`; a miss is `beatPct < 0`. | Consistent with existing top scoring band. |
| B — 1% material beat | Same calculation; material beat is `beatPct >= 1`; a miss is `< 0`. | More permissive, more noise. |
| C — any positive beat | Same calculation; a beat is `beatPct > 0`; a miss is `< 0`. | Maximum availability, weakest materiality. |

For zero or unavailable consensus, `beatPct` is unavailable — never infinity,
zero, or a GAAP proxy.

### Choose the persistence rule

| Option | Exact policy text |
| --- | --- |
| A — three-for-three | `beatsInLatestThree = 3`, `minimumBeatPct` is the lowest valid `beatPct` of those three quarters, and `missesInLatestThree = 0`.  Any missing/non-comparable quarter leaves all three fields unavailable. |
| B — two-of-three | Three contiguous, comparable quarters are still required.  `beatsInLatestThree` counts material beats; `minimumBeatPct` is calculated over all three comparable quarters; `missesInLatestThree` counts values below zero.  A candidate may satisfy persistence with at least two material beats and no miss. |

### Choose EPS basis consistency

| Option | Exact policy text |
| --- | --- |
| A — adjusted only | All three quarters must use provider-designated adjusted/non-GAAP diluted EPS on the same provider methodology.  Mixed basis is unavailable. |
| B — consistently GAAP or adjusted | The three-quarter set may be all GAAP diluted EPS or all provider-designated adjusted EPS, but never a mixture; the basis is recorded. |

**Required derived-record fields:** fiscal quarter end, report/release time,
consensus value and its as-of time, reported value, EPS basis, source/provider,
retrieval time, `beatPct`, and explicit `unavailableReason`.  Use only three
contiguous fiscal quarters; a skipped or non-comparable quarter breaks the
series.  The adapter must be pure, fail closed, and unit-tested before Claude
wires it into a scan.

## Decision record

| Question | Selected option / custom rule | Decision owner | Date |
| --- | --- | --- | --- |
| Q-002 normal age |  | Sam + investing partner |  |
| Q-002 event rule |  | Sam + investing partner |  |
| Q-002 consequence |  | Sam + investing partner |  |
| Q-003 quote limit |  | Sam + investing partner |  |
| Q-003 outside-hours |  | Sam + investing partner |  |
| Q-003 re-review |  | Sam + investing partner |  |
| Q-003 event rule |  | Sam + investing partner |  |
| Q-009 source/fallback |  | Sam + investing partner |  |
| Q-009 material beat |  | Sam + investing partner |  |
| Q-009 persistence |  | Sam + investing partner |  |
| Q-009 EPS basis |  | Sam + investing partner |  |
