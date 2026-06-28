---
date: "2026-06-26"
status: building
agent: agent-1
---

# Agent One — Aggressive Tech-Growth — Melded Spec + Build Plan

Source meld of two inputs:
- **Sam's master plan** (architecture, guardrails, approval boundary — already built).
- **Friend's "Agent One Investment Memo v2"** (investing philosophy/strategy).

**Conflict rule applied:** where the two disagreed, the friend's memo wins. Where they
agreed, kept the stronger version of each. This file is the source of truth for agent-1's
strategy and the build it requires. For now the system runs **one agent** (agent-1);
agents 2 & 3 stay deferred.

---

## Part A — Strategy spec (the mandate)

**Identity:** High-conviction, semi-aggressive growth. US-listed Software/SaaS +
Semiconductors only. Small/mid/micro-cap. Aggressive in entry, fast to exit. Never
average down. Never convert a losing short-term trade into a long-term hold. Cash is a
valid position; NO_TRADE is a rewarded output.

**The Four Questions every entry must answer:** (1) What is the falsifiable thesis?
(2) What would prove it wrong (→ pre-defined sell triggers)? (3) Why is this better than
cash or an index ETF? (4) Is the required data actually present? If 3 or 4 fail → NO_TRADE.

### Conflicts — resolved the friend's way

