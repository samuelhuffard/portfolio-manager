# Mandate v2 Ingestion Plan

Canonical plan for ingesting the four **v2 agent mandates** authored by Sam's friend
(`agent_mandates/Agent_{One,Two,Three,Four}_Mandate_v2.md`, merged to `main`
2026-07-12). Read this with `docs/AUTONOMY-ROADMAP.md` (Phase 1 gates still apply)
and `docs/CHANGE_MAP.md` ("Onboarding a specialist mandate").

**Status:** planning + Phase A scaffolding. **No agent is activated by this work.**
Agents 2/3 stay `paper`; Agent 4 stays `SHADOW` + human-approve until each mandate's
tests pass (roadmap Phase 1/2/3 gates, unchanged).

---

## 1. The core problem (why this is not a tuning task)

Every analyst mandate (One/Two/Three) is built on **peer-relative scoring**:

> *"every rankable metric is scored by the candidate's percentile rank within its
> GICS sector peer set … top decile → full points · top quartile → ~75% · top third
> → ~50% · middle → minimal · bottom half → 0."*

The system cannot do this today, at three levels:

1. **Wrong reference set.** `lib/quant-scorer.js:scoreCandidates()` min-max normalizes
   each metric *across the ~20-name daily candidate slate* — a cross-sector mix. A
   name is ranked against whatever else happens to be in today's slate, not against
   its industry. The resulting number does not mean what the mandate's
   `conviction_score` claims it means.
2. **No classification layer.** No GICS in the repo. Only Yahoo's 2-level
   `sector`/`industry`, enriched into the universe catalog (`i` field), ~6% covered on
   night one, converging over 3–4 weeks at 250 names/night.
3. **No peer dataset.** Percentile-ranking needs, per industry, the current metric
   vector of every comparable, refreshed constantly. Nothing builds or stores that.

**Consequence:** dropping the mandates in and flipping agents on produces scores that
look mandate-compliant but are not. Peer-relative scoring is the **gate on everything
else** and must land first.

### Decision (Sam, 2026-07-12): Yahoo-industry peer key

Peer data source = **Yahoo's 2-level sector/industry, already enriched in the
catalog**, extended to store the full mandate metric vector per name. Cost $0.
Trade-off accepted: coarse classification (not true GICS sub-industry) and a ~2–3
week convergence with ongoing staleness during ramp, mitigated by the mandate's own
`thin_peer_set` fallback (<6–8 comparables → absolute thresholds + flag) and staleness
flags. **Build behind a `PeerSource` interface so a GICS bulk-data vendor can be
swapped in later without touching the scoring engine.**

---

## 2. Full gap surface (grounded against code)

| Workstream | Today | v2 requires |
|---|---|---|
| **Peer scoring** | cross-slate min-max, one shared `weights.json` | percentile-within-industry, per-agent category reweights, thin-peer fallback, sector substitution, vendor-lag rescale |
| **Data sourcing** | Yahoo: price, summaryDetail, defaultKeyStatistics, financialData, assetProfile, calendarEvents, recommendationTrend, netSharePurchaseActivity, earningsHistory | + revenue **consensus** & estimate **revisions** (`earningsTrend`), **quarterly** revenue series (YoY-accel, 3yr consistency), institutional/13F flow, insider tx **>$1M** classification, analyst **PT changes** (`upgradeDowngradeHistory`), short-interest trend, ATR/RSI/MACD/50–200MA/rel-strength (indicators.js has these) |
| **Macro** | agent-1 v5 QQQ/IGV/SOX | SPY-200MA + 10yr-yield-50bps/30d, **per-agent modes** (One/Two hard gate · Three exempt · Four tilt) |
| **Hard gates** | basic freshness/liquidity | per-agent liquidity tiers ($3M/$10M ADDV, bid/ask ≤2%), balance sheet (runway ≥6q, coverage ≥2–4×), price structure, Two trend gate (50>200), **Three peer-relative valuation gate** |
| **Sell logic** | held-position exit monitor | per-agent ATR ladder, trend stop, dead-money, revenue-decel ladder, structural exits, Three's one-time averaging-down (`averaging_down`) |
| **Missing data** | NO_TRADE on stale | vendor-lag vs company-non-disclosure classifier, rescale formula, 2-miss → auto-reduce 5% |
| **Attribution/breakers** | portfolio-wide NAV/unit breaker | **per-analyst attributed book**, per-agent HWM/drawdown with different tiers (One 8/12/15/20 · Two 12/18/25 · Three re-underwrite@25%) |
| **Agent 4** | shadow ACCEPT/REJECT + hard-bound `AllocationPolicy` | full meta-allocator: trust 0–100 (weekly ±10), cold-start 60d equal-thirds/process-only, capital bands 5–70%, **asymmetry rule** (never block a sell; amplify 1–2×), 20% overlap cap, concentration/correlation duties, daily consolidated instruction, emergency review |
| **Schema** | proposal contract | + `conviction_score_basis`, `thin_peer_set`, `peer_set_used`, `missing_data_cause`, `averaging_down`, macro states; `agent_one`↔`agent-1` id map; cross-repo contract sync + drift tests |

