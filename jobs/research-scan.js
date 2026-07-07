import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { fetchFundamentals, fetchFundamentalsBatch, fetchDailyBars, fetchQuotes, percentChange } from "../lib/yahoo.js";
import { scoreCandidates } from "../lib/quant-scorer.js";
import { rsi, atr, avgDailyDollarVolume, weeklyVolatility, classifySubVertical } from "../lib/indicators.js";
import { evaluateDataGates } from "../lib/data-gates.js";
import { screenUniverse } from "../lib/screener.js";
import { assembleEntrySignals, assessConviction } from "../lib/conviction.js";
import { tavilySearch } from "../lib/tavily.js";
import { fetchRecentFilings } from "../lib/edgar.js";
import { fetchMacroSnapshot, formatMacroSnapshot } from "../lib/fred.js";
import { getAIRecommendation } from "../lib/ai-overlay.js";
import { applyRiskChecks } from "../lib/risk-engine.js";
import { evaluateProposal, resolveFinalVerdict } from "../lib/evaluator.js";
import { makeBoundaryToken, sanitizeEvidenceItems } from "../lib/evidence.js";
import { assessCircuitBreaker, applyBreakerToProposal } from "../lib/circuit-breaker.js";
import { sendMessage as sendTelegram } from "../lib/telegram.js";
import { formatAgentMemoriesForPrompt, listAgentMemories } from "../lib/agent-memory.js";
import {
  getCachedNews,
  setCachedNews,
  getCachedMacro,
  setCachedMacro,
  getCachedPortfolioTotalValue,
  listAllProposals,
  createProposal,
  getPortfolioHighWaterMark,
  setPortfolioHighWaterMark,
  getBreakerState,
  setBreakerState,
  getUniverseCatalog,
  setSlateSnapshot,
  setResearchScanStatus,
} from "../lib/redis.js";
import { sizeProposalAmount, hasOpenProposal, hasRecentProposal } from "../lib/proposal-sizing.js";
import { syncMarketScansFromRobinhood } from "../lib/market-scan-sync.js";
import { toScreenerCandidates } from "../lib/universe.js";
import { buildSlate, formatSlateCounts } from "../lib/candidate-slate.js";
import { readResearchLedger, applyResearchRecords, formatResearchHistoryForPrompt, summarizeResearchLedger } from "../lib/research-ledger.js";
import { getAthenaConfig, fetchAthenaDossier, athenaDossierToEvidence } from "../lib/athena.js";
import {
  getServiceAccountClients,
  resolveSharedSpreadsheetId,
  getSheetIds,
  readHoldingsTickers,
  readCashBalance,
  readHoldingsAllocation,
  readHoldingsReturnPct,
  readMarketScans,
  readAgentStrategyNotes,
  appendAgentRecommendations,
  agentTabName,
  readPerformanceHistory,
} from "../lib/sheets.js";
import { AGENTS } from "../config/agents.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_AGENT_IDS = AGENTS.map((agent) => agent.id);
const EVIDENCE_TELEGRAM_THRESHOLD = 3;

function blankAgentScanSummary(agentId) {
  return {
    agentId,
    status: "completed",
    recommendationsWritten: 0,
    attemptedReviews: 0,
    actionCounts: { BUY: 0, SELL: 0, HOLD: 0 },
    proposalsCreated: 0,
    proposalCounts: { BUY: 0, SELL: 0 },
    scanErrors: 0,
    evaluatorRejects: 0,
    startedAt: new Date().toISOString(),
    completedAt: null,
    error: null,
  };
}

function summarizeRecommendation(summary, recommendation) {
  if (!recommendation) return;
  summary.recommendationsWritten += 1;
  const action = recommendation.action;
  if (action === "BUY" || action === "SELL" || action === "HOLD") {
    summary.actionCounts[action] += 1;
  }
  const ruleCheck = recommendation.ruleCheck ?? "";
  if (ruleCheck.includes("scan_error")) summary.scanErrors += 1;
  if (ruleCheck.includes("evaluator_reject")) summary.evaluatorRejects += 1;
}

// A missing/broken universe.json quietly behaving like watchlist mode would be a
// silent no-op on the whole discovery funnel — keep the fallback, but loudly.
const DEFAULT_UNIVERSE_CONFIG = { source: "watchlist", slateSize: 20, aiReviewBudget: 12, researchCooldownDays: 14, explorationSlots: 0 };

function loadAgentConfig(agentId) {
  const dir = path.join(__dirname, "..", "config", "agents", agentId);
  let universe = DEFAULT_UNIVERSE_CONFIG;
  try {
    universe = { ...DEFAULT_UNIVERSE_CONFIG, ...JSON.parse(fs.readFileSync(path.join(dir, "universe.json"), "utf8")) };
  } catch (err) {
    console.error(`[Research] ${agentId}: universe.json unreadable (${err.message}) — falling back to watchlist source.`);
  }
  return {
    watchlist: JSON.parse(fs.readFileSync(path.join(dir, "watchlist.json"), "utf8")),
    weights: JSON.parse(fs.readFileSync(path.join(dir, "weights.json"), "utf8")),
    riskLimits: JSON.parse(fs.readFileSync(path.join(dir, "risk-limits.json"), "utf8")),
    personality: fs.readFileSync(path.join(dir, "personality.md"), "utf8").trim(),
    universe,
  };
}

/**
 * Resolves the portfolio drawdown circuit breaker (LOOP-DESIGN.md §2 step 5)
 * BEFORE any agent runs. Basis is NAV/unit when the investor ledger has one
 * (deposit/withdrawal-neutral); falls back to total portfolio value otherwise.
 * A basis switch resets the high-water mark rather than comparing across units.
 * Telegrams on tier CHANGE only, so a persistent drawdown doesn't spam.
 */
async function resolveCircuitBreaker(sheets, spreadsheetId) {
  let current = null;
  let basis = null;
  try {
    const history = await readPerformanceHistory(sheets, spreadsheetId);
    const last = history.at(-1);
    if (last?.navPerUnit != null && Number.isFinite(last.navPerUnit) && last.navPerUnit > 0) {
      current = last.navPerUnit;
      basis = "navPerUnit";
    }
  } catch (err) {
    console.warn("[Breaker] Performance history unavailable:", err.message);
  }
  if (current == null) {
    const totalValue = await getCachedPortfolioTotalValue();
    if (totalValue != null && Number.isFinite(totalValue) && totalValue > 0) {
      current = totalValue;
      basis = "totalValue";
    }
  }

  const stored = await getPortfolioHighWaterMark();
  const priorHwm = stored && stored.basis === basis ? stored.value : null;
  const assessment = assessCircuitBreaker({ current, highWaterMark: priorHwm });

  if (assessment.highWaterMark != null && basis) {
    await setPortfolioHighWaterMark({ value: assessment.highWaterMark, basis });
  }
  const priorState = await getBreakerState();
  await setBreakerState({ tier: assessment.tier, drawdownPct: assessment.drawdownPct, basis });

  if (assessment.tier !== "NONE") {
    console.error(
      `[Breaker] tier ${assessment.tier} active — drawdown ${assessment.drawdownPct ?? "?"}% from ${basis ?? "no"} high-water mark.`
    );
  }
  const priorTier = priorState?.tier ?? assessment.tier;
  if (priorTier !== assessment.tier) {
    const msg = `⚠️ Portfolio circuit breaker: ${priorState?.tier ?? "NONE"} → ${assessment.tier}${
      assessment.drawdownPct != null ? ` (drawdown ${assessment.drawdownPct}% on ${basis})` : " (no valuation data)"
    }`;
    try {
      await sendTelegram(msg);
    } catch (err) {
      console.error("[Breaker] Telegram alert failed:", err.message, "—", msg);
    }
  }
  return assessment;
}

