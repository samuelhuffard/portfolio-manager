/**
 * Ownership-aware held-position exit monitor. Every verified specialist lot is
 * evaluated through the same common mandate-policy interface, then any
 * mandate-specific SELL_FULL or SELL_PARTIAL result is queued into the SAME
 * /approvals queue the research scan uses.
 *
 * HARD BOUNDARY (unchanged): nothing here executes a trade or moves money. Every exit is a
 * proposal Sam approves in the dashboard before it ever reaches Robinhood. lib/redis.js
 * createProposal only accepts BUY/SELL, so a partial TRIM is queued as a SELL sized to the
 * reduce-% of the position's current market value.
 *
 * Each mandate receives only honestly sourced evidence for its own rules.
 * Missing evidence stays explicit and fail-closed; no agent inherits another
 * mandate's exit behavior.
 */

import "dotenv/config";
import { fileURLToPath } from "node:url";

import { fetchDailyBars, fetchFundamentals } from "../lib/yahoo.js";
import {
  getServiceAccountClients,
  resolveSharedSpreadsheetId,
  readAllLots,
  readHoldingsAllocation,
  readLatestAccountingProjection,
} from "../lib/sheets.js";
import { listAllProposals, createProposal } from "../lib/redis.js";
import { hasOpenProposal } from "../lib/proposal-sizing.js";
import { buildHoldingMonitorCoverage } from "../lib/holding-monitor-coverage.js";
import {
  initializeSpecialistHoldingCoverage,
  projectSpecialistMonitorHoldings,
} from "../lib/holding-monitor-ownership.js";
import {
  buildLiveHoldingMandateEvidence,
  canQueueHoldingPolicyExit,
  holdingPolicyExitAmount,
} from "../lib/holding-mandate-evidence.js";
import { evaluateMandateHolding } from "../lib/mandate-policy.js";

// Agent One v3 measures relative strength against the broad sector, not its
// retired technology-only sub-vertical taxonomy.
const SECTOR_BENCHMARK = {
  Technology: "XLK",
  "Financial Services": "XLF",
  Healthcare: "XLV",
  Industrials: "XLI",
  "Consumer Cyclical": "XLY",
  "Consumer Defensive": "XLP",
  Energy: "XLE",
  Utilities: "XLU",
  "Real Estate": "XLRE",
  "Basic Materials": "XLB",
  "Communication Services": "XLC",
};

export function holdingBenchmarkTicker(agentId, sector) {
  if (agentId === "agent-1") return SECTOR_BENCHMARK[sector] ?? "SPY";
  if (agentId === "agent-2") return "SPY";
  return null;
}

