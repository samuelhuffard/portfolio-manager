# Frozen Methodology Backtest Scaffold

This directory implements the deterministic plumbing permitted by
`docs/BACKTEST-METHODOLOGY-v1.md`. It is intentionally not a data downloader,
production job, or performance report. It cannot access network, database,
Redis, Sheets, broker, or live production data.

## Input boundary

Create a loader with `createPointInTimeLoader()` and inject historical fixture
records. At a simulated timestamp, `snapshotAt()` reveals only universe events,
filings/releases, completed market data, and policies available no later than
that timestamp. Restatements are separate evidence events. Historical universe
events preserve removals/delistings as explicit state instead of deleting the
security from the record.

Daily close-derived decisions use `nextRegularSessionPrice()`, which requires
an explicit later `executableAt`; there is no same-day close execution fallback.
Missing executable, security-horizon, or benchmark prices are reported as
unavailable/null—not zero.

## Replay API

`runMandateBacktest()` accepts injected decisions and the loader plus all run
identity fields: run/code/methodology/mandate/scoring/universe/selection
versions, snapshot IDs/hashes, dates, parameters, and a required seed. Its
canonical result and SHA-256 result hash are reproducible for identical inputs.
The output keeps holdings/mandatory reviews separate from non-holding discovery
comparisons, and never interprets either as a claim of edge.

Every decision must explicitly declare a supported `selectionCategory`:
`holding`/`mandatory_review` or one of the discovery categories. Unlabelled
decisions fail closed, so a mandatory review cannot accidentally count as a
discovery-policy result. The declared start/end/as-of timestamps are enforced
for every decision and random baseline snapshot.

Supply `walkForwardInputs` with the selected policy/calibration records to
reject any version introduced after the evaluation window. The loader may hold
later historical records; they remain invisible unless they were active then.

## Costs and metrics

Returns are decimal fractions. `metrics.js` follows the existing review
convention of price return when no total-return index is supplied, and prefers a
provided total-return index for dividends. `hitDefinition` is caller supplied;
without it, hit-rate and confidence interval remain null. When supplied, callers
must record `params.hitDefinitionVersion`, so the interpretation is part of the
reproducible artifact.

Q-007 is open. Therefore `costPolicy` defaults to null and both net result
fields remain null. A future frozen policy may provide deterministic `base` and
`stressed` functions, each called once for `entry` and once for `exit` and
applied as `(1-entryCost) * (1+grossReturn) * (1-exitCost) - 1`.

This scaffold reports artifacts only. It does not tune thresholds, fetch data,
publish performance results, or support a promotion decision.