function shouldTelegramEvidenceFlags(flags) {
  if (!flags.length) return false;
  // Deterministic news/model flags are common background telemetry. Escalate when
  // the independent evaluator sees suspect evidence, or when the scan has enough
  // separate flags to suggest a broader poisoned-data problem.
  return flags.some((flag) => flag.kind?.startsWith("evaluator:")) || flags.length >= EVIDENCE_TELEGRAM_THRESHOLD;
}

function summarizeEvidenceFlags(flags) {
  return flags
    .map((f) => f.kind)
    .filter(Boolean)
    .join(", ");
}

function selectMarketScanTickers(agentId, marketScans, watchlistTickers, limit = 5) {
  const watchlist = new Set(watchlistTickers.map((t) => t.toUpperCase()));
  const picked = [];
  const seen = new Set();
  for (const row of marketScans) {
    const ticker = row.ticker?.toUpperCase();
    if (!ticker || seen.has(ticker) || watchlist.has(ticker)) continue;
    const hint = row.agentHint?.trim();
    if (hint && hint !== agentId) continue;
    seen.add(ticker);
    picked.push(ticker);
    if (picked.length >= limit) break;
  }
  return picked;
}

function scanSignalsForTicker(marketScans, ticker) {
  return marketScans
    .filter((row) => row.ticker === ticker)
    .slice(0, 3)
    .map((row) => ({
      scanName: row.scanName,
      signal: row.signal,
      score: row.score,
      notes: row.notes,
    }));
}

/**
 * Conviction discipline (agent-1 memo): the AI overlay may size aggressively, but a
 * BUY can never exceed the position cap its strong-signal evidence earns. A single-
 * strong-signal "Speculative" name is clamped to 5% even if the model wanted 15%, and
 * an unqualified name (no strong signal) is downgraded to HOLD outright.
 * Extracted so the evaluator's revision path re-applies the same clamp.
 */
function applyConvictionClamp(rec, agent, candidate, riskLimits) {
  if (agent.id !== "agent-1" || rec.action !== "BUY") return rec;
  const entrySignals = assembleEntrySignals(candidate);
  const conviction = assessConviction(entrySignals, riskLimits);
  if (!conviction.qualified) {
    return {
      ...rec,
      action: "HOLD",
      targetWeight: 0,
      overrideNotes: [...(rec.overrideNotes ?? []), "conviction: unqualified (no strong signal) — downgraded to HOLD"],
    };
  }
  if (rec.targetWeight > conviction.maxWeightPct) {
    return {
      ...rec,
      targetWeight: conviction.maxWeightPct,
      overrideNotes: [
        ...(rec.overrideNotes ?? []),
        `conviction ${conviction.tier}: clamped ${rec.targetWeight}%→${conviction.maxWeightPct}%`,
      ],
    };
  }
  return rec;
}

/** Lookback windows used by the candidate builder (momentum + daily-bar history). */
function makeDateWindow(now = new Date()) {
  const threeMonthsAgo = new Date(now);
  threeMonthsAgo.setMonth(now.getMonth() - 3);
  const oneMonthAgo = new Date(now);
  oneMonthAgo.setMonth(now.getMonth() - 1);
  const eightMonthsAgo = new Date(now);
  eightMonthsAgo.setMonth(now.getMonth() - 8);
  return { now, threeMonthsAgo, oneMonthAgo, eightMonthsAgo };
}

/**
 * Builds one research candidate from a fetched fundamentals record: one daily-bar
 * fetch covers momentum, RSI, ATR, weekly vol, and ADDV (replaces the prior two
 * close-only fetches and feeds lib/indicators.js + the data gates). Extracted from
 * the scan's candidate loop so the lab single-ticker path builds candidates through
 * the identical code.
 */
async function buildCandidate(f, riskLimits, { now, threeMonthsAgo, oneMonthAgo, eightMonthsAgo }) {
  const bars = await fetchDailyBars(f.ticker, { period1: eightMonthsAgo, period2: now });
  const closes = bars.map((b) => b.close);
  const closesSince = (cutoff) => bars.filter((b) => new Date(b.date) >= cutoff).map((b) => ({ close: b.close }));
  const lastBarDate = bars.length ? bars[bars.length - 1].date : null;
  const addv = avgDailyDollarVolume(bars, 30);
  const marketCap = f.raw?.price?.marketCap ?? f.raw?.summaryDetail?.marketCap ?? null;

  const dataGate = evaluateDataGates(
    {
      price: f.raw?.price?.regularMarketPrice ?? null,
      trailingEps: f.raw?.defaultKeyStatistics?.trailingEps ?? null,
      forwardEps: f.raw?.defaultKeyStatistics?.forwardEps ?? null,
      grossMargins: f.raw?.financialData?.grossMargins ?? null,
      profitMargins: f.raw?.financialData?.profitMargins ?? null,
      rsi: rsi(closes, 14),
      lastBarDate,
      marketCap,
      avgDollarVolume: addv,
    },
    riskLimits,
    { now }
  );

  return {
    ...f,
    subVertical: classifySubVertical(f),
    momentum3m: percentChange(closesSince(threeMonthsAgo)),
    momentum1m: percentChange(closesSince(oneMonthAgo)),
    rsi: rsi(closes, 14),
    atr: atr(bars, 14),
    weeklyVol: weeklyVolatility(closes),
    avgDollarVolume: addv,
    marketCap,
    lastBarDate,
    dataGate,
  };
}

/**
 * Portfolio-wide context shared by every ticker an agent reviews in one run:
 * benchmark entry price; current exposure by ticker/sub-vertical (% of invested
 * capital, for the v5 concentration cap — the risk engine still uses legacy
 * field names internally); macro backdrop (shared market fact — fetched/cached
 * once globally, not per-agent); and the sizing/dedup context for auto-queueing
 * risk-gated BUY/SELL calls into the approval queue. openProposals and
 * availableCashForBuys are mutated as tickers queue within a run so a later
 * ticker (or the next agent's run) doesn't double-queue against a list fetched
 * before the run started.
 */
