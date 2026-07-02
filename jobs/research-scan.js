import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
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
} from "../lib/redis.js";
import { sizeProposalAmount, hasOpenProposal, hasRecentProposal } from "../lib/proposal-sizing.js";
import { syncMarketScansFromRobinhood } from "../lib/market-scan-sync.js";
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
const TOP_N = 5;
const DEFAULT_AGENT_IDS = AGENTS.map((agent) => agent.id);

function loadAgentConfig(agentId) {
  const dir = path.join(__dirname, "..", "config", "agents", agentId);
  return {
    watchlist: JSON.parse(fs.readFileSync(path.join(dir, "watchlist.json"), "utf8")),
    weights: JSON.parse(fs.readFileSync(path.join(dir, "weights.json"), "utf8")),
    riskLimits: JSON.parse(fs.readFileSync(path.join(dir, "risk-limits.json"), "utf8")),
    personality: fs.readFileSync(path.join(dir, "personality.md"), "utf8").trim(),
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
  if (priorState?.tier !== assessment.tier) {
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

/**
 * Runs one agent's full scan (quant score -> AI overlay -> risk engine -> write) against
 * its own watchlist, but the SAME shared portfolio/spreadsheet as the other two agents —
 * so risk checks (sector/position-size limits) see real combined exposure across all
 * three agents, and one agent's proposal can be downgraded because of another agent's
 * existing position. One agent's failure doesn't block the others (see runResearchScan).
 */
async function runResearchScanForAgent(agent, sheets, spreadsheetId, sheetIds, { breaker, boundaryToken } = {}) {
  breaker = breaker ?? { tier: "NONE", drawdownPct: 0 };
  boundaryToken = boundaryToken ?? makeBoundaryToken();
  const evidenceFlags = []; // injection-suspect evidence collected across the run, Telegramed once at the end
  const { watchlist, weights: weightsConfig, riskLimits, personality } = loadAgentConfig(agent.id);
  const marketScans = await readMarketScans(sheets, spreadsheetId).catch((err) => {
    console.warn(`[Research] ${agent.id}: market scan context unavailable:`, err.message);
    return [];
  });
  const scanTickers = selectMarketScanTickers(agent.id, marketScans, watchlist.tickers);
  const universeTickers = [...new Set([...watchlist.tickers, ...scanTickers])];
  console.log(`[Research] ${agent.id}: scanning ${universeTickers.length} tickers (${watchlist.tickers.length} watchlist + ${scanTickers.length} Robinhood scan).`);

  const [fundamentals, holdingTickers, strategyNotes, heldReturnPct] = await Promise.all([
    fetchFundamentalsBatch(universeTickers),
    readHoldingsTickers(sheets, spreadsheetId),
    readAgentStrategyNotes(sheets, spreadsheetId, agent.id),
    readHoldingsReturnPct(sheets, spreadsheetId),
  ]);
  const persistentMemory = formatAgentMemoriesForPrompt(await listAgentMemories(agent.id));

  const now = new Date();
  const threeMonthsAgo = new Date(now);
  threeMonthsAgo.setMonth(now.getMonth() - 3);
  const oneMonthAgo = new Date(now);
  oneMonthAgo.setMonth(now.getMonth() - 1);
  const eightMonthsAgo = new Date(now);
  eightMonthsAgo.setMonth(now.getMonth() - 8);

  const candidates = [];
  for (const f of fundamentals) {
    if (f.error) {
      console.warn(`[Research] ${agent.id}: skipping ${f.ticker}: ${f.error}`);
      continue;
    }
    // One daily-bar fetch covers momentum, RSI, ATR, weekly vol, and ADDV (replaces the
    // prior two close-only fetches and feeds lib/indicators.js + the data gates).
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

    candidates.push({
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
    });
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

  // AI overlay: top quant movers + any current holdings (so held positions get reviewed too)
  const toReview = new Map();
  for (const c of scored.slice(0, TOP_N)) toReview.set(c.ticker, c);
  for (const ticker of scanTickers) {
    const c = scored.find((s) => s.ticker === ticker);
    if (c) toReview.set(ticker, c);
  }
  for (const ticker of holdingTickers) {
    const c = scored.find((s) => s.ticker === ticker);
    if (c) toReview.set(ticker, c);
  }

  console.log(`[Research] ${agent.id}: running AI overlay for ${toReview.size} tickers...`);
  const spyQuote = await fetchQuotes([watchlist.benchmark]);
  const spyEntryPrice = spyQuote[watchlist.benchmark]?.regularMarketPrice ?? null;

  // Current Agent One sub-vertical exposure (% of invested capital), for the v5
  // concentration cap. The risk engine still uses legacy field names internally.
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

  // Macro backdrop is a shared market fact (not agent memory/opinion) — fetch/cache once globally, not per-agent.
  let macroSnapshot = await getCachedMacro();
  if (!macroSnapshot) {
    macroSnapshot = await fetchMacroSnapshot();
    if (macroSnapshot) await setCachedMacro(macroSnapshot);
  }
  const macroText = formatMacroSnapshot(macroSnapshot);

  // Sizing/dedup context for auto-queueing risk-gated BUY/SELL calls into the approval
  // queue. openProposals is mutated as we queue within this loop so a later ticker (or
  // the next agent's run) doesn't double-queue against a list fetched before this run started.
  const totalPortfolioValue = await getCachedPortfolioTotalValue();
  const openProposals = await listAllProposals();
  let availableCashForBuys =
    (cashBalance ?? 0) -
    openProposals
      .filter((p) => p.side === "BUY" && p.status === "ApprovedForBrokerReview" && !p.fulfilledAt)
      .reduce((sum, p) => sum + (p.amountDollars ?? 0), 0);
  availableCashForBuys = Math.max(0, Math.round(availableCashForBuys * 100) / 100);
  const ordinarySellCooldownDays = riskLimits.ordinarySellCooldownDays ?? 7;

  const recommendations = [];
  for (const c of toReview.values()) {
    try {
    // Data-availability gate runs BEFORE the (expensive) AI overlay. Per the memo, missing
    // or stale required inputs are an automatic NO_TRADE — we never ask Claude to reason
    // over a candidate we can't fully see, and we never queue a proposal off it.
    if (c.dataGate && !c.dataGate.ok) {
      const reason = c.dataGate.reasons.join("; ") || "incomplete data";
      console.log(`[Research] ${agent.id}: NO_TRADE ${c.ticker} — ${reason}`);
      recommendations.push({
        date: new Date().toISOString().slice(0, 10),
        ticker: c.ticker,
        action: "HOLD",
        quantScore: c.quantScore ?? null,
        rationale: `NO_TRADE (data gate): ${reason}`,
        newsLinks: "",
        status: "pending",
        entryPrice: c.raw?.price?.regularMarketPrice ?? null,
        spyEntryPrice,
        targetWeight: 0,
        confidence: null,
        ruleCheck: `data_gate_blocked: ${reason}`,
      });
      continue;
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
    const scanSignalScan = sanitizeEvidenceItems(scanSignalsForTicker(marketScans, c.ticker), {
      kind: `scan:${c.ticker}`,
      textFields: ["signal", "notes"],
    });
    for (const flag of [...newsScan.flags, ...scanSignalScan.flags]) {
      evidenceFlags.push(flag);
      console.error(`[Evidence] ${agent.id}: instruction-like content redacted in ${flag.kind}: ${flag.reasons.join(", ")}`);
    }
    const safeNews = newsScan.items;
    const safeScanSignals = scanSignalScan.items;

    const recentFilings = await fetchRecentFilings(c.ticker, { limit: 3 });
    const proposalPolicy = [
      `Available cash for new BUY proposals before this ticker: $${availableCashForBuys.toFixed(2)} after accepted, unfilled BUY reserves.`,
      availableCashForBuys > 0
        ? "When free cash exists, it is acceptable to propose BUYs every scan day for names that clear the evidence/risk bar."
        : "When free cash is zero, do not treat hypothetical sale proceeds as available cash for a BUY proposal.",
      `Ordinary research-scan SELL/rotation proposals are cadence-capped to one SELL review per agent/ticker every ${ordinarySellCooldownDays} days.`,
      "A sell-funded replacement is a contingent rotation idea: first propose/review the SELL, then only propose the BUY after the sell is approved, filled, and cash is synced. Do not present a new BUY as funded until cash is real.",
      "Immediate risk exits from stop/kill-criteria monitors are handled by separate exit jobs and can bypass this ordinary rotation cadence.",
    ].join("\n");

    const overlayInput = {
      ticker: c.ticker,
      name: c.name,
      quantScore: c.quantScore,
      breakdown: c.breakdown,
      news: safeNews,
      strategyNotes,
      isHeld: holdingTickers.includes(c.ticker),
      nextEarningsDate: c.nextEarningsDate,
      analystTrend: c.analystTrend,
      insiderActivity: c.insiderActivity,
      recentFilings,
      marketScanSignals: safeScanSignals,
      macro: macroText,
      personality,
      persistentMemory,
      proposalPolicy,
      boundaryToken,
    };
    const proposal = await getAIRecommendation(overlayInput);
    if (proposal.suspectEvidence?.length) {
      evidenceFlags.push({ kind: `model:${c.ticker}`, reasons: proposal.suspectEvidence });
      console.error(`[Evidence] ${agent.id}: model flagged suspect evidence for ${c.ticker}: ${proposal.suspectEvidence.join("; ")}`);
    }

    const riskContext = {
      sector: c.subVertical,
      currentSectorWeightPct: subVerticalWeightPct[c.subVertical] ?? 0,
      currentPositionWeightPct: tickerWeightPct[c.ticker] ?? 0,
      // Friend's rule: never average down into a losing held position, and never let a
      // stale-data read slip past the AI overlay into a live proposal.
      isHeldAtLoss: (heldReturnPct[c.ticker] ?? 0) < 0,
      dataStale: c.dataGate ? c.dataGate.stale : false,
    };
    let rec = applyConvictionClamp(applyRiskChecks(proposal, riskContext, riskLimits), agent, c, riskLimits);

    // Circuit-breaker pre-gate: don't spend evaluator tokens on an action the
    // breaker tier can't admit anyway (BUYs at ≥12% drawdown, everything at HALT).
    if (rec.action !== "HOLD") {
      const breakerGate = applyBreakerToProposal(breaker.tier, rec.action, 1);
      if (!breakerGate.allowed) {
        rec = { ...rec, action: "HOLD", targetWeight: 0, overrideNotes: [...(rec.overrideNotes ?? []), breakerGate.note] };
      }
    }

    // Duplicate pre-check: an identical open proposal means this one can never
    // queue, so skip the evaluator spend and note why.
    const isDuplicateOpen =
      rec.action !== "HOLD" && hasOpenProposal(openProposals, { agentId: agent.id, ticker: c.ticker, side: rec.action });
    if (isDuplicateOpen) {
      rec.overrideNotes = [...(rec.overrideNotes ?? []), "duplicate_open_proposal: evaluator skipped, will not re-queue"];
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
            heldPositionWeightPct: tickerWeightPct[c.ticker] ?? 0,
            subVertical: c.subVertical ?? null,
          },
          newsBlock: safeNews.map((n) => `- ${n.title} (${n.url})\n  ${(n.content ?? "").slice(0, 300)}`).join("\n"),
          mandate: personality,
          boundaryToken,
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
          evidenceFlags.push({ kind: `evaluator:${c.ticker}`, reasons: finalEval.suspectEvidence });
        }
        if (finalEval.verdict === "APPROVE") {
          rec.overrideNotes = [
            ...(rec.overrideNotes ?? []),
            `evaluator: APPROVE${finalEval.revisions ? " after 1 revision" : ""}`,
          ];
        } else if (rec.action !== "HOLD") {
          console.log(`[Evaluator] ${agent.id}: ${c.ticker} ${rec.action} rejected — ${finalEval.critique.join("; ")}`);
          rec = {
            ...rec,
            action: "HOLD",
            targetWeight: 0,
            overrideNotes: [
              ...(rec.overrideNotes ?? []),
              `evaluator_reject: ${finalEval.critique.slice(0, 2).join("; ") || "no critique returned"}`,
            ],
          };
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
    if (rec.action !== "HOLD" && !hasOpenProposal(openProposals, { agentId: agent.id, ticker: c.ticker, side: rec.action })) {
      if (
        rec.action === "SELL" &&
        hasRecentProposal(openProposals, {
          agentId: agent.id,
          ticker: c.ticker,
          side: "SELL",
          cooldownDays: ordinarySellCooldownDays,
        })
      ) {
        rec.overrideNotes = [
          ...(rec.overrideNotes ?? []),
          `ordinary_sell_cooldown: skipped approval proposal because this position had a SELL review within ${ordinarySellCooldownDays} days`,
        ];
        console.log(
          `[Research] ${agent.id}: SELL ${c.ticker} blocked by ${ordinarySellCooldownDays}d ordinary sell cooldown.`
        );
      } else {
        let sized = sizeProposalAmount({
          action: rec.action,
          targetWeightPct: rec.targetWeight,
          totalPortfolioValue,
          // Actual position dollars — SELLs exit what's really held, and BUY
          // increments are computed against the same total-value denominator.
          currentPositionValue: heldAllocation.find((h) => h.ticker === c.ticker)?.marketValue ?? 0,
          cashAvailable: rec.action === "BUY" ? availableCashForBuys : undefined,
          limits: riskLimits,
        });

        // Circuit-breaker sizing pass: REDUCE tier halves BUY dollars; blocked tiers
        // were already downgraded pre-evaluator — this is a belt-and-braces recheck.
        if (sized) {
          const breakerGate = applyBreakerToProposal(breaker.tier, rec.action, sized.amountDollars);
          if (!breakerGate.allowed) {
            console.error(`[Breaker] ${agent.id}: ${rec.action} ${c.ticker} blocked at queue time — ${breakerGate.note}`);
            rec.overrideNotes = [...(rec.overrideNotes ?? []), breakerGate.note];
            sized = null;
          } else if (breakerGate.note) {
            rec.overrideNotes = [...(rec.overrideNotes ?? []), breakerGate.note];
            sized = { ...sized, amountDollars: breakerGate.amountDollars };
          }
        }

        if (sized) {
          if (sized.starterSized) {
            const slots = Math.max(1, riskLimits.starterPortfolioMaxPositions ?? 2);
            const currentPositions = heldAllocation.filter((h) => (h.marketValue ?? 0) > 0).length;
            const openStarterBuys = openProposals.filter(
              (p) =>
                p.agentId === agent.id &&
                p.side === "BUY" &&
                (p.status === "Pending" || (p.status === "ApprovedForBrokerReview" && !p.fulfilledAt))
            ).length;
            if (currentPositions + openStarterBuys >= slots) {
              console.log(
                `[Research] ${agent.id}: starter slots full (${currentPositions} positions + ${openStarterBuys} open BUYs / ${slots}) — skipping ${c.ticker} proposal.`
              );
              continue;
            }
          }

          const maxPrice = rec.action === "BUY" && entryPrice ? Math.round(entryPrice * 1.02 * 100) / 100 : null;
          const riskSummary = `Quant score ${c.quantScore}/100. Confidence ${rec.confidence ?? "n/a"}. Risk checks: ${
            rec.overrideNotes.length ? rec.overrideNotes.join("; ") : "all passed"
          }.${sized.starterSized ? " Small-account starter sizing used instead of strict target-weight sizing." : ""}${
            sized.clamped ? " Sized amount clamped to the $10,000 proposal cap." : ""
          }${sized.cashClamped ? ` Sized amount capped by idle cash available after accepted, unfilled BUY proposals ($${availableCashForBuys}).` : ""}${
            rec.action === "BUY" ? ` Idle cash remaining before this proposal: $${availableCashForBuys}.` : ""
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
              openProposals.push(created);
              if (created.side === "BUY") availableCashForBuys = Math.max(0, Math.round((availableCashForBuys - created.amountDollars) * 100) / 100);
              console.log(`[Research] ${agent.id}: queued ${rec.action} ${c.ticker} proposal ($${sized.amountDollars}).`);
            }
          } catch (err) {
            console.warn(`[Research] ${agent.id}: failed to queue proposal for ${c.ticker}:`, err.message);
          }
        }
      }
    }

    recommendations.push({
      date: new Date().toISOString().slice(0, 10),
      ticker: c.ticker,
      action: rec.action,
      quantScore: c.quantScore,
      rationale,
      newsLinks: news.map((n) => n.url).join(", "),
      status: "pending",
      entryPrice,
      spyEntryPrice,
      targetWeight: rec.targetWeight,
      confidence: rec.confidence,
      ruleCheck: rec.overrideNotes.length ? rec.overrideNotes.join("; ") : "OK",
    });
    } catch (err) {
      // One ticker failing (Anthropic 429/timeout, Yahoo hiccup, EDGAR outage)
      // must not discard every other ticker's finished research — especially
      // since proposals queued earlier in this loop already exist in Redis and
      // would otherwise have no matching recommendation row in the Sheet.
      console.error(`[Research] ${agent.id}: ${c.ticker} failed mid-review (continuing): ${err.message}`);
      recommendations.push({
        date: new Date().toISOString().slice(0, 10),
        ticker: c.ticker,
        action: "HOLD",
        quantScore: c.quantScore ?? null,
        rationale: `SCAN ERROR: ${err.message}`,
        newsLinks: "",
        status: "pending",
        entryPrice: c.raw?.price?.regularMarketPrice ?? null,
        spyEntryPrice,
        targetWeight: 0,
        confidence: null,
        ruleCheck: "scan_error",
      });
    }
  }

  await appendAgentRecommendations(sheets, spreadsheetId, sheetIds[agentTabName(agent.id)], agent.id, recommendations);
  console.log(`[Research] ${agent.id}: done — wrote ${recommendations.length} recommendations.`);

  // Injection-suspect evidence is a security signal Sam should see, not just a log line.
  if (evidenceFlags.length) {
    const summary = `⚠️ ${agent.id}: ${evidenceFlags.length} injection-suspect evidence item(s) redacted/flagged this scan: ${evidenceFlags
      .map((f) => f.kind)
      .join(", ")}`;
    try {
      await sendTelegram(summary);
    } catch (err) {
      console.error("[Evidence] Telegram alert failed:", err.message, "—", summary);
    }
  }
}

/**
 * Runs the research scan for one or more agents. Defaults to all registered
 * agents so newly-available cash can collect competing proposals from every desk.
 * Pass agentIds to override for a targeted diagnostic scan.
 */
export async function runResearchScan({ agentIds = DEFAULT_AGENT_IDS } = {}) {
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
      await runResearchScanForAgent(agent, sheets, spreadsheetId, sheetIds, { breaker, boundaryToken });
    } catch (err) {
      console.error(`[Research] ${agent.id} failed:`, err.message);
    }
  }
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const cliAgentIds = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
  runResearchScan(cliAgentIds.length ? { agentIds: cliAgentIds } : undefined).catch((e) => {
    console.error("[Research] Scan error:", e.message);
    process.exit(1);
  });
}