Mandates also **supersede** agent-1 v5 (One is now sector-agnostic, not tech-growth)
and define Agent 4 far beyond the 07-11 shadow contract.

### Data availability note (Yahoo)

Available now / cheap to add via existing `lib/yahoo.js`: forward & trailing P/E, P/S,
short interest + prior-month (trend), recommendationTrend, net insider activity
(summarized), EPS actuals (`earningsHistory`), technicals (`lib/indicators.js`:
`rsi/macd/atr/relativeStrength/avgDailyDollarVolume`).
Needs new modules/series: `earningsTrend` (estimate revisions, revenue consensus),
`incomeStatementHistoryQuarterly`/`earnings` (YoY-accel, 3yr consistency),
`institutionOwnership`/`majorHoldersBreakdown` (13F direction),
`insiderTransactions` (>$1M classification), `upgradeDowngradeHistory` (PT changes).
The scoring engine operates on an abstract metric vector, so data sourcing (W2) can
catch up to the engine without reworking it.

---

## 3. Phases and gates

**Phase A — Peer-scoring foundation (BLOCKING).**
`PeerSource` interface + `YahooIndustryPeerSource`, industry distribution builder,
percentile scoring engine (pure, tested), per-agent scoring configs from the mandates.
Deterministic code computes peer-percentiles — the analyst LLM never ranks peers, it
composes thesis/kill-criteria and may only downgrade (preserves invariant #4). Wire
into the pipeline behind `PEER_SCORING` (default off). *Gate: engine produces scores
that match mandate band semantics on fixtures; nothing activates until then.*

**Phase B — Per-agent gates, macro, sells, missing-data.** Still paper/shadow.

**Phase C — Per-analyst attribution + breakers + Agent 4 shadow meta-allocator.**
Builds on StrategyLot ownership (07-11).

**Phase D — Schema/contract + registry + evaluator + tests.** Then supervised
activation per roadmap gates: Agents 2/3 `paper`, Agent 4 `SHADOW`+human, until
mandate + ownership tests pass.

---

## 4. Phase A file map (this session's scaffolding)

- `lib/peer-scoring.js` — pure engine: `percentileRank`, `bandFraction`, mandate
  `BANDS`, `scoreMetricPeerRelative`, `scoreCategoriesPeerRelative` (thin-peer fallback,
  vendor-lag rescale, sector-substitution passthrough). Not wired to live pipeline.
- `lib/peer-source.js` — `PeerSource` interface, `YahooIndustryPeerSource` skeleton
  (peer key = Yahoo industry; Redis shape `pm:peer-dist:<industry>`), pure
  `buildIndustryDistributions()`. Swap-in seam for a GICS vendor.
- `config/scoring/mandate-v2.js` — per-agent category/metric/points maps + reweights +
  per-agent Category A definition + `agent_one`↔`agent-1` id map, transcribed from the
  mandate files.
- `tests/peer-scoring.test.js` — band thresholds, percentile correctness, category
  aggregation, thin-peer flag, rescale.

`PEER_SCORING` env flag stays **off**; `lib/quant-scorer.js` remains the live scorer
until Phase A is verified and Sam flips it.

### Phase A — built (2026-07-12), inert

Engine + W2 data plumbing are in and tested (`npm test` 391 green), wired to nothing
on the scan/money path:

- Engine + config + peer source: `lib/peer-scoring.js`, `lib/peer-source.js`,
  `config/scoring/mandate-v2.js`, `tests/peer-scoring.test.js`.
- **W2 data plumbing:** `lib/mandate-metrics.js` (`extractMetricVector` — populates the
  8 metrics derivable from already-fetched Yahoo modules; the other 5 are `null` by
  design, see below), `lib/redis.js` (`getPeerMetrics`/`setPeerMetrics` chunked store,
  `setPeerDistributions`/`getPeerDistribution`), `jobs/peer-distributions.js`
  (`npm run peer:dist` — builds `pm:peer-dist:<industry>` from cached vectors),
  a `PEER_METRICS_ENABLED`-guarded hook in `jobs/universe-refresh.js` that caches each
  enriched name's vector from the same `fetchFundamentals` call (no extra API cost),
  `tests/mandate-metrics.test.js`.

**Two flags, both off:** `PEER_METRICS_ENABLED=1` starts accumulating per-name vectors
during the nightly refresh; once vectors exist, `npm run peer:dist` builds the
distributions; only then does flipping `PEER_SCORING` (future) make the engine live.

**Metrics still `null` until W2-data (need new Yahoo modules — verify v3 field shapes
first, don't guess):** `revBeat` + `estRevisions` (`earningsTrend`), `grossMarginTrend`
(margin history — a level is not a trend), `instOwnershipDir` + `smartMoney13F`
(13F/ownership series). The engine's vendor-lag rescale excludes nulls, so partial
coverage produces an honest `rescaled_available_fields` score, never a zeroed one —
but peer scores get sturdier as these land. Per-agent Category-A refinement
(One's QoQ-acceleration, Three's 3yr-consistency) also needs a quarterly revenue
series; `revGrowth` currently carries the TTM figure for all three.

---

## 5. Open decisions (need Sam / friend)

- Thin-peer absolute-threshold table: **RESOLVED in v3** — see §7. Fully specified
  (per-agent absolute tables + 3-tier deterministic fallback + 84-conviction cap).
- Agent-id migration: **RESOLVED — Option B** (keep internal `agent-1..4`, translate
  `agent_one..four` at the boundary via `AGENT_ID_MAP`). Display names TBD.

## 7. Next steps (ordered)

Recorded 2026-07-12. Data plumbing first (makes scores real), then the v3 thin-peer
engine, then Agent 4.

1. **Bind per-agent metric definitions + build distributions per definition.** The
   scoring config shares metric ids (`revGrowth` etc.) but each agent defines them
   differently (One = acceleration, Two = YoY, Three = multi-year consistency). Bind
   each agent's submetric to the right `_derived` variant from `lib/edgar-metrics.js`,
   and build a distribution PER definition (not one shared `revGrowth` distribution).
2. **Consensus snapshot store** (yfinance → Redis/SQLite, timestamped) → unlocks
   `revBeat` (EDGAR revenue actual vs snapshot) and `estimateRevisions` (activation-gated
   ≥3 snapshots / ≥30 days).
3. **EDGAR 13F ingestion** (separate endpoint from companyfacts) → `instOwnershipDir`
   + `thirteenF` (Category D). Two-consecutive-quarter rule caps 1-quarter 13F at 75%.
4. **v3 thin-peer engine** (now fully specified — see §8). Extend `lib/peer-scoring.js`:
   deterministic `peer_count` (true operating-company comparables with current data,
   candidate excluded); mode by count **≥8 → peer_relative · 6–7 → blended_50_50 ·
   <6 → absolute**; implement `blended_50_50` (½ peer + ½ absolute per submetric) and
   `absolute`; add the **per-agent absolute-threshold tables** (One/Two/Three each have
   their own in the v3 mandates) as config data; enforce the **84-conviction cap** when
   `thin_peer_set:true` (no Tier 1 without recorded human override); implement the
   **valuation fallback cascade** (company 5yr history percentile → broad-sector
   benchmark → universal absolute P/E/EV-EBITDA/FCF-yield/PS) and the **special-sector
   absolute thresholds** (Banks/Insurers/REITs). Boundary change: replace the current
   single `THIN_PEER_MIN` flag/behavior with the 8/6 tiering.
5. **New proposal/output fields:** `peer_count`, `thin_peer_set`, `fallback_method`,
   `peer_set_used`, `sector_substitutions_used` (contracts + dashboard mirror + drift
   tests). Agent 4 §6 validates the analyst-selected mode deterministically.
6. **Special-sector substitution engine** (`SPECIAL_SECTOR_SUBSTITUTIONS` map already
   transcribed) — deterministic banks/insurers/REITs metric swaps; NO_TRADE when
   required substituted data is missing.
7. **Agent 4 allocator (shadow)** — trust-multiplier table, `target_share =
   33.33% + 0.5×(trust − avg)`, 5%/70% bands ±10pp/wk, 10/15/20/25% drawdown scalars,
   damage caps, execution contract. Stays SHADOW + human-approve.
8. **First real dry run** — enable `PEER_METRICS_ENABLED` + `PEER_METRICS_EDGAR` on a
   small slice, run `npm run peer:dist`, eyeball real industry distributions before any
   activation.
9. **Checkpoint** — commit the stack on a `mandate-v3` branch; log the session to the vault.

## 9. Cost model — where LLM tokens are (and are NOT) spent

**Everything built in this plan spends $0 in LLM/API tokens.** The peer-scoring engine,
EDGAR/XBRL ingestion, distribution builder, and the probe are pure deterministic code
over the FREE SEC EDGAR + yfinance + FRED HTTP APIs. No Claude/Sonnet/Opus call anywhere
in Phase A, W2, or the probe. Run them as often as you like.

This is by design, and it *reduces* system LLM cost rather than adding to it:
- The v3 mandates (Agent §2, Agent Four §8) require peer classification, percentile
  ranking, technical calcs, screening, and estimate storage to run **deterministically,
  outside the language models**. Pushing that work out of the LLM is cheaper than asking
  an LLM to reason over raw market data per name.
- Agent Four §8 also forbids any **paid** data API → $0 data-vendor cost (EDGAR, yfinance,
  FRED, SEC 13F are all free).

The ONLY LLM spend in the PM system is unchanged by this work: the research-scan
**generator** (Sonnet) and **evaluator** (Opus), already hard-capped —
`aiReviewBudget: 12` AI reviews/day (holdings exempt), evaluator runs only on the 0–5
actionable proposals/day. Peer scoring adds nothing to that; it feeds the generator
better deterministic inputs. Adding agents 2/3 or Agent 4 later raises LLM cost only to
the extent they generate/evaluate proposals — governed by the same budget, not by any of
the deterministic machinery here.

Separate from the *product's* runtime cost: this build was done in a Claude Code session
(that's a different meter). Going forward we keep those sessions bounded — probes and
tests are free to re-run; only the eventual live generator/evaluator loop costs product tokens.

## 10. Probe results (2026-07-12) — `npm run peer:probe`, 48 tickers, $0 tokens

Runtime evidence that reorders the roadmap:

- **Classification is fine-grained → peer cohorts are small.** Yahoo split our 4 sample
  sectors into 13 industries: Semiconductors (12), Software‑Infrastructure (6),
  Software‑Application (6), Banks‑Diversified (4), Banks‑Regional (4), Capital Markets
  (3), REIT‑Industrial (3), REIT‑Specialty (3), REIT‑Retail (2), REIT‑Residential (2),
  plus singletons. Only Semis cleared the **≥8** peer-relative threshold.
- **⇒ The v3 absolute-threshold path is a PRIMARY path, not a rare fallback.** Most
  industries land in `blended_50_50` or `absolute` mode. **Implication: build the v3
  thin-peer/absolute engine (step #4) with real weight, and add a peer-set *widening* /
  local-override table early** (roll Software‑App + Software‑Infra together, or up to a
  sector level, to reach ≥8) — the mandate's "deterministic local override table" is not
  optional polish, it's load-bearing.
- **Financials can't score without special-sector substitution.** Banks / Capital Markets
  showed `marginTrend:0, balanceSheet:0` — they don't file GrossProfit / standard
  interest-coverage. This is exactly the v3 Banks/Insurers/REITs substitution map (step
  #6); financials are unscored until it's implemented. Raises its priority.
- **EDGAR coverage is strong** for the wired metrics: revGrowth / epsTrajectory /
  peerValuation / balanceSheet ≈100% for non-financials (marginTrend ~90%). The 0s for
  revBeat / estimateRevisions / instOwnershipDir / thirteenF are the not-yet-wired
  sources (steps #2, #3), as expected.
- **End-to-end scores are sane:** within Semiconductors, NVDA 85 · AMD 21 · INTC 0
  (`rescaled_available_fields` correctly excludes the unwired metrics rather than zeroing).

**Revised near-term priority (was #1→#4):** the small-cohort reality pulls the
thin-peer/absolute engine (#4), the peer-widening/override table, and special-sector
substitution (#6) *forward* — they're common paths, not edges. Per-definition binding
(#1) and the snapshot/13F sources (#2/#3) still follow, but the scoring won't be
trustworthy for most names until #4+#6 land.

## 8. v3 mandate update (2026-07-12) — thin-peer fully specified

v3 replaced v2.1 (files renamed `*_v3.md`; scoring **categories unchanged** —
A25·B30·C30·D15 — the additions are the thin-peer system). The "peer thingy" is now a
closed deterministic spec in every analyst §5 and enforced by Agent 4 §6:

- `peer_count` = true operating-company comparables in the approved GICS industry/
  sub-industry, excluding the candidate and names lacking current data for the metric.
- **≥8 → `peer_relative` · 6–7 → `blended_50_50` (½ peer + ½ absolute) · <6 →
  `absolute`.** `thin_peer_set:true` for the latter two.
- `thin_peer_set:true` → conviction **capped at 84** (no Tier 1) unless a separately
  recorded human override. Fallback never waives a hard gate, cures missing critical
  data, or overrides a sector substitution.
- Each agent ships its **own absolute-threshold table** (per-submetric 100/75/50/0%
  bands), a **valuation fallback cascade** (company history → sector benchmark →
  universal absolutes), and **special-sector absolute thresholds** (Banks/Insurers/REITs).
- 13F full points require 2 consecutive reported quarters (1 quarter caps at 75%).
- New proposal fields: `peer_count`, `thin_peer_set`, `fallback_method`, `peer_set_used`,
  `sector_substitutions_used`. → implementation is next-step #4/#5.

## 6. v2.1 mandate update (2026-07-12) — what changed and what it answers

The friend replaced v2.0 with **v2.1 launch-candidate** mandates
(`agent_mandates/*_v2_1.md`). Impact on this plan:

- **Architecture confirmed.** Every analyst §2 + Agent Four §8 assign peer
  classification, percentile ranking, sector substitution, technical calcs, and
  estimate-history storage to the deterministic backend — the Phase A design exactly.
- **Data sourcing answered (was open decision #2): FREE-ONLY, mandated.** Agent Four
  §8 forbids any paid market-data API and names the sources: **SEC EDGAR/XBRL**
  (financials, Form 4, 13F) as the *primary* fundamentals backbone, **yfinance**
  (cached) for consensus-estimate + institutional snapshots, **local SQLite** for
  estimate-revision history, **FRED/Treasury** for rates, **free classification + a
  deterministic local override table** for GICS peer sets. → The real W2-data build is
  an **EDGAR/XBRL ingestion**, not the Yahoo crawl. `lib/mandate-metrics.js` now
  populates only the interim yfinance subset (`revGrowth`, `peerValuation`); the rest
  are `null` pending EDGAR.
- **Scoring frame changed → config rewritten.** v2.1 dropped Category E and moved to
  **A25 · B30 · C30 · D15** with per-agent point splits and metric definitions;
  **removed from scoring entirely:** short interest, days to cover, insider buying,
  analyst price targets. Insider *selling* is now a deterministic trigger *outside* the
  score. `config/scoring/mandate-v2.js`, `lib/mandate-metrics.js`, and the tests are
  realigned to v2.1 (`npm test` 392 green). The engine (`lib/peer-scoring.js`) needed
  no change.
### EDGAR/XBRL ingestion — built (2026-07-12), inert, proven on live data

The mandated primary fundamentals source is now built and tested (404 suite green),
off the money/scan path:

- `lib/edgar.js` — extended with `cikForTicker` / `fetchCompanyFacts` /
  `fetchCompanyFactsBatch` (reuses the existing ticker→CIK loader; SEC User-Agent +
  paced; `EDGAR_RATE_MS`). I/O only.
- `lib/edgar-facts.js` — pure XBRL parser: `us-gaap` concept fallback chains,
  `quarterlySeries` (isolates the clean 3-month flow by ~90-day duration, dropping the
  10-Q year-to-date), `annualSeries`, `instantSeries`/`latestInstant`, dedup-by-period
  keeping latest `filed`.
- `lib/edgar-metrics.js` — pure derivations: quarterly YoY growth + acceleration,
  multi-year revenue consistency, EPS trajectory, gross-margin YoY trend, interest
  coverage (zero-debt sentinel), cash-runway quarters, equity ratio. `edgarMetricSubset`
  maps to config ids (first-cut YoY defaults; per-agent accel/consistency binding is
  the next config step — all variants are exposed in `_derived`).
- `lib/mandate-metrics.js` — `extractMetricVector(fundamentals, companyfacts?)` now
  populates revGrowth/epsTrajectory/marginTrend/balanceSheet from EDGAR when facts are
  supplied (yfinance still supplies peerValuation).
- `jobs/universe-refresh.js` — second flag `PEER_METRICS_EDGAR` (off) fetches
  companyfacts per enriched name during the paced nightly crawl.
- Tests: `tests/edgar.test.js` (synthetic fixture — parser + derivations, no network).
  Live smoke-verified on AAPL: 29 revenue quarters, revYoY 16.6%, epsYoY 21.8%,
  gross-margin trend +2.2pp, interest coverage 39.6×.

**Still `null` pending their sources:** `revBeat` (needs a cached consensus snapshot to
compare EDGAR revenue against), `estimateRevisions` (local SQLite snapshot history,
activation-gated), `instOwnershipDir` + `thirteenF` (EDGAR **13F** ingestion — a
separate endpoint from companyfacts). Next data tasks, in order: (1) per-agent metric
definitions bind to the `_derived` variants + distributions built per definition;
(2) yfinance consensus snapshot store → `revBeat` + estimate-revision history;
(3) EDGAR 13F ingestion → Category D.

- **New deterministic requirements (Phases B–D):** special-sector substitution map
  (Banks/Insurers/REITs — encoded in `SPECIAL_SECTOR_SUBSTITUTIONS`), estimate-revision
  activation gate (≥3 snapshots/≥30d), Agent Four's full allocator (trust-multiplier
  table, `target_share = 33.33% + 0.5×(trust − avg)`, 5%/70% bands ±10pp/wk, 10/15/20/25%
  fund drawdown scalars, 12/6-order + 20%/40% damage caps), the execution contract
  (2-min approval, 0.35%/0.75% reapproval), per-agent sell ladders + time-based
  dead-trade rule, corporate-action handling, and the data-source-contract metadata
  (source + timestamp on every field, global kill switch, audit logs).