async function buildAgentReviewContext(sheets, spreadsheetId, { candidates, riskLimits, benchmark }) {
  const spyQuote = await fetchQuotes([benchmark]);
  const spyEntryPrice = spyQuote[benchmark]?.regularMarketPrice ?? null;

  const [heldAllocation, cashBalance] = await Promise.all([
    readHoldingsAllocation(sheets, spreadsheetId),
    readCashBalance(sheets, spreadsheetId),
  ]);
  const investedTotal = heldAllocation.reduce((sum, h) => sum + (h.marketValue ?? 0), 0);
  const tickerWeightPct = {};
  const subVerticalWeightPct = {};
  for (const h of heldAllocation) {
    if (!h.marketValue || !investedTotal) continue;
    const weightPct = (h.marketValue / investedTotal) * 100;
    tickerWeightPct[h.ticker] = weightPct;
    const known = candidates.find((c) => c.ticker === h.ticker)?.subVertical;
    const subVertical = known ?? classifySubVertical(await fetchFundamentals(h.ticker));
    if (subVertical) subVerticalWeightPct[subVertical] = (subVerticalWeightPct[subVertical] ?? 0) + weightPct;
  }

  let macroSnapshot = await getCachedMacro();
  if (!macroSnapshot) {
    macroSnapshot = await fetchMacroSnapshot();
    if (macroSnapshot) await setCachedMacro(macroSnapshot);
  }
  const macroText = formatMacroSnapshot(macroSnapshot);

  const totalPortfolioValue = await getCachedPortfolioTotalValue();
  const openProposals = await listAllProposals();
  let availableCashForBuys =
    (cashBalance ?? 0) -
    openProposals
      .filter((p) => p.side === "BUY" && p.status === "ApprovedForBrokerReview" && !p.fulfilledAt)
      .reduce((sum, p) => sum + (p.amountDollars ?? 0), 0);
  availableCashForBuys = Math.max(0, Math.round(availableCashForBuys * 100) / 100);
  const ordinarySellCooldownDays = riskLimits.ordinarySellCooldownDays ?? 7;

  return {
    spyEntryPrice,
    heldAllocation,
    tickerWeightPct,
    subVerticalWeightPct,
    macroText,
    totalPortfolioValue,
    openProposals,
    availableCashForBuys,
    ordinarySellCooldownDays,
  };
}

/**
 * Reviews ONE candidate for ONE agent through the exact production pipeline:
 * data gate → news fetch/fence → AI overlay generator → risk engine (downgrade-
 * only) → conviction clamp (agent-1) → circuit-breaker pre-gate → duplicate
 * open-proposal pre-check → independent evaluator (fail-closed, one revision
 * max) → sizing (starter sizing, cash cap, sell cooldown/dedupe) → breaker
 * sizing pass → createProposal(). Extracted verbatim from the scheduled scan's
 * per-ticker inner loop so the dashboard Lab's single-ticker entry point
 * (researchTickerForAgent) runs the SAME code path, never a parallel copy that
 * can drift. Nothing in here may ever upgrade an action — every step only
 * blocks, shrinks, or downgrades toward HOLD.
 *
 * Mutates ctx.availableCashForBuys / ctx.openProposals / ctx.evidenceFlags
 * exactly as the old loop mutated its locals, so multi-ticker runs keep the
 * same within-run dedupe/cash accounting.
 *
 * Returns { recommendation, researchRecord, rec, createdProposal,
 * evaluatorVerdict, noProposalReason }. recommendation/researchRecord are null
 * only on the starter-slots-full skip (matching the loop's old `continue`);
 * evaluatorVerdict/noProposalReason are advisory strings for the lab endpoint
 * and never feed back into any money decision.
 */