// Per-run memoization only — the scheduler keeps this module alive for weeks,
// so a cross-run cache would compare fresh position closes against benchmark
// series frozen on day one (relative-strength exits drift into nonsense).
const benchmarkCache = new Map();
async function benchmarkBarsFor(ticker, period1, period2) {
  if (!benchmarkCache.has(ticker)) {
    const bars = await fetchDailyBars(ticker, { period1, period2 });
    benchmarkCache.set(ticker, bars);
  }
  return benchmarkCache.get(ticker);
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

  const [allocation, verifiedLots, openProposals, accountingProjection] = await Promise.all([
    readHoldingsAllocation(sheets, spreadsheetId),
    readAllLots(sheets, spreadsheetId),
    listAllProposals(),
    readLatestAccountingProjection(sheets, spreadsheetId),
  ]);
  const ownership = projectSpecialistMonitorHoldings({ holdings: allocation, lots: verifiedLots });

  const now = new Date();
  const asOf = now.toISOString();
  const fifteenMonthsAgo = new Date(now);
  fifteenMonthsAgo.setMonth(now.getMonth() - 15);

  const held = ownership.positions;
  const flags = [];
  const coverage = initializeSpecialistHoldingCoverage(ownership);
  const note = (reason) => { coverage.reasons[reason] = (coverage.reasons[reason] ?? 0) + 1; };
  const unnote = (reason) => {
    if (!reason || !coverage.reasons[reason]) return;
    coverage.reasons[reason] -= 1;
    if (coverage.reasons[reason] === 0) delete coverage.reasons[reason];
  };
  const marketDataCache = new Map();
  const marketDataFor = async (ticker) => {
    if (!marketDataCache.has(ticker)) {
      marketDataCache.set(ticker, Promise.all([
        fetchDailyBars(ticker, { period1: fifteenMonthsAgo, period2: now }),
        fetchFundamentals(ticker).catch(() => null),
      ]).then(([bars, fundamentals]) => ({ bars, fundamentals })));
    }
    return marketDataCache.get(ticker);
  };
  for (const { agentId, ticker, shares, marketValue, returnPct, firstOpenAt } of held) {
    let accountedKind = null;
    let accountedReason = null;
    try {
      if (!Number.isFinite(shares) || shares < 0) {
        coverage.failed += 1;
        note("invalid_held_shares");
        continue;
      }
      const { bars, fundamentals } = await marketDataFor(ticker);
      const benchmarkTicker = holdingBenchmarkTicker(agentId, fundamentals?.sector);
      const benchmarkBars = benchmarkTicker
        ? await benchmarkBarsFor(benchmarkTicker, fifteenMonthsAgo, now)
        : [];
      const evidence = buildLiveHoldingMandateEvidence({
        agentId,
        position: { agentId, ticker, shares, marketValue, returnPct, firstOpenAt },
        bars,
        benchmarkBars,
        fundamentals,
        portfolioValue: accountingProjection.totalValue,
        portfolioValueAsOf: accountingProjection.date,
        asOf,
      });
      const evaluation = evaluateMandateHolding({ agentId, evidence, asOf });
      const line =
        `${agentId} ${ticker}: ${evaluation.action} (${evaluation.reasonCodes.join(", ") || "no_exit_rule"})` +
        ` — evidence ${evaluation.coverageComplete ? "complete" : `incomplete:${evaluation.blockers.length}`}`;
      console.log(`[ExitMonitor] ${line}`);
      flags.push(line);
      if (!evaluation.coverageComplete) {
        coverage.degraded += 1;
        accountedKind = "degraded";
        accountedReason = "mandate_holding_evidence_incomplete";
        note(accountedReason);
      } else {
        coverage.monitored += 1;
        accountedKind = "monitored";
      }

      if (evaluation.action !== "SELL_FULL" && evaluation.action !== "SELL_PARTIAL") continue;
      if (!canQueueHoldingPolicyExit(evaluation)) {
        console.warn(
          `[ExitMonitor] ${agentId} ${ticker}: ${evaluation.action} withheld because mandate evidence is incomplete.`
        );
        continue;
      }

      const freshClose = Number(bars.at(-1)?.close);
      const ownerMarketValue = Number.isFinite(freshClose) && freshClose > 0
        ? shares * freshClose
        : null;
      const amountDollars = holdingPolicyExitAmount({
        evaluation,
        position: { marketValue: ownerMarketValue },
        portfolioValue: accountingProjection.totalValue,
      });
      if (!amountDollars) throw new Error(`${evaluation.action} could not be sized from verified owner exposure`);
      if (hasOpenProposal(openProposals, { agentId, ticker, side: "SELL" })) {
        console.log(`[ExitMonitor] ${ticker}: SELL proposal already open — not double-queuing.`);
        continue;
      }

      const rationale =
        `${evaluation.action === "SELL_PARTIAL" ? "Mandate-specific partial exit" : "Mandate-specific full exit"} — ` +
        evaluation.reasonCodes.join("; ");
      const riskSummary =
        `${evaluation.mandateId} v${evaluation.mandateVersion}; urgency ${evaluation.urgency}; ` +
        `evidence ${evaluation.coverageComplete ? "complete" : `incomplete (${evaluation.blockers.length} explicit blocker(s))`}. ` +
        `Return-to-date ${returnPct ?? "n/a"}%. Fresh owner-attributed value $${Math.round(ownerMarketValue).toLocaleString()}.`;

      const created = await createProposal({
        agentId,
        ticker,
        side: "SELL",
        amountDollars,
        maxPrice: null,
        sellOwnerShareLimit: shares,
        rationale,
        riskSummary,
      });
      requireQueuedExitProposal(created);
      openProposals.push(created);
      console.log(`[ExitMonitor] queued SELL ${ticker} ($${amountDollars}) — ${evaluation.action}.`);
    } catch (err) {
      console.error(`[ExitMonitor] ${agentId} ${ticker} failed:`, err.message);
      if (accountedKind) coverage[accountedKind] -= 1;
      unnote(accountedReason);
      coverage.failed += 1;
      note("monitoring_exception");
    }
  }

  const holdingMonitoring = buildHoldingMonitorCoverage({
    expected: held.length + ownership.quarantined.length,
    ...coverage,
  });
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
