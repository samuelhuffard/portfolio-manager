/**
 * Agent One held-position exit monitor — the structural piece the entry-side research
 * scan never had. For each open position it runs the memo's T1/T2/T3 triggers
 * (lib/exit-signals.js) and the combined-logic table, then queues a SELL or partial-SELL
 * (TRIM) proposal into the SAME /approvals queue the research scan uses.
 *
 * HARD BOUNDARY (unchanged): nothing here executes a trade or moves money. Every exit is a
 * proposal Sam approves in the dashboard before it ever reaches Robinhood. lib/redis.js
 * createProposal only accepts BUY/SELL, so a partial TRIM is queued as a SELL sized to the
 * reduce-% of the position's current market value.
 *
 * Scope: agent-1 only for now (the single active investing agent). Exits are attributed to
 * agent-1; when agent-2/agent-3 go live this loops over AGENTS with per-agent attribution.
 */

import "dotenv/config";
import { fileURLToPath } from "node:url";

import { fetchDailyBars, fetchFundamentals, fetchEarningsSurprise } from "../lib/yahoo.js";
import { avgDailyDollarVolume, classifySubVertical, rsi } from "../lib/indicators.js";
import { evaluateDataGates } from "../lib/data-gates.js";
import { evaluateExitSignals, resolveExitAction } from "../lib/exit-signals.js";
import {
  getServiceAccountClients,
  resolveSharedSpreadsheetId,
  readHoldingsAllocation,
  readHoldingsReturnPct,
} from "../lib/sheets.js";
import { listAllProposals, createProposal } from "../lib/redis.js";
import { hasOpenProposal } from "../lib/proposal-sizing.js";
import { buildHoldingMonitorCoverage } from "../lib/holding-monitor-coverage.js";

const AGENT_ID = "agent-1";

// Memo wants relative strength measured against the position's own sub-vertical benchmark,
// not the broad market. Use QQQ as the growth-tech fallback for v5's broader tech buckets.
const SUBVERTICAL_BENCHMARK = {
  "Software/SaaS": "IGV",
  Semiconductors: "SOXX",
  "Tech Infrastructure": "QQQ",
  "Tech Hardware": "QQQ",
  "Tech-Adjacent High-Growth": "QQQ",
};

// Per-run memoization only — the scheduler keeps this module alive for weeks,
// so a cross-run cache would compare fresh position closes against benchmark
// series frozen on day one (relative-strength exits drift into nonsense).
const benchmarkCache = new Map();
async function benchmarkClosesFor(subVertical, period1, period2) {
  const ticker = SUBVERTICAL_BENCHMARK[subVertical] || "QQQ";
  if (!benchmarkCache.has(ticker)) {
    const bars = await fetchDailyBars(ticker, { period1, period2 });
    benchmarkCache.set(ticker, bars.map((b) => b.close));
  }
  return { ticker, closes: benchmarkCache.get(ticker) };
}

