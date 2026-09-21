# Agent 1 Evidence Coverage Inventory

**Status:** Static implementation inventory, 2026-09-21.  This is not a
scoring-policy change, a release approval, or a proposal authorization.

## Finding

Agent 1's observed 51–63 available-point range is explained by the live
evidence adapter, not by special-sector routing.  The normal standard-sector
path can bind at most five of nine metrics, totaling **63 of 100 points**.  The
other 37 points require optional consensus or 13F evidence that the scan does
not yet supply.  This matches the live cohort finding reported by Claude:
median available points 63, maximum 73 (a name can have a different partial
combination, but no normal path reaches the actionability threshold).

`lib/mandate-observation.js` then independently makes every metric
critical-freshness-missing: it emits `policy_unresolved` for covered rows and
sets `thesisCritical: true` for both covered and missing rows.  A fresh writer
does not exist.  Thus fixing coverage alone cannot make Agent 1 complete, and
deciding freshness alone cannot take Agent 1 above 80 available points.

## Metric-by-metric map

| Metric | Points | Present binding path | Current gap / reason | Next owner and prerequisite |
| --- | ---: | --- | --- | --- |
| `revBeat` | 10 | Optional `consensus` bundle via `assembleConsensusEvidence` | No point-in-time revenue consensus snapshot matched to the reported quarter. | Pure adapter after Q-002 defines freshness and a permitted consensus source is selected. |
| `revGrowth` | 15 | EDGAR `revYoY` + `revAccel` | Bound when sufficient quarterly revenue facts exist; names with short/incomplete series remain partial. | Data coverage measurement; no invented fallback. |
| `epsTrajectory` | 18 | EDGAR `epsYoY` + `epsAccel` | Bound when sufficient quarterly EPS facts exist; incomplete companyfacts remain partial. | Data coverage measurement; do not substitute non-comparable EPS. |
| `estimateRevisions` | 12 | Optional `consensus` snapshot/history bundle | Requires at least the versioned consensus history the rule table calls for; none is supplied on the normal scan. | Pure adapter after Q-002/source decision. |
| `marginTrend` | 12 | EDGAR gross-margin YoY trend | Bound when comparable historical margin facts are available. | Data coverage measurement. |
| `peerValuation` | 8 | Peer-metric quote-summary field | Bound only when valuation is present with usable provenance; observation currently lacks source-as-of fields for a passing freshness state. | Quote freshness binding after Q-003. |
| `balanceSheet` | 10 | EDGAR Q-001 definitions | Bound after the current Q-001 implementation finds the required profitability/base inputs. | Partner confirmation of provisional Q-001; improve missing companyfacts coverage separately. |
| `instOwnershipDir` | 9 | Optional 13F bundle | No quarterly 13F ingestion/ownership-direction bundle on normal scan. | 13F pipeline; Q-004 is already resolved. |
| `thirteenF` | 6 | Optional 13F bundle | No quarterly 13F accumulation bundle on normal scan. | 13F pipeline; Q-004 is already resolved. |

The adapter declares this division explicitly in
`lib/mandate-evidence.js`: `BOUND_METRICS` totals 63; `UNBOUND_METRICS`
(`instOwnershipDir`, `thirteenF`) total 15; and the optional consensus bundle
adds the remaining 22.  It is correct to leave absent evidence `null` and
rescale it out rather than manufacture a score.

## Policy-to-code contradiction to repair after decisions

Q-004 says 13F/institutional ownership is required for **full coverage** but
is **never blocking**; absence should degrade/rescale rather than veto a
candidate.  The observation adapter currently assigns `thesisCritical: true`
unconditionally in both its covered and missing metric branches, then defines
`criticalMissingMetrics` as every thesis-critical metric that is uncovered or
not `fresh`.  The result makes absent 13F evidence block completeness and
actionability despite Q-004.

The repair should be a pure, versioned policy mapping—**not** a special case in
the scan—and must be reviewed alongside the Q-002/Q-003 freshness mapping.
It should explicitly designate which metrics are thesis-critical per agent and
per approved policy, preserving `missingMetrics` and coverage reporting even
when a metric is nonblocking.

## Ordered remaining work

1. Sam and investing partner select Q-002 and Q-003.  Implement a pure
   freshness classifier that can truthfully emit `fresh`, `stale`,
   `policy_unresolved`, or `unavailable` from timestamps and events.
2. Encode Q-004's nonblocking 13F status in the same pure policy mapping; add
   tests proving missing 13F remains visible without alone preventing
   actionability.
3. Select/archive a point-in-time consensus source, then build and test the
   pure `revBeat`/`estimateRevisions` adapter.  It must retain source,
   snapshot as-of time, report period, and unavailable reason.
4. Build the 13F quarterly ingestion and pure ownership adapter from the
   already-approved Q-004 semantics.  It is needed for 100-point coverage but
   must never fabricate history or silently promote a candidate.
5. Measure EDGAR and valuation-source coverage by metric and reason before
   changing any threshold.  A missing source is not evidence to lower the
   80-point actionability bar.
6. Have Claude wire reviewed pure adapters into the live research scan, run a
   new declared research cohort, and observe coverage/freshness distributions
   for the required window before considering a proposal-gate release.

## Documentation drift noted

`lib/mandate-score.js` describes itself as not imported by live jobs, but
`lib/mandate-policy.js` imports it.  This does not establish a runtime scoring
bug by itself; it is a stale boundary statement to reconcile after the runtime
repairs and policy decisions are verified.
