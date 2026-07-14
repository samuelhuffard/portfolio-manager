# Portfolio Manager — Point-in-Time Backtest Methodology v1

**Status:** Architecture frozen; cost parameters and final promotion thresholds remain open
**Date:** 2026-07-13
**Purpose:** define what an executor may build without introducing look-ahead, survivorship, or post-hoc threshold tuning.

## 1. Research questions

The backtest must answer separate questions rather than collapse everything into one return:

1. Do mandate scores predict forward excess return or drawdown within the agent’s intended horizon?
2. Do genuine score-change events outperform rotation, top-score, and exploration selection policies?
3. Does AI review improve outcomes relative to the deterministic finalist set?
4. Does the evaluator improve outcomes by rejecting/revising weak proposals?
5. Do accepted proposals outperform rejected proposals after comparable timing and costs?

Portfolio-level Agent 4 effects are a later analysis and cannot be inferred from candidate-level scores alone.

## 2. Point-in-time information boundary

At simulated decision time `t`, the replay may use only:

- securities known/listed/eligible at `t`;
- filings with SEC acceptance timestamp at or before `t`;
- company releases/current reports published at or before `t`;
- market data completed or timestamped at or before `t`;
- estimate/ownership snapshots actually stored or historically sourced as available at `t`;
- the scoring, mandate, universe, and selection policy version assigned to the simulated run.

The replay may not use today’s current company-facts response as though every restated value was known historically. When the source cannot reconstruct the originally available fact, the sample is labeled unavailable and excluded from claims requiring that fact.

## 3. Historical universe

- Preserve each date’s NYSE/NASDAQ eligible common-stock membership.
- Include companies that later delisted, failed, merged, or changed ticker.
- Apply the active universe policy version at that date.
- Store exclusion reason codes; do not silently drop securities with missing future price data.
- Corporate actions and ticker mappings are explicit data, not inferred by joining on today’s symbol alone.

## 4. Fundamental and event timing

- SEC filing acceptance time is the earliest availability for filing-derived data.
- If a release predates the filing and is used, preserve the release publication timestamp and source.
- A score based on a filing becomes eligible no earlier than the next executable observation point after availability.
- Restatements create new evidence events on their later availability date; they do not rewrite the original observation.
- 13F uses reported-quarter and filing dates and remains labeled delayed.
- Estimate revisions require stored historical snapshots; absent history is `insufficient_history`, not reconstructed from the latest value.

## 5. Market data and execution timing

- Use split-adjusted prices for return calculation while preserving corporate-action records.
- Include dividends for benchmark and security total-return comparisons where available.
- A signal calculated from completed-session data may enter no earlier than the next regular-session executable price.
- Intraday signals require timestamped intraday data; daily bars cannot simulate same-day knowledge they do not contain.
- Use limit/order constraints consistent with the active mandate and execution policy.
- Names that halt or delist remain in the result with the best defensible realizable outcome; they are not dropped.

## 6. Costs and liquidity

Report at least:

- gross return;
- base-cost net return;
- stressed-cost net return;
- turnover;
- spread/slippage impact; and
- capacity/liquidity exclusions.

Exact base/stressed cost assumptions remain Q-007 in `docs/RESEARCH-DECISION-REGISTER.md`. Until frozen, executors build parameterized cost functions and synthetic tests; they do not publish a definitive net-performance claim.

## 7. Horizons and benchmarks

Evaluate by mandate horizon, never one universal window:

- Agent 1: short-term days-to-weeks windows predeclared before results.
- Agent 2: weeks-to-two-quarter windows.
- Agent 3: long-horizon windows; short samples are process evidence, not edge evidence.

Every result records its benchmark and total-return method. Benchmark selection is versioned policy. Cross-agent comparisons use horizon-matched metrics.

## 8. Experimental splits

- Prefer walk-forward evaluation: fit/calibrate rules only on data before the evaluation window.
- Materiality and selection thresholds are frozen before the test window.
- If one historical period is used for design, reserve a later untouched period for evaluation.
- Forward live/shadow data is never folded backward into a “historical” result.
- Report all tested policy versions; do not show only the best one.

## 9. Required comparison policies

For the same eligible pool and budget, record:

- current rotation slate;
- top stable score;
- genuine event/score-change slate;
- bounded exploration; and
- random eligible baseline with deterministic seed where useful.

Holdings/mandatory exit reviews are excluded from claims about non-holding discovery-policy superiority.

## 10. Outcome metrics

At minimum:

- forward total and excess return;
- maximum adverse and favorable excursion;
- hit rate under a predeclared definition;
- drawdown;
- turnover and holding period;
- calibration by score/confidence band;
- selection overlap and opportunity cost;
- sample count, missing/excluded count, and confidence interval.

Results are stratified by agent, mandate version, score completeness, score-change cause, sector, liquidity/cap bucket, and regime when sample size permits.

## 11. No-trade and missing-data treatment

- Missing future price or benchmark is unavailable, not zero.
- Missing thesis-critical data remains NO_TRADE under the mandate.
- Partial scores are analyzed separately from complete/actionable scores.
- A vendor failure is not counted as a successful investment HOLD.
- Cash/abstention counterfactuals use the same decision timestamp and benchmark horizon as the rejected candidate.

## 12. Reproducibility artifact

Every run records:

- run ID and code revision;
- methodology version;
- mandate/scoring/universe/selection versions;
- data snapshot IDs and hashes;
- parameters and deterministic seeds;
- start/end date and observation count;
- exclusions and reasons; and
- result JSON plus human-readable report.

Another run with identical inputs and versions must reproduce the same result.

## 13. Promotion standard

A positive backtest is necessary evidence, not sufficient promotion authority. Promotion also requires:

- no unresolved leakage/survivorship finding;
- sensitivity that survives stressed costs;
- out-of-sample or walk-forward persistence;
- adequate sample size;
- clean shadow/forward behavior; and
- operational and autonomy gates from the canonical roadmaps.

Only the primary reviewer may interpret results as evidence of edge or recommend a shadow/canary/live promotion.