| Parameter | Was (Sam) | Now (friend) |
|---|---|---|
| Max position at entry | 8% | **15%** |
| Sector / sub-vertical cap | 25% | **75%** per sub-vertical (SaaS or Semis) |
| Min position | — | **2%** (below → close fully, don't trim) |
| Cash reserve | — | **5–10%** maintained at all times |
| Micro-cap liquidity floor | — | **$3M avg daily $ volume**, else NO_TRADE |
| Instruments | implicit | US equities only — no options/leverage/margin/ETF/ADR/OTC |
| Rebalance flag | — | position appreciating past **18%** flags for review |

### Investment universe
- US-listed NYSE/NASDAQ equities only.
- Sub-verticals: **Software/SaaS** and **Semiconductors** only. Consumer/retail excluded.
- Market cap: mid $2B–$10B (core), small $300M–$2B (highest return, more vol), micro
  <$300M (selective, only if ADDV ≥ $3M; else NO_TRADE). Large-cap excluded.

### Entry — signal grading (hard rule)
- **Strong (required, need ≥2 aligned):** EPS acceleration, earnings surprise + drift,
  margin expansion, revenue growth w/ improving unit economics, post-earnings momentum.
- **Confirmatory (sizing/timing only):** RSI trend, relative strength vs sector, volume
  on breakout, MACD crossover, insider buying.
- **Weak (excluded from qualification):** social sentiment, analyst PTs without earnings
  revision, generic sector tailwinds, chartism without fundamentals, meme momentum.

Primary financial metrics: EPS growth **and QoQ acceleration**; gross/net margin **trend**
(expansion); **forward P/E < trailing P/E**; P/S **peer-relative** (vs sub-vertical, not
market); earnings-surprise quality (≥5% beat, revenue-driven > cost-driven, guidance raise
for max conviction).

### Position sizing — conviction-based (not equal weight)
- **High** (≥2 strong + imminent catalyst + bullish price confirm): 10–15%.
- **Medium** (strong fundamentals, no near catalyst, confirmatory technicals): 5–10%.
- **Speculative/early** (micro-cap, thin history, single strong signal): 2–5%.
- No entry > 15%. Sizing down a winner OK; sizing up into a loser never permitted.
- Holdings count: 5–8 when setups scarce, 8–14 normal, up to 20 when rich. Never fill
  with marginal ideas to hit a count.

### Exit — three triggers + combined logic
- **T1 Volatility-adjusted weekly decline:** sell *review* when weekly decline > 1.5–2.0×
  that stock's own ATR / rolling-weekly σ. Price drop alone never auto-sells — cross-ref
  T2/T3. Data unavailable → HOLD + flag.
- **T2 Momentum reversal:** RSI(14) < 40 & falling from overbought; MACD bearish crossover
  2 consecutive sessions; relative strength vs SOX/IGV declining 3+ weeks. Momentum alone
  (no fundamental break) → **partial exit, reduce 30–50%**, re-evaluate weekly.
- **T3 Fundamental deterioration (highest weight, alone sufficient for full exit):**
  EPS/rev miss >5%; guidance cut; margin compression w/o credible reinvestment narrative;
  credibility event (restatement, surprise CFO exit, material adverse SEC filing). Don't
  wait for price to confirm — exit ahead of the repricing.

| Triggers active | Action | Speed |
|---|---|---|
| Fundamental deterioration only | Full exit | 1–2 sessions |
| Price drop + momentum reversal | Full exit | 1–2 sessions |
| All three simultaneously | Immediate full exit | same session if liquid |
| Momentum reversal only | Partial exit (30–50%) | re-eval weekly |
| Price drop only, within normal vol band | Hold | monitor daily |
| Data unavailable / stale | NO_TRADE / flag | do not act |

### Hard guardrails (backend-enforced, never agent discretion)
Max 15% entry · min 2% (else close) · micro-cap ADDV ≥ $3M · sub-vertical ≤ 75% ·
cash 5–10% · equities only · stale data (>1 session) → NO_TRADE · **no averaging down** ·
**no loss-to-hold reclassification**.

### Monitoring cadence
- **Daily:** price scan, RSI/MACD check, news + SEC filing alerts, flag T1/T2 same-day.
- **Weekly:** full review — vol-adjusted drawdown, RS vs IGV/SOX, size-vs-conviction
  re-score, re-eval partial exits.
- **On earnings (quarterly):** full fundamental re-underwrite + BUY/HOLD/SELL re-rate.
- **On-demand:** material event → immediate unscheduled review, may issue same-session exit.

### Governing principle (both plans agree)
The agent **recommends**; the backend **enforces and blocks**. This is the existing
`risk-engine.js` + `/approvals` boundary. Nothing auto-executes — every BUY/SELL/TRIM is a
proposal Sam approves in the dashboard before it reaches Robinhood.

---

## Part B — Architecture build plan

Mapped against the existing repo. **Reuse** = exists, **Extend** = modify, **Build** = new.

### Current state (already built)
Daily Yahoo fundamentals + chart bars (`lib/yahoo.js`) → cross-sectional quant scorer
(`lib/quant-scorer.js`, `config/agents/agent-1/weights.json`) → Claude AI overlay
(`lib/ai-overlay.js`, structured JSON: action/target_weight/thesis/risks/kill_criteria/
confidence) → deterministic risk engine (`lib/risk-engine.js`,
`config/agents/agent-1/risk-limits.json`) → auto-queued proposals into Redis approval
queue read by the dashboard `/approvals` page. Plus EDGAR filings, FRED macro, Tavily news,
track-record feedback loop, RBAC/audit. Single 5pm cron via PM2 on the Jetson.

### Gaps the memo requires

1. **Indicators layer — Build** `lib/indicators.js`
   RSI(14), MACD, ATR / rolling-weekly σ, ADDV, relative strength vs IGV/SOX. All
   computable from daily bars `yahoo.js` already fetches. Extend `fetchHistoricalCloses`
   (or add `fetchDailyBars`) to also return high/low/volume. Benchmark series for RS =
   IGV (software) + SOXX (semis), reference data only (not traded).
   *Caveat:* true intraday bid/ask spread isn't cheaply available from Yahoo. V1
   approximates liquidity via ADDV (price × volume) end-of-day; defer real-time spread to
   the Robinhood Agentic MCP quote feed.

2. **Screener / universe — Build** `lib/screener.js`
   Replace the static watchlist with a dynamic hunt: filter a source ticker list by
   `sector/industry` (already fetched) into SaaS vs Semis, market-cap band, ADDV floor.
   One genuinely new data dependency: a source NASDAQ/NYSE tech ticker list, refreshed
   periodically.

3. **Data-gate validator — Build** `lib/data-gates.js`
   Runs **before** the AI overlay. Checks required fields (earnings actuals vs consensus,
   fwd+trailing EPS from ≥2 sources, 4-qtr margin trend, current price/RSI, ADDV for
   micro-caps). Any stale/missing → emit NO_TRADE, skip the AI call. Backend self-certifies
   data, not the agent.

4. **Risk engine — Extend** `lib/risk-engine.js` + `agent-1/risk-limits.json`
   Numbers → 15/75/2%, cash 5–10%, ADDV floor, rebalance-flag at 18%. New hard blocks:
   averaging-down, loss-to-hold reclassification, stale-data → NO_TRADE.

5. **Conviction scorer — Extend** `lib/quant-scorer.js`
   Combine quant composite + strong-signal evidence count + catalyst proximity + price
   confirmation → `conviction_tier` → drives `target_weight_pct` per the sizing tiers.
   Add the memo's metrics: EPS QoQ acceleration, margin trend, fwd-vs-trailing P/E,
   P/S peer-relative, earnings-surprise quality.

6. **Position-state store — Extend** `lib/sheets.js`
   Persist `thesis` + `kill_criteria` + `entry_signals` with each open position so the
   exit monitor can test whether the original thesis is broken. Add columns to Holdings/
   Recommendations.

7. **Held-position exit monitor — Build** `jobs/monitor-positions.js`  ← the structural piece
   `research-scan.js` only generates *new* entries; nothing watches *open* positions. New
   daily job: for each holding, run T1/T2/T3 + combined-logic table → emit SELL/TRIM
   proposals into the same approval queue.

8. **Cadence — Extend** PM2 cron (Jetson)
   Daily `monitor-positions.js` + `research-scan.js`; weekly full re-score; on-earnings
   re-underwrite (off `calendarEvents`); on-demand event trigger from `edgar.js` filings +
   Tavily news.

9. **Reuse as-is:** approval queue + `/approvals` boundary, `createProposal()`/Redis
   schema, RBAC/audit, attribution + tax-lots, AI overlay Claude call (richer context).

### Build order — status (built 2026-06-26)
1. ✅ `lib/indicators.js` (RSI/MACD/ATR/weekly-σ/ADDV/relative-strength/sub-vertical) +
   `yahoo.js#fetchDailyBars` / `fetchEarningsSurprise`. 9 tests.
2. ✅ `agent-1/risk-limits.json` (15/75/2%, cash 5–10%, $3M ADDV, rebalance-flag 18%) +
   `risk-engine.js` hard blocks: stale-data NO_TRADE, no-averaging-down. 6 tests.
3. ✅ `lib/data-gates.js` (required-field + freshness + micro-cap liquidity gate), wired
   before the AI overlay in `research-scan.js` (gate fail → NO_TRADE, skip AI). 6 tests.
4. ✅ `jobs/monitor-positions.js` — T1/T2/T3 + combined-logic exit table over open
   positions → SELL/TRIM proposals (`lib/exit-signals.js`, 10 tests). Scheduled 4:45pm ET.
5. ✅ `lib/screener.js` (universe filter, 7 tests) + `lib/conviction.js` (signal grading →
   tier → target-weight cap, 6 tests), both wired into `research-scan.js`.
6. ✅ Cadence: `scheduler.js` runs exit monitor 4:45pm ET before the 5pm research scan;
   `npm run exit:monitor` added.

Deferred (documented limitations): true intraday bid/ask spread (V1 approximates via ADDV);
T3 margin-trend / guidance-cut / credibility-event detection (V1 fires T3 on EPS-surprise
only — guidance/margin/filing signals await the AI-overlay + EDGAR enrichment pass);
position-state columns persisting thesis/kill_criteria for richer exit re-underwriting.

**Net built:** 4 new lib modules (`indicators`, `data-gates`, `exit-signals`, `screener`,
`conviction`) + 1 new job (`monitor-positions`) + risk-engine/yahoo/sheets extensions +
scheduler wiring. Full suite 71/71 green. Nothing auto-executes — every BUY/SELL/TRIM is a
proposal in the `/approvals` queue.

### Boundaries held
No trade execution. Every BUY/SELL/TRIM is a proposal in the approval queue. `personality.md`
gets the Part A mandate **only once enforcement supports it**, so prompt and backend stay
in sync.
