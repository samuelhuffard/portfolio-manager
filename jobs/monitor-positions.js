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
import { classifySubVertical } from "../lib/indicators.js";
import { evaluateExitSignals, resolveExitAction } from "../lib/exit-signals.js";
import {
  getServiceAccountClients,
  resolveSharedSpreadsheetId,
  readHoldingsAllocation,
  readHoldingsReturnPct,
} from "../lib/sheets.js";
import { listAllProposals, createProposal } from "../lib/redis.js";
import { hasOpenProposal } from "../lib/proposal-sizing.js";

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

  const flags = [];
  for (const { ticker, marketValue } of allocation) {
    try {
      const [bars, fundamentals, surprise] = await Promise.all([
        fetchDailyBars(ticker, { period1: eightMonthsAgo, period2: now }),
        fetchFundamentals(ticker),
        fetchEarningsSurprise(ticker),
      ]);
      const closes = bars.map((b) => b.close);
      const subVertical = classifySubVertical(fundamentals);
      const { ticker: benchTicker, closes: benchmarkCloses } = await benchmarkClosesFor(
        subVertical,
        eightMonthsAgo,
        now
      );

      // T3 fundamental read. V1 fills EPS-surprise numerically; guidance cut / margin
      // compression / credibility events remain future AI-overlay + filing inputs (the
      // memo flags these as the highest-weight but least-automatable signals).
      const fundamental = surprise ? { epsSurprisePct: surprise.epsSurprisePct } : null;

      const signals = evaluateExitSignals({ closes, benchmarkCloses, fundamental });
      const decision = resolveExitAction(signals);

      const line = `${ticker} (${subVertical ?? "—"}, RS vs ${benchTicker}): ${decision.action}` +
        (decision.action === "TRIM" ? ` -${decision.reducePct}%` : "") +
        ` — ${decision.reasons.join("; ")}`;
      console.log(`[ExitMonitor] ${line}`);
      flags.push(line);

      if (decision.action !== "SELL" && decision.action !== "TRIM") continue;

      // Size the exit off current market value. createProposal only accepts BUY/SELL, so a
      // partial TRIM is a SELL of reducePct of the position.
      if (!Number.isFinite(marketValue) || marketValue <= 0) {
        console.warn(`[ExitMonitor] ${ticker}: ${decision.action} signalled but no market value — skipping proposal.`);
        continue;
      }
      if (hasOpenProposal(openProposals, { agentId: AGENT_ID, ticker, side: "SELL" })) {
        console.log(`[ExitMonitor] ${ticker}: SELL proposal already open — not double-queuing.`);
        continue;
      }

      const amountDollars = Math.round(marketValue * (decision.reducePct / 100) * 100) / 100;
      if (amountDollars <= 0) continue;

      const rationale =
        `${decision.action === "TRIM" ? `Partial exit (reduce ${decision.reducePct}%)` : "Full exit"} — ` +
        decision.reasons.join("; ");
      const riskSummary =
        `Exit monitor T1=${signals.t1} T2=${signals.t2} T3=${signals.t3}. ` +
        `Speed: ${decision.speed}. Return-to-date ${returnPct[ticker] ?? "n/a"}%. ` +
        `Sized to ${decision.reducePct}% of $${Math.round(marketValue).toLocaleString()} market value.`;

      try {
        const created = await createProposal({
          agentId: AGENT_ID,
          ticker,
          side: "SELL",
          amountDollars,
          maxPrice: null,
          rationale,
          riskSummary,
        });
        if (created) {
          openProposals.push(created);
          console.log(`[ExitMonitor] queued SELL ${ticker} ($${amountDollars}) — ${decision.action}.`);
        }
      } catch (err) {
        console.warn(`[ExitMonitor] ${ticker}: failed to queue exit proposal:`, err.message);
      }
    } catch (err) {
      console.error(`[ExitMonitor] ${ticker} failed:`, err.message);
    }
  }

  console.log(`[ExitMonitor] done — reviewed ${allocation.length} positions.`);
  return flags;
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  runExitMonitor().catch((e) => {
    console.error("[ExitMonitor] error:", e.message);
    process.exit(1);
  });
}