async function reviewCandidateForAgent(agent, c, ctx) {
  const { riskLimits } = ctx;
  let createdProposal = null;
  let evaluatorVerdict = null;
  let noProposalReason = null;

  // Data-availability gate runs BEFORE the (expensive) AI overlay. Per the memo, missing
  // or stale required inputs are an automatic NO_TRADE — we never ask Claude to reason
  // over a candidate we can't fully see, and we never queue a proposal off it.
  if (c.dataGate && !c.dataGate.ok) {
    const reason = c.dataGate.reasons.join("; ") || "incomplete data";
    console.log(`[Research] ${agent.id}: NO_TRADE ${c.ticker} — ${reason}`);
    return {
      recommendation: {
        date: new Date().toISOString().slice(0, 10),
        ticker: c.ticker,
        action: "HOLD",
        quantScore: c.quantScore ?? null,
        rationale: `NO_TRADE (data gate): ${reason}`,
        newsLinks: "",
        status: "pending",
        entryPrice: c.raw?.price?.regularMarketPrice ?? null,
        spyEntryPrice: ctx.spyEntryPrice,
        targetWeight: 0,
        confidence: null,
        ruleCheck: `data_gate_blocked: ${reason}`,
      },
      // A data-gate block still counts as "looked at" for slate rotation —
      // otherwise a permanently-gated name would occupy an exploration slot forever.
      researchRecord: {
        ticker: c.ticker,
        action: "NO_TRADE",
        quantScore: c.quantScore ?? null,
        confidence: null,
        thesis: `NO_TRADE (data gate): ${reason}`,
        entryPrice: c.raw?.price?.regularMarketPrice ?? null,
      },
      rec: null,
      createdProposal: null,
      evaluatorVerdict: "not run (data gate)",
      noProposalReason: `NO_TRADE (data gate): ${reason}`,
    };
  }

  // News is a market fact too — shared cache by ticker is fine and saves Tavily quota across agents.
  let news = await getCachedNews(c.ticker);
  if (!news) {
    try {
      news = await tavilySearch(`${c.ticker} ${c.name} stock news`, { maxResults: 3, days: 7 });
      await setCachedNews(c.ticker, news);
    } catch (err) {
      console.warn(`[Research] ${agent.id}: Tavily search failed for ${c.ticker}:`, err.message);
      news = []; // don't cache — let the next ticker/run retry instead of masking an outage for 12h
    }
  }

  // Fence-and-scan untrusted internet text before any model sees it (lib/evidence.js).
  // Cache keeps the ORIGINAL text; sanitization runs on every use so pattern updates apply to cached items too.
  const newsScan = sanitizeEvidenceItems(news, { kind: `news:${c.ticker}`, textFields: ["title", "content"] });
  const scanSignalScan = sanitizeEvidenceItems(scanSignalsForTicker(ctx.marketScans, c.ticker), {
    kind: `scan:${c.ticker}`,
    textFields: ["signal", "notes"],
  });
  for (const flag of [...newsScan.flags, ...scanSignalScan.flags]) {
    ctx.evidenceFlags.push(flag);
    console.error(`[Evidence] ${agent.id}: instruction-like content redacted in ${flag.kind}: ${flag.reasons.join(", ")}`);
  }
  const safeNews = newsScan.items;
  const safeScanSignals = scanSignalScan.items;

  // Optional Athena dossier (lib/athena.js): a second, locally-run research
  // system's read on this ticker. Config-gated off by default; fetched fresh
  // (local + free), then fenced and sanitized like every other external source.
  let safeAthenaEvidence = [];
  if (getAthenaConfig()) {
    const dossier = await fetchAthenaDossier(c.ticker);
    const athenaScan = sanitizeEvidenceItems(athenaDossierToEvidence(dossier), {
      kind: `athena:${c.ticker}`,
      textFields: ["content"],
    });
    for (const flag of athenaScan.flags) {
      ctx.evidenceFlags.push(flag);
      console.error(`[Evidence] ${agent.id}: instruction-like content redacted in ${flag.kind}: ${flag.reasons.join(", ")}`);
    }
    safeAthenaEvidence = athenaScan.items;
  }

  const recentFilings = await fetchRecentFilings(c.ticker, { limit: 3 });
  const proposalPolicy = [
    `Available cash for new BUY proposals before this ticker: $${ctx.availableCashForBuys.toFixed(2)} after accepted, unfilled BUY reserves.`,
    ctx.availableCashForBuys > 0
      ? "When free cash exists, it is acceptable to propose BUYs every scan day for names that clear the evidence/risk bar."
      : "When free cash is zero, do not treat hypothetical sale proceeds as available cash for a BUY proposal.",
    `Ordinary research-scan SELL/rotation proposals are cadence-capped to one SELL review per agent/ticker every ${ctx.ordinarySellCooldownDays} days.`,
    "A sell-funded replacement is a contingent rotation idea: first propose/review the SELL, then only propose the BUY after the sell is approved, filled, and cash is synced. Do not present a new BUY as funded until cash is real.",
    "Immediate risk exits from stop/kill-criteria monitors are handled by separate exit jobs and can bypass this ordinary rotation cadence.",
  ].join("\n");

  const overlayInput = {
    ticker: c.ticker,
    name: c.name,
    quantScore: c.quantScore,
    breakdown: c.breakdown,
    news: safeNews,
    strategyNotes: ctx.strategyNotes,
    isHeld: ctx.holdingTickers.includes(c.ticker),
    nextEarningsDate: c.nextEarningsDate,
    analystTrend: c.analystTrend,
    insiderActivity: c.insiderActivity,
    recentFilings,
    marketScanSignals: safeScanSignals,
    athenaEvidence: safeAthenaEvidence,
    macro: ctx.macroText,
    personality: ctx.personality,
    persistentMemory: ctx.persistentMemory,
    proposalPolicy,
    // The agent's own prior conclusion on this name (research ledger) — per-ticker,
    // so it belongs in the user message, never the cached system block.
    researchHistory: formatResearchHistoryForPrompt(ctx.researchLedger[c.ticker]),
    boundaryToken: ctx.boundaryToken,
  };
  const proposal = await getAIRecommendation(overlayInput);
  if (proposal.suspectEvidence?.length) {
    ctx.evidenceFlags.push({ kind: `model:${c.ticker}`, reasons: proposal.suspectEvidence });
    console.error(`[Evidence] ${agent.id}: model flagged suspect evidence for ${c.ticker}: ${proposal.suspectEvidence.join("; ")}`);
  }

  const riskContext = {
    sector: c.subVertical,
    currentSectorWeightPct: ctx.subVerticalWeightPct[c.subVertical] ?? 0,
    currentPositionWeightPct: ctx.tickerWeightPct[c.ticker] ?? 0,
    // Friend's rule: never average down into a losing held position, and never let a
    // stale-data read slip past the AI overlay into a live proposal.
    isHeldAtLoss: (ctx.heldReturnPct[c.ticker] ?? 0) < 0,
    dataStale: c.dataGate ? c.dataGate.stale : false,
  };
  let rec = applyConvictionClamp(applyRiskChecks(proposal, riskContext, riskLimits), agent, c, riskLimits);

  // Circuit-breaker pre-gate: don't spend evaluator tokens on an action the
  // breaker tier can't admit anyway (BUYs at ≥12% drawdown, everything at HALT).
  if (rec.action !== "HOLD") {
    const breakerGate = applyBreakerToProposal(ctx.breaker.tier, rec.action, 1);
    if (!breakerGate.allowed) {
      rec = { ...rec, action: "HOLD", targetWeight: 0, overrideNotes: [...(rec.overrideNotes ?? []), breakerGate.note] };
      evaluatorVerdict = "not run (circuit breaker)";
      noProposalReason = breakerGate.note;
    }
  }

  // Duplicate pre-check: an identical open proposal means this one can never
  // queue, so skip the evaluator spend and note why.
  const isDuplicateOpen =
    rec.action !== "HOLD" && hasOpenProposal(ctx.openProposals, { agentId: agent.id, ticker: c.ticker, side: rec.action });
  if (isDuplicateOpen) {
    rec.overrideNotes = [...(rec.overrideNotes ?? []), "duplicate_open_proposal: evaluator skipped, will not re-queue"];
    evaluatorVerdict = "skipped (duplicate open proposal)";
    noProposalReason = "duplicate open proposal exists — evaluator skipped, not re-queued";
  }

  // Independent evaluator (lib/evaluator.js): every actionable proposal is graded
  // by a separate skeptical model before it can reach Sam's approval queue.
  // Downgrade-only, one revision max, and any evaluator failure fails CLOSED.
  if (rec.action !== "HOLD" && !isDuplicateOpen) {
    try {
      const evalContext = {
        ticker: c.ticker,
        name: c.name,
        quantScore: c.quantScore,
        breakdown: c.breakdown,
        rawData: {
          price: c.raw?.price?.regularMarketPrice ?? null,
          marketCap: c.marketCap ?? null,
          momentum3mPct: c.momentum3m ?? null,
          momentum1mPct: c.momentum1m ?? null,
          rsi14: c.rsi ?? null,
          avgDailyDollarVolume: c.avgDollarVolume ?? null,
          heldPositionWeightPct: ctx.tickerWeightPct[c.ticker] ?? 0,
          subVertical: c.subVertical ?? null,
        },
        newsBlock: safeNews.map((n) => `- ${n.title} (${n.url})\n  ${(n.content ?? "").slice(0, 300)}`).join("\n"),
        mandate: ctx.personality,
        boundaryToken: ctx.boundaryToken,
      };

      let finalEval;
      const first = await evaluateProposal({ ...evalContext, proposal: rec });
      if (first.verdict === "REVISE") {
        console.log(`[Evaluator] ${agent.id}: ${c.ticker} sent back for revision — ${first.critique.join("; ")}`);
        const revisedRaw = await getAIRecommendation({ ...overlayInput, evaluatorCritique: first.critique, previousProposal: rec });
        const revised = applyConvictionClamp(applyRiskChecks(revisedRaw, riskContext, riskLimits), agent, c, riskLimits);
        if (revised.action === "HOLD") {
          // Generator conceded (or the risk engine downgraded the revision) — final HOLD.
          finalEval = { ...first, verdict: "REJECT", revisions: 1, critique: [...first.critique, "generator conceded on revision"] };
          rec = revised;
        } else {
          const second = await evaluateProposal({ ...evalContext, proposal: revised });
          finalEval = resolveFinalVerdict(first, second);
          if (finalEval.verdict === "APPROVE") rec = revised;
        }
      } else {
        finalEval = resolveFinalVerdict(first);
      }

      if (finalEval.suspectEvidence?.length) {
        ctx.evidenceFlags.push({ kind: `evaluator:${c.ticker}`, reasons: finalEval.suspectEvidence });
      }
      if (finalEval.verdict === "APPROVE") {
        rec.overrideNotes = [
          ...(rec.overrideNotes ?? []),
          `evaluator: APPROVE${finalEval.revisions ? " after 1 revision" : ""}`,
        ];
        evaluatorVerdict = `APPROVE${finalEval.revisions ? " after 1 revision" : ""}`;
      } else if (rec.action !== "HOLD") {
        console.log(`[Evaluator] ${agent.id}: ${c.ticker} ${rec.action} rejected — ${finalEval.critique.join("; ")}`);
        const critiqueText = finalEval.critique.slice(0, 2).join("; ") || "no critique returned";
        rec = {
          ...rec,
          action: "HOLD",
          targetWeight: 0,
          overrideNotes: [...(rec.overrideNotes ?? []), `evaluator_reject: ${critiqueText}`],
        };
        evaluatorVerdict = `REJECT${finalEval.revisions ? " after 1 revision" : ""}`;
        noProposalReason = `evaluator rejected: ${critiqueText}`;
      } else {
        // Generator conceded to HOLD on the revision path — rec already reflects it.
        evaluatorVerdict = "REJECT (generator conceded on revision)";
        noProposalReason = "evaluator sent the proposal back and the revised recommendation came back HOLD";
      }
    } catch (err) {
      // Evaluator infrastructure failure (API down, 429): fail closed — an
      // unevaluated actionable proposal must not reach the approval queue.
      console.error(`[Evaluator] ${agent.id}: ${c.ticker} evaluation errored (failing closed to HOLD): ${err.message}`);
      rec = {
        ...rec,
        action: "HOLD",
        targetWeight: 0,
        overrideNotes: [...(rec.overrideNotes ?? []), `evaluator_error (failed closed): ${err.message}`],
      };
      evaluatorVerdict = "error (failed closed)";
      noProposalReason = `evaluator error (failed closed to HOLD): ${err.message}`;
    }
  }

  const rationale = [
    rec.thesis,
    rec.risks.length ? `Risks: ${rec.risks.join("; ")}` : null,
    rec.killCriteria.length ? `Kill criteria: ${rec.killCriteria.join("; ")}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const entryPrice = c.raw?.price?.regularMarketPrice ?? null;

  // Risk-gated BUY/SELL calls go straight into Sam's approval queue instead of
  // waiting for him to read the Sheet and re-type a proposal by hand. He still
  // approves or rejects every one in the dashboard before anything is placed.
  if (rec.action !== "HOLD" && !hasOpenProposal(ctx.openProposals, { agentId: agent.id, ticker: c.ticker, side: rec.action })) {
    if (
      rec.action === "SELL" &&
      hasRecentProposal(ctx.openProposals, {
        agentId: agent.id,
        ticker: c.ticker,
        side: "SELL",
        cooldownDays: ctx.ordinarySellCooldownDays,
      })
    ) {
      rec.overrideNotes = [
        ...(rec.overrideNotes ?? []),
        `ordinary_sell_cooldown: skipped approval proposal because this position had a SELL review within ${ctx.ordinarySellCooldownDays} days`,
      ];
      console.log(
        `[Research] ${agent.id}: SELL ${c.ticker} blocked by ${ctx.ordinarySellCooldownDays}d ordinary sell cooldown.`
      );
      noProposalReason = `ordinary SELL cooldown: this position had a SELL review within ${ctx.ordinarySellCooldownDays} days`;
    } else {
      let sized = sizeProposalAmount({
        action: rec.action,
        targetWeightPct: rec.targetWeight,
        totalPortfolioValue: ctx.totalPortfolioValue,
        // Actual position dollars — SELLs exit what's really held, and BUY
        // increments are computed against the same total-value denominator.
        currentPositionValue: ctx.heldAllocation.find((h) => h.ticker === c.ticker)?.marketValue ?? 0,
        cashAvailable: rec.action === "BUY" ? ctx.availableCashForBuys : undefined,
        limits: riskLimits,
      });
      if (!sized) {
        noProposalReason = "sizing produced no proposal (position already at target weight, or nothing held to sell)";
      }

      // Circuit-breaker sizing pass: REDUCE tier halves BUY dollars; blocked tiers
      // were already downgraded pre-evaluator — this is a belt-and-braces recheck.
      if (sized) {
        const breakerGate = applyBreakerToProposal(ctx.breaker.tier, rec.action, sized.amountDollars);
        if (!breakerGate.allowed) {
          console.error(`[Breaker] ${agent.id}: ${rec.action} ${c.ticker} blocked at queue time — ${breakerGate.note}`);
          rec.overrideNotes = [...(rec.overrideNotes ?? []), breakerGate.note];
          sized = null;
          noProposalReason = breakerGate.note;
        } else if (breakerGate.note) {
          rec.overrideNotes = [...(rec.overrideNotes ?? []), breakerGate.note];
          sized = { ...sized, amountDollars: breakerGate.amountDollars };
        }
      }

      if (sized) {
        if (sized.starterSized) {
          const slots = Math.max(1, riskLimits.starterPortfolioMaxPositions ?? 2);
          const currentPositions = ctx.heldAllocation.filter((h) => (h.marketValue ?? 0) > 0).length;
          const openStarterBuys = ctx.openProposals.filter(
            (p) =>
              p.agentId === agent.id &&
              p.side === "BUY" &&
              (p.status === "Pending" || (p.status === "ApprovedForBrokerReview" && !p.fulfilledAt))
          ).length;
          if (currentPositions + openStarterBuys >= slots) {
            console.log(
              `[Research] ${agent.id}: starter slots full (${currentPositions} positions + ${openStarterBuys} open BUYs / ${slots}) — skipping ${c.ticker} proposal.`
            );
            // Matches the old loop's `continue`: no recommendation row, no ledger record.
            return {
              recommendation: null,
              researchRecord: null,
              rec,
              createdProposal: null,
              evaluatorVerdict,
              noProposalReason: `starter slots full (${currentPositions} positions + ${openStarterBuys} open BUYs / ${slots}) — proposal skipped`,
            };
          }
        }

        const maxPrice = rec.action === "BUY" && entryPrice ? Math.round(entryPrice * 1.02 * 100) / 100 : null;
        const riskSummary = `Quant score ${c.quantScore}/100. Confidence ${rec.confidence ?? "n/a"}. Risk checks: ${
          rec.overrideNotes.length ? rec.overrideNotes.join("; ") : "all passed"
        }.${sized.starterSized ? " Small-account starter sizing used instead of strict target-weight sizing." : ""}${
          sized.clamped ? " Sized amount clamped to the $10,000 proposal cap." : ""
        }${sized.cashClamped ? ` Sized amount capped by idle cash available after accepted, unfilled BUY proposals ($${ctx.availableCashForBuys}).` : ""}${
          rec.action === "BUY" ? ` Idle cash remaining before this proposal: $${ctx.availableCashForBuys}.` : ""
        }`;

        try {
          const created = await createProposal({
            agentId: agent.id,
            ticker: c.ticker,
            side: rec.action,
            amountDollars: sized.amountDollars,
            maxPrice,
            rationale,
            riskSummary,
          });
          if (created) {
            ctx.openProposals.push(created);
            if (created.side === "BUY") {
              ctx.availableCashForBuys = Math.max(0, Math.round((ctx.availableCashForBuys - created.amountDollars) * 100) / 100);
            }
            console.log(`[Research] ${agent.id}: queued ${rec.action} ${c.ticker} proposal ($${sized.amountDollars}).`);
            createdProposal = created;
          } else {
            // createProposal already screamed (Redis missing / write failure).
            noProposalReason = "proposal could not be written to the approval queue (Redis unavailable — see server logs)";
          }
        } catch (err) {
          console.warn(`[Research] ${agent.id}: failed to queue proposal for ${c.ticker}:`, err.message);
          noProposalReason = `failed to queue proposal: ${err.message}`;
        }
      }
    }
  }

  const researchRecord = {
    ticker: c.ticker,
    action: rec.action,
    quantScore: c.quantScore ?? null,
    confidence: rec.confidence ?? null,
    thesis: rec.thesis ?? "",
    entryPrice,
  };

  const recommendation = {
    date: new Date().toISOString().slice(0, 10),
    ticker: c.ticker,
    action: rec.action,
    quantScore: c.quantScore,
    rationale,
    newsLinks: news.map((n) => n.url).join(", "),
    status: "pending",
    entryPrice,
    spyEntryPrice: ctx.spyEntryPrice,
    targetWeight: rec.targetWeight,
    confidence: rec.confidence,
    ruleCheck: rec.overrideNotes.length ? rec.overrideNotes.join("; ") : "OK",
  };

  if (!createdProposal && !noProposalReason) {
    noProposalReason =
      rec.action === "HOLD"
        ? rec.overrideNotes?.length
          ? `HOLD after risk checks: ${rec.overrideNotes.join("; ")}`
          : "model recommended HOLD"
        : "no proposal was queued";
  }
  if (!evaluatorVerdict) evaluatorVerdict = "not run (HOLD before evaluator)";

  return { recommendation, researchRecord, rec, createdProposal, evaluatorVerdict, noProposalReason };
}

/**
 * Runs one agent's full scan (quant score -> AI overlay -> risk engine -> write) against
 * its own daily universe (catalog-sourced candidate slate, or seed watchlist for agents
 * without a mandate — see universe.json), but the SAME shared portfolio/spreadsheet as
 * the other two agents —
 * so risk checks (sector/position-size limits) see real combined exposure across all
 * three agents, and one agent's proposal can be downgraded because of another agent's
 * existing position. One agent's failure doesn't block the others (see runResearchScan).
 */
async function runResearchScanForAgent(agent, sheets, spreadsheetId, sheetIds, { breaker, boundaryToken } = {}) {
  const summary = blankAgentScanSummary(agent.id);
  breaker = breaker ?? { tier: "NONE", drawdownPct: 0 };
  boundaryToken = boundaryToken ?? makeBoundaryToken();
  const evidenceFlags = []; // injection-suspect evidence collected across the run, Telegramed once at the end
  const { watchlist, weights: weightsConfig, riskLimits, personality, universe: universeCfg } = loadAgentConfig(agent.id);
  const marketScans = await readMarketScans(sheets, spreadsheetId).catch((err) => {
    console.warn(`[Research] ${agent.id}: market scan context unavailable:`, err.message);
    return [];
  });

  // Holdings + research ledger come first now: the candidate slate needs both
  // before the day's universe is even known (catalog-sourced agents).
  const [holdingTickers, strategyNotes, heldReturnPct] = await Promise.all([
    readHoldingsTickers(sheets, spreadsheetId),
    readAgentStrategyNotes(sheets, spreadsheetId, agent.id),
    readHoldingsReturnPct(sheets, spreadsheetId),
  ]);
  const researchLedger = await readResearchLedger(agent.id);

  // For catalog agents the watchlist is no longer the universe — scan names only
  // need to dodge holdings (which the slate already guarantees a review for).
  const scanTickers = selectMarketScanTickers(
    agent.id,
    marketScans,
    universeCfg.source === "catalog" ? holdingTickers : watchlist.tickers
  );

  // Day's universe: catalog-sourced agents get a slate narrowed from the full
  // philosophy-screened NYSE/NASDAQ catalog (LOOP-DESIGN funnel); watchlist
  // agents (and any agent whose catalog is unavailable) keep the seed-list path.
  let universeTickers;
  let explorationTickers = new Set();
  if (universeCfg.source === "catalog") {
    const catalog = await getUniverseCatalog();
    const screenerCandidates = catalog ? toScreenerCandidates(catalog) : [];
    const { passed: screened } = screenUniverse(screenerCandidates, riskLimits);
    if (screened.length) {
      const { slate, counts } = buildSlate({
        screened,
        holdings: holdingTickers,
        scanTickers,
        ledger: researchLedger,
        config: universeCfg,
      });
      universeTickers = slate.map((s) => s.ticker);
      explorationTickers = new Set(slate.filter((s) => s.bucket === "exploration").map((s) => s.ticker));
      console.log(
        `[Research] ${agent.id}: slate = ${formatSlateCounts(counts)}; catalog ${screened.length} screened / ${screenerCandidates.length} sector-enriched / ${catalog ? Object.keys(catalog).length : 0} cataloged.`
      );
      // Phase 1 funnel observability (AUTONOMY-ROADMAP): persist the day's slate
      // composition + research-ledger coverage so /health can show the funnel
      // working instead of it living only in the log line above. Counts only —
      // the snapshot surfaces on the unauthenticated /health route.
      await setSlateSnapshot(agent.id, {
        date: new Date().toISOString().slice(0, 10),
        source: "catalog",
        counts,
        screened: screened.length,
        sectorEnriched: screenerCandidates.length,
        cataloged: catalog ? Object.keys(catalog).length : 0,
        aiReviewBudget: universeCfg.aiReviewBudget ?? 12,
        ledger: summarizeResearchLedger(researchLedger),
      });
    } else {
      // The scan must never starve to zero, but a missing catalog is a broken
      // discovery funnel — scream so it can't quietly regress to the static list.
      console.error(
        `[Research] ${agent.id}: universe catalog empty or unavailable — FALLING BACK to seed watchlist (${watchlist.tickers.length} names). Check jobs/universe-refresh.js.`
      );
      universeTickers = [...new Set([...watchlist.tickers, ...scanTickers])];
      await setSlateSnapshot(agent.id, {
        date: new Date().toISOString().slice(0, 10),
        source: "watchlist-fallback", // catalog unavailable — the funnel is broken, make that visible
        counts: null,
        screened: 0,
        sectorEnriched: 0,
        cataloged: 0,
        aiReviewBudget: universeCfg.aiReviewBudget ?? 12,
        ledger: summarizeResearchLedger(researchLedger),
      });
    }
  } else {
    universeTickers = [...new Set([...watchlist.tickers, ...scanTickers])];
    console.log(
      `[Research] ${agent.id}: scanning ${universeTickers.length} tickers (${watchlist.tickers.length} watchlist + ${scanTickers.length} Robinhood scan).`
    );
  }

  const fundamentals = await fetchFundamentalsBatch(universeTickers);
  const persistentMemory = formatAgentMemoriesForPrompt(await listAgentMemories(agent.id));

  const dateWindow = makeDateWindow();
  const candidates = [];
  for (const f of fundamentals) {
    if (f.error) {
      console.warn(`[Research] ${agent.id}: skipping ${f.ticker}: ${f.error}`);
      continue;
    }
    candidates.push(await buildCandidate(f, riskLimits, dateWindow));
  }

  // Universe screen (agent-1's memo-specific mandate): drop names outside the SaaS/Semis
  // sub-verticals + market-cap band + micro-cap liquidity floor before scoring, so quant
  // normalization only ranks eligible names. Other agents keep their own universes for now.
  let eligible = candidates;
  if (agent.id === "agent-1") {
    const { passed, rejected } = screenUniverse(candidates, riskLimits);
    for (const r of rejected) console.log(`[Research] ${agent.id}: screened out ${r.ticker} — ${r.reason}`);
    eligible = passed.length ? passed : candidates; // never starve the scan to zero on a bad data day
  }

  const scored = scoreCandidates(eligible, weightsConfig.quant_weights);

  // AI overlay selection under a hard daily budget (cost guardrail). Priority:
  // holdings are ALWAYS reviewed (even past the budget — a held position must
  // never go unwatched because discovery filled the day's slots), then the
  // exploration names the slate reserved, then Robinhood scan signals, then
  // top-quant fill until the budget is spent.
  const aiReviewBudget = Math.max(1, universeCfg.aiReviewBudget ?? 12);
  const toReview = new Map();
  const addToReview = (ticker, { exempt = false } = {}) => {
    if (toReview.has(ticker)) return;
    if (!exempt && toReview.size >= aiReviewBudget) return;
    const c = scored.find((s) => s.ticker === ticker);
    if (c) toReview.set(ticker, c);
  };
  for (const ticker of holdingTickers) addToReview(ticker, { exempt: true });
  for (const ticker of explorationTickers) addToReview(ticker);
  for (const ticker of scanTickers) addToReview(ticker);
  for (const c of scored) {
    if (toReview.size >= aiReviewBudget) break;
    addToReview(c.ticker);
  }

  console.log(`[Research] ${agent.id}: running AI overlay for ${toReview.size} tickers (budget ${aiReviewBudget}, holdings exempt)...`);
  summary.attemptedReviews = toReview.size;

  const reviewContext = await buildAgentReviewContext(sheets, spreadsheetId, {
    candidates,
    riskLimits,
    benchmark: watchlist.benchmark,
  });

  const ctx = {
    ...reviewContext,
    riskLimits,
    personality,
    strategyNotes,
    persistentMemory,
    marketScans,
    holdingTickers,
    heldReturnPct,
    researchLedger,
    breaker,
    boundaryToken,
    evidenceFlags,
  };

  const recommendations = [];
  const researchRecords = []; // research-ledger updates, persisted once after the loop
  for (const c of toReview.values()) {
    try {
      const { recommendation, researchRecord, createdProposal } = await reviewCandidateForAgent(agent, c, ctx);
      if (researchRecord) researchRecords.push(researchRecord);
      if (createdProposal) {
        summary.proposalsCreated += 1;
        if (createdProposal.side === "BUY" || createdProposal.side === "SELL") {
          summary.proposalCounts[createdProposal.side] += 1;
        }
      }
      if (recommendation) {
        recommendations.push(recommendation);
        summarizeRecommendation(summary, recommendation);
      }
    } catch (err) {
      // One ticker failing (Anthropic 429/timeout, Yahoo hiccup, EDGAR outage)
      // must not discard every other ticker's finished research — especially
      // since proposals queued earlier in this loop already exist in Redis and
      // would otherwise have no matching recommendation row in the Sheet.
      console.error(`[Research] ${agent.id}: ${c.ticker} failed mid-review (continuing): ${err.message}`);
      const recommendation = {
        date: new Date().toISOString().slice(0, 10),
        ticker: c.ticker,
        action: "HOLD",
        quantScore: c.quantScore ?? null,
        rationale: `SCAN ERROR: ${err.message}`,
        newsLinks: "",
        status: "pending",
        entryPrice: c.raw?.price?.regularMarketPrice ?? null,
        spyEntryPrice: ctx.spyEntryPrice,
        targetWeight: 0,
        confidence: null,
        ruleCheck: "scan_error",
      };
      recommendations.push(recommendation);
      summarizeRecommendation(summary, recommendation);
    }
  }

  await appendAgentRecommendations(sheets, spreadsheetId, sheetIds[agentTabName(agent.id)], agent.id, recommendations);
  console.log(`[Research] ${agent.id}: done — wrote ${recommendations.length} recommendations.`);

  // Persist this run's research memory (advisory: rotation + prompt context only,
  // so one write after the loop — a failed run just re-researches sooner).
  await applyResearchRecords(agent.id, researchRecords);

  // Injection-suspect evidence is logged every time, but Telegram only escalates
  // higher-signal cases so routine single-source redactions don't look like bot replies.
  if (shouldTelegramEvidenceFlags(evidenceFlags)) {
    const summary = `⚠️ Scheduled research scan safety alert: ${agent.id} flagged ${evidenceFlags.length} evidence item(s): ${summarizeEvidenceFlags(evidenceFlags)}`;
    try {
      await sendTelegram(summary);
    } catch (err) {
      console.error("[Evidence] Telegram alert failed:", err.message, "—", summary);
    }
  } else if (evidenceFlags.length) {
    console.warn(`[Evidence] ${agent.id}: ${evidenceFlags.length} low-severity evidence flag(s) logged without Telegram: ${summarizeEvidenceFlags(evidenceFlags)}`);
  }
  summary.completedAt = new Date().toISOString();
  return summary;
}

/**
 * Runs the research scan for one or more agents. Defaults to all registered
 * agents so newly-available cash can collect competing proposals from every desk.
 * Pass agentIds to override for a targeted diagnostic scan.
 */
export async function runResearchScan({ agentIds = DEFAULT_AGENT_IDS, source = "scheduled" } = {}) {
  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  const agentSummaries = [];
  const persistFinalStatus = async (status, error = null) => {
    const completedAt = new Date().toISOString();
    await setResearchScanStatus({
      runId,
      source,
      status,
      startedAt,
      completedAt,
      durationMs: Date.parse(completedAt) - Date.parse(startedAt),
      agents: agentSummaries,
      totals: agentSummaries.reduce(
        (acc, agent) => ({
          recommendationsWritten: acc.recommendationsWritten + agent.recommendationsWritten,
          attemptedReviews: acc.attemptedReviews + agent.attemptedReviews,
          proposalsCreated: acc.proposalsCreated + agent.proposalsCreated,
          scanErrors: acc.scanErrors + agent.scanErrors,
          evaluatorRejects: acc.evaluatorRejects + agent.evaluatorRejects,
        }),
        { recommendationsWritten: 0, attemptedReviews: 0, proposalsCreated: 0, scanErrors: 0, evaluatorRejects: 0 }
      ),
      error,
    });
  };

  await setResearchScanStatus({
    runId,
    source,
    status: "running",
    startedAt,
    completedAt: null,
    agents: [],
    error: null,
  });

  try {
    // Refresh the shared Market Scans tab from Robinhood before any agent reads it, so
    // scanTickers (see selectMarketScanTickers above) can include names outside each
    // agent's static watchlist. Never blocks the scan — a failure here just leaves
    // agents scanning their watchlists only, same as before this existed.
    try {
      const count = await syncMarketScansFromRobinhood();
      console.log(`[Research] Market scan refresh: ${count} row(s) from Robinhood.`);
    } catch (err) {
      console.warn("[Research] Market scan refresh failed — continuing with watchlists only:", err.message);
    }

    const { sheets, drive } = getServiceAccountClients();
    const spreadsheetId = await resolveSharedSpreadsheetId(sheets, drive);
    const sheetIds = await getSheetIds(sheets, spreadsheetId);

    // System-wide gates computed ONCE per run, before any agent: the drawdown
    // circuit breaker (restricts what any agent may queue) and the per-run
    // boundary token for untrusted-evidence fencing.
    const breaker = await resolveCircuitBreaker(sheets, spreadsheetId);
    const boundaryToken = makeBoundaryToken();

    const activeAgents = AGENTS.filter((a) => agentIds.includes(a.id));
    for (const agent of activeAgents) {
      try {
        const summary = await runResearchScanForAgent(agent, sheets, spreadsheetId, sheetIds, { breaker, boundaryToken });
        agentSummaries.push(summary);
      } catch (err) {
        console.error(`[Research] ${agent.id} failed:`, err.message);
        agentSummaries.push({
          ...blankAgentScanSummary(agent.id),
          status: "failed",
          completedAt: new Date().toISOString(),
          error: err.message,
        });
      }
    }
    const status = agentSummaries.some((agent) => agent.status === "failed") ? "failed" : "completed";
    await persistFinalStatus(status, status === "failed" ? "One or more agents failed. See per-agent status." : null);
  } catch (err) {
    console.error("[Research] Scan failed before completion:", err.message);
    await persistFinalStatus("failed", err.message);
    throw err;
  }
}

/**
 * Lab entry point (dashboard Lab → POST /research-ticker in server.js): run the
 * FULL research pipeline for one ticker, one agent, on demand — circuit breaker
 * and boundary token resolved first exactly like a scheduled run, then the same
 * reviewCandidateForAgent() code path the scan uses (this is an extra entry
 * point, not a parallel pipeline). Leaves the same audit trail as the scan
 * (recommendation row on the agent's tab + research-ledger record) and queues a
 * properly-sized proposal into Sam's approval queue only if the candidate clears
 * every gate. Throws on unusable input/data — the HTTP layer records the error.
 *
 * Returns { ticker, agentId, quantScore, rec, recommendation, createdProposal,
 * evaluatorVerdict, noProposalReason } for lib/lab-research.js buildLabOutcome().
 */
export async function researchTickerForAgent(agentId, ticker) {
  const agent = AGENTS.find((a) => a.id === agentId);
  if (!agent) throw new Error(`Unknown agentId: ${agentId}`);
  const symbol = String(ticker ?? "").trim().toUpperCase();
  if (!symbol) throw new Error("ticker is required");

  const { watchlist, weights: weightsConfig, riskLimits, personality } = loadAgentConfig(agent.id);

  const { sheets, drive } = getServiceAccountClients();
  const spreadsheetId = await resolveSharedSpreadsheetId(sheets, drive);
  const sheetIds = await getSheetIds(sheets, spreadsheetId);

  // Same system-wide gates as the scheduled scan, resolved before any review.
  const breaker = await resolveCircuitBreaker(sheets, spreadsheetId);
  const boundaryToken = makeBoundaryToken();
  const evidenceFlags = [];

  const marketScans = await readMarketScans(sheets, spreadsheetId).catch((err) => {
    console.warn(`[Research] ${agent.id}: market scan context unavailable:`, err.message);
    return [];
  });
  const [holdingTickers, strategyNotes, heldReturnPct] = await Promise.all([
    readHoldingsTickers(sheets, spreadsheetId),
    readAgentStrategyNotes(sheets, spreadsheetId, agent.id),
    readHoldingsReturnPct(sheets, spreadsheetId),
  ]);
  const researchLedger = await readResearchLedger(agent.id);

  const [fundamentals] = await fetchFundamentalsBatch([symbol]);
  if (!fundamentals || fundamentals.error) {
    throw new Error(`No usable market data for ${symbol}: ${fundamentals?.error ?? "no fundamentals returned"}`);
  }
  const candidateRaw = await buildCandidate(fundamentals, riskLimits, makeDateWindow());

  // Screener parity with the scheduled scan: agent-1's universe screen never
  // starves a scan to zero (eligible falls back to all candidates when nothing
  // passes), so a single-name slate that fails the screen is still reviewed —
  // but the failure is logged the same way the scan logs it, and the data gate /
  // risk engine / evaluator downstream still apply in full.
  if (agent.id === "agent-1") {
    const { rejected } = screenUniverse([candidateRaw], riskLimits);
    for (const r of rejected) {
      console.log(
        `[Research] ${agent.id}: screened out ${r.ticker} — ${r.reason} (lab single-ticker run continues, matching the scan's never-starve fallback)`
      );
    }
  }

  // Quant score normalizes within the slate; a single-name slate scores against itself.
  const [candidate] = scoreCandidates([candidateRaw], weightsConfig.quant_weights);

  const persistentMemory = formatAgentMemoriesForPrompt(await listAgentMemories(agent.id));
  const reviewContext = await buildAgentReviewContext(sheets, spreadsheetId, {
    candidates: [candidate],
    riskLimits,
    benchmark: watchlist.benchmark,
  });

  const ctx = {
    ...reviewContext,
    riskLimits,
    personality,
    strategyNotes,
    persistentMemory,
    marketScans,
    holdingTickers,
    heldReturnPct,
    researchLedger,
    breaker,
    boundaryToken,
    evidenceFlags,
  };

  const result = await reviewCandidateForAgent(agent, candidate, ctx);

  // Same output paths as the scheduled scan (Sheet row + research ledger). A
  // failed Sheet write must not strand an already-queued proposal or lose the
  // lab outcome, so it is LOUD but not fatal.
  if (result.recommendation) {
    try {
      await appendAgentRecommendations(sheets, spreadsheetId, sheetIds[agentTabName(agent.id)], agent.id, [result.recommendation]);
    } catch (err) {
      console.error(`[Research] ${agent.id}: LAB RUN failed to write recommendation row for ${symbol} (proposal state unaffected): ${err.message}`);
    }
  }
  if (result.researchRecord) {
    try {
      await applyResearchRecords(agent.id, [result.researchRecord]);
    } catch (err) {
      console.error(`[Research] ${agent.id}: LAB RUN failed to update research ledger for ${symbol}: ${err.message}`);
    }
  }

  if (shouldTelegramEvidenceFlags(evidenceFlags)) {
    const summary = `⚠️ Lab research safety alert: ${agent.id} flagged ${evidenceFlags.length} evidence item(s) on ${symbol}: ${summarizeEvidenceFlags(evidenceFlags)}`;
    try {
      await sendTelegram(summary);
    } catch (err) {
      console.error("[Evidence] Telegram alert failed:", err.message, "—", summary);
    }
  } else if (evidenceFlags.length) {
    console.warn(`[Evidence] ${agent.id}: ${evidenceFlags.length} low-severity evidence flag(s) logged without Telegram: ${summarizeEvidenceFlags(evidenceFlags)}`);
  }

  return {
    ticker: symbol,
    agentId: agent.id,
    quantScore: candidate.quantScore ?? null,
    rec: result.rec,
    recommendation: result.recommendation,
    createdProposal: result.createdProposal,
    evaluatorVerdict: result.evaluatorVerdict,
    noProposalReason: result.noProposalReason,
  };
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const cliAgentIds = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
  runResearchScan(cliAgentIds.length ? { agentIds: cliAgentIds } : undefined).catch((e) => {
    console.error("[Research] Scan error:", e.message);
    process.exit(1);
  });
}