export function exitProposalAmount(decision, marketValue) {
  if (!["SELL", "TRIM"].includes(decision?.action)) return null;
  if (!Number.isFinite(marketValue) || marketValue <= 0) {
    throw new Error(`${decision.action} signalled without a positive market value`);
  }
  const amount = Math.round(marketValue * (decision.reducePct / 100) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("exit proposal amount is not positive");
  return amount;
}

export function requireQueuedExitProposal(proposal) {
  if (!proposal) throw new Error("exit proposal could not be durably queued");
  return proposal;
}

export async function runExitMonitor() {
  benchmarkCache.clear();
  const { sheets, drive } = getServiceAccountClients();
  const spreadsheetId = await resolveSharedSpreadsheetId(sheets, drive);

  const [allocation, returnPct, openProposals] = await Promise.all([
    readHoldingsAllocation(sheets, spreadsheetId),
    readHoldingsReturnPct(sheets, spreadsheetId),
    listAllProposals(),
  ]);

  const now = new Date();
  const eightMonthsAgo = new Date(now);
  eightMonthsAgo.setMonth(now.getMonth() - 8);

  const held = allocation.filter((position) => position.shares !== 0);
  const flags = [];
  const coverage = { monitored: 0, degraded: 0, failed: 0, reasons: {} };
  const note = (reason) => { coverage.reasons[reason] = (coverage.reasons[reason] ?? 0) + 1; };
  const unnote = (reason) => {
    if (!reason || !coverage.reasons[reason]) return;
    coverage.reasons[reason] -= 1;
    if (coverage.reasons[reason] === 0) delete coverage.reasons[reason];
  };
  for (const { ticker, shares, marketValue } of held) {
    let accountedKind = null;
    let accountedReason = null;
    try {
      if (!Number.isFinite(shares) || shares < 0) {
        coverage.failed += 1;
        note("invalid_held_shares");
        continue;
      }
      const bars = await fetchDailyBars(ticker, { period1: eightMonthsAgo, period2: now });
      const [fundamentalsResult, surpriseResult] = await Promise.allSettled([
        fetchFundamentals(ticker), fetchEarningsSurprise(ticker),
      ]);
      const degradedReasons = [];
      const fundamentals = fundamentalsResult.status === "fulfilled" ? fundamentalsResult.value : { raw: {} };
      const surprise = surpriseResult.status === "fulfilled" ? surpriseResult.value : null;
      if (fundamentalsResult.status === "rejected") degradedReasons.push("fundamentals_unavailable");
      if (surpriseResult.status === "rejected") degradedReasons.push("earnings_surprise_unavailable");
      const closes = bars.map((b) => b.close);
      const subVertical = classifySubVertical(fundamentals);
      let benchTicker = SUBVERTICAL_BENCHMARK[subVertical] || "QQQ";
      let benchmarkCloses = [];
      try {
        const benchmark = await benchmarkClosesFor(subVertical, eightMonthsAgo, now);
        benchTicker = benchmark.ticker;
        benchmarkCloses = benchmark.closes;
      } catch {
        degradedReasons.push("benchmark_unavailable");
      }

      // T3 fundamental read. V1 fills EPS-surprise numerically; guidance cut / margin
      // compression / credibility events remain future AI-overlay + filing inputs (the
      // memo flags these as the highest-weight but least-automatable signals).
      const fundamental = surprise ? { epsSurprisePct: surprise.epsSurprisePct } : null;
      const marketCap = fundamentals.raw?.price?.marketCap ?? fundamentals.raw?.summaryDetail?.marketCap ?? null;
      const dataGate = evaluateDataGates({
        price: fundamentals.raw?.price?.regularMarketPrice ?? closes.at(-1) ?? null,
        trailingEps: fundamentals.raw?.defaultKeyStatistics?.trailingEps ?? null,
        forwardEps: fundamentals.raw?.defaultKeyStatistics?.forwardEps ?? null,
        grossMargins: fundamentals.raw?.financialData?.grossMargins ?? null,
        profitMargins: fundamentals.raw?.financialData?.profitMargins ?? null,
        rsi: rsi(closes, 14),
        lastBarDate: bars.length ? bars[bars.length - 1].date : null,
        marketCap,
        avgDollarVolume: avgDailyDollarVolume(bars, 30),
      });
      if (dataGate.missing?.length) degradedReasons.push("partial_data");

      const signals = evaluateExitSignals({
        closes,
        benchmarkCloses,
        fundamental,
        partialData: {
          availableDataScore: dataGate.availableDataScore,
          missing: dataGate.missing,
        },
      });
      const decision = resolveExitAction(signals);

      const line = `${ticker} (${subVertical ?? "—"}, RS vs ${benchTicker}): ${decision.action}` +
        (decision.action === "TRIM" ? ` -${decision.reducePct}%` : "") +
        ` — ${decision.reasons.join("; ")}`;
      console.log(`[ExitMonitor] ${line}`);
      flags.push(line);
      if (degradedReasons.length) {
        coverage.degraded += 1;
        accountedKind = "degraded";
        accountedReason = degradedReasons[0];
        note(accountedReason);
      } else {
        coverage.monitored += 1;
        accountedKind = "monitored";
      }

      if (decision.action !== "SELL" && decision.action !== "TRIM") continue;

      // Size the exit off current market value. createProposal only accepts BUY/SELL, so a
      // partial TRIM is a SELL of reducePct of the position.
      const amountDollars = exitProposalAmount(decision, marketValue);
      if (hasOpenProposal(openProposals, { agentId: AGENT_ID, ticker, side: "SELL" })) {
        console.log(`[ExitMonitor] ${ticker}: SELL proposal already open — not double-queuing.`);
        continue;
      }

      const rationale =
        `${decision.action === "TRIM" ? `Partial exit (reduce ${decision.reducePct}%)` : "Full exit"} — ` +
        decision.reasons.join("; ");
      const riskSummary =
        `Exit monitor T1=${signals.t1} T2=${signals.t2} T3=${signals.t3}. ` +
        `Speed: ${decision.speed}. Return-to-date ${returnPct[ticker] ?? "n/a"}%. ` +
        `Sized to ${decision.reducePct}% of $${Math.round(marketValue).toLocaleString()} market value.`;

      const created = await createProposal({
        agentId: AGENT_ID,
        ticker,
        side: "SELL",
        amountDollars,
        maxPrice: null,
        rationale,
        riskSummary,
      });
      requireQueuedExitProposal(created);
      openProposals.push(created);
      console.log(`[ExitMonitor] queued SELL ${ticker} ($${amountDollars}) — ${decision.action}.`);
    } catch (err) {
      console.error(`[ExitMonitor] ${ticker} failed:`, err.message);
      if (accountedKind) coverage[accountedKind] -= 1;
      unnote(accountedReason);
      coverage.failed += 1;
      note("monitoring_exception");
    }
  }

  const holdingMonitoring = buildHoldingMonitorCoverage({ expected: held.length, ...coverage });
  console.log(
    `[ExitMonitor] done — ${holdingMonitoring.monitored} monitored, ` +
    `${holdingMonitoring.degraded} explicitly degraded, ${holdingMonitoring.failed} failed ` +
    `of ${holdingMonitoring.expected} held positions.`
  );
  return { flags, holdingMonitoring };
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  runExitMonitor().catch((e) => {
    console.error("[ExitMonitor] error:", e.message);
    process.exit(1);
  });
}
