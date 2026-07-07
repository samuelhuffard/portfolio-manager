/**
 * Intraday monitor — runs every 30 minutes during market hours (10 AM–3:30 PM ET Mon-Fri).
 * Also runs at 9:35 AM ET for the opening check and at 3:50 PM ET for the pre-close check.
 *
 * Three things it does on every tick:
 *
 * 1. Price alerts — checks Redis for stored target-price alerts (e.g. "buy NVDA if it
 *    drops below $185"). When triggered it queues a BUY/SELL proposal and removes the alert.
 *
 * 2. ATR stop check — for each held position, computes a simplified intraday ATR stop
 *    (last known ATR * 1.5 from the 20-day high). If the current price has breached the stop,
 *    queues a SELL proposal. This is a lightweight intraday version of the full exit monitor
 *    which runs at EOD with complete daily bar data.
 *
 * 3. Momentum break — flags positions where intraday price is down >3% from open, logged
 *    for awareness but not auto-proposed (that needs context the AI overlay provides).
 */

import "dotenv/config";
import { fileURLToPath } from "node:url";
import { fetchQuotes, fetchDailyBars } from "../lib/yahoo.js";
import { atr } from "../lib/indicators.js";
import { listPriceAlerts, checkAlerts, removePriceAlert } from "../lib/price-alerts.js";
import { listAllProposals, createProposal, wasProposalNudged, markProposalNudged } from "../lib/redis.js";
import { hasOpenProposal } from "../lib/proposal-sizing.js";
import { selectExpiringProposals, formatExpiryNudge } from "../lib/proposal-nudge.js";
import { sendMessage as sendTelegram } from "../lib/telegram.js";
import {
  getServiceAccountClients,
  resolveSharedSpreadsheetId,
  readCashBalance,
  readHoldingsAllocation,
  readHoldingsReturnPct,
} from "../lib/sheets.js";

const EXIT_AGENT_ID = "agent-1";
// Price alerts carry their own agentId; ATR stop exits are still attributed to Agent One.
// Tickers to watch for price alerts even when not held
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath as ftpu } from "node:url";

const __dirname = path.dirname(ftpu(import.meta.url));
const watchlistPath = path.join(__dirname, "..", "config", "agents", "agent-1", "watchlist.json");
const WATCHLIST_TICKERS = JSON.parse(fs.readFileSync(watchlistPath, "utf8")).tickers;

export async function runIntradayMonitor({ context = "intraday" } = {}) {
  console.log(`[Intraday] Starting ${context} check...`);

  const { sheets, drive } = getServiceAccountClients();
  const spreadsheetId = await resolveSharedSpreadsheetId(sheets, drive);

  const [allocation, returnPct, cashBalance, openProposals, priceAlerts] = await Promise.all([
    readHoldingsAllocation(sheets, spreadsheetId),
    readHoldingsReturnPct(sheets, spreadsheetId),
    readCashBalance(sheets, spreadsheetId),
    listAllProposals(),
    listPriceAlerts(),
  ]);
  const acceptedBuyReserve = openProposals
    .filter((p) => p.side === "BUY" && p.status === "ApprovedForBrokerReview" && !p.fulfilledAt)
    .reduce((sum, p) => sum + (p.amountDollars ?? 0), 0);
  let availableCashForBuys = Math.max(0, Math.round(((cashBalance ?? 0) - acceptedBuyReserve) * 100) / 100);

  const heldTickers = allocation.filter((h) => (h.marketValue ?? 0) > 0).map((h) => h.ticker);
  const allTickers = [...new Set([...heldTickers, ...WATCHLIST_TICKERS, ...priceAlerts.map((a) => a.ticker)])];

  // Fetch current prices for everything we care about
  let quotes = {};
  try {
    quotes = await fetchQuotes(allTickers);
  } catch (e) {
    console.warn("[Intraday] Quote fetch failed:", e.message);
    return;
  }

  const priceMap = {};
  for (const [ticker, q] of Object.entries(quotes)) {
    priceMap[ticker] = q?.regularMarketPrice ?? null;
  }

  // ── 1. Price alerts ──────────────────────────────────────────────────────────
  const triggered = checkAlerts(priceAlerts, priceMap);
  for (const alert of triggered) {
    const price = priceMap[alert.ticker];
    console.log(
      `[Intraday] ALERT triggered: ${alert.ticker} ${alert.direction} $${alert.targetPrice} (current $${price})`
    );

    const side = alert.direction === "below" ? "BUY" : "SELL";
    const agentLabel = alert.agentId ? `Agent ${alert.agentId.split("-")[1]}` : "Agent";

    if (!hasOpenProposal(openProposals, { agentId: alert.agentId, ticker: alert.ticker, side })) {
      let amountDollars;
      if (side === "BUY") {
        amountDollars = Math.min(25, availableCashForBuys);
      } else {
        const pos = allocation.find((h) => h.ticker === alert.ticker);
        amountDollars = pos?.marketValue ?? 25;
      }
      if (side === "BUY" && amountDollars <= 0) {
        console.log(`[Intraday] ${alert.ticker}: BUY alert triggered but no free cash is available — skipping proposal.`);
        continue;
      }

      const maxPrice = side === "BUY" ? Math.round(price * 1.01 * 100) / 100 : null;
      const rationale =
        `Price alert triggered: ${alert.ticker} reached $${price} (target ${alert.direction} $${alert.targetPrice}). ` +
        (alert.note ? `Note: ${alert.note}` : "");

      try {
        const created = await createProposal({
          agentId: alert.agentId,
          ticker: alert.ticker,
          side,
          amountDollars,
          maxPrice,
          rationale,
          riskSummary: `Intraday price alert. Full AI re-underwriting will run at EOD research scan.`,
        });
        if (created) {
          openProposals.push(created);
          if (created.side === "BUY") availableCashForBuys = Math.max(0, Math.round((availableCashForBuys - created.amountDollars) * 100) / 100);
          console.log(`[Intraday] Queued ${side} ${alert.ticker} $${amountDollars} from price alert.`);
        }
      } catch (e) {
        console.warn(`[Intraday] Failed to queue alert proposal for ${alert.ticker}:`, e.message);
      }

      // Telegram notification
      try {
        const directionEmoji = alert.direction === "below" ? "📉" : "📈";
        const msg =
          `${directionEmoji} Price Alert Triggered\n` +
          `${agentLabel} · ${alert.ticker}\n` +
          `${alert.direction === "below" ? "Fell below" : "Rose above"} $${alert.targetPrice} → now $${price}\n` +
          (alert.note ? `Note: ${alert.note}\n` : "") +
          `→ ${side} proposal queued ($${amountDollars})`;
        await sendTelegram(msg);
      } catch (e) {
        console.warn(`[Intraday] Telegram notification failed:`, e.message);
      }
    } else {
      console.log(`[Intraday] ${alert.ticker}: open proposal already exists, skipping alert.`);
    }

    await removePriceAlert(alert.id);
  }

  if (!triggered.length) console.log("[Intraday] No price alerts triggered.");

  // ── 2. Intraday ATR stop check on held positions ─────────────────────────────
  if (heldTickers.length === 0) {
    console.log("[Intraday] No held positions to check ATR stops.");
  }

  const now = new Date();
  const threeMonthsAgo = new Date(now);
  threeMonthsAgo.setMonth(now.getMonth() - 3);

  for (const pos of allocation.filter((h) => (h.marketValue ?? 0) > 0)) {
    const price = priceMap[pos.ticker];
    if (!price) continue;

    try {
      const bars = await fetchDailyBars(pos.ticker, { period1: threeMonthsAgo, period2: now });
      if (bars.length < 20) continue;

      const recentBars = bars.slice(-20);
      const high20 = Math.max(...recentBars.map((b) => b.high));
      const atrVal = atr(bars, 14);
      const stopLevel = Math.round((high20 - atrVal * 1.5) * 100) / 100;
      const returnP = returnPct[pos.ticker] ?? 0;

      console.log(
        `[Intraday] ${pos.ticker}: price $${price} | 20-day high $${high20.toFixed(2)} | ATR stop $${stopLevel} | return ${returnP.toFixed(1)}%`
      );

      if (price < stopLevel && returnP < 0) {
        // Only flag ATR stop breach on a losing position (memo: no averaging down, quick exit)
        console.log(`[Intraday] ${pos.ticker}: ATR stop breached at $${price} (stop $${stopLevel}) — flagging for exit.`);

        if (!hasOpenProposal(openProposals, { agentId: EXIT_AGENT_ID, ticker: pos.ticker, side: "SELL" })) {
          const created = await createProposal({
            agentId: EXIT_AGENT_ID,
            ticker: pos.ticker,
            side: "SELL",
            amountDollars: Math.round((pos.marketValue ?? 0) * 100) / 100,
            maxPrice: null,
            rationale: `Intraday ATR stop breach: ${pos.ticker} at $${price} is below ATR stop $${stopLevel} (20-day high $${high20.toFixed(2)} − 1.5×ATR $${atrVal.toFixed(2)}). Position is at a loss (${returnP.toFixed(1)}%). Agent One memo requires fast exit.`,
            riskSummary: `ATR stop triggered intraday. Full exit signal analysis will run at 4:45 PM ET exit monitor.`,
          });
          if (created) {
            openProposals.push(created);
            console.log(`[Intraday] Queued SELL ${pos.ticker} $${pos.marketValue} from ATR stop breach.`);
          }
        }
      }
    } catch (e) {
      console.warn(`[Intraday] ATR check failed for ${pos.ticker}:`, e.message);
    }
  }

  // ── 3. Momentum break flag (informational) ───────────────────────────────────
  for (const ticker of heldTickers) {
    const q = quotes[ticker];
    if (!q) continue;
    const open = q.regularMarketOpen;
    const current = q.regularMarketPrice;
    if (!open || !current) continue;
    const intraChange = (current - open) / open;
    if (intraChange <= -0.03) {
      console.log(
        `[Intraday] MOMENTUM FLAG ${ticker}: down ${(intraChange * 100).toFixed(1)}% from open ($${open} → $${current}) — watch closely.`
      );
    }
  }

  // ── 4. Approval-queue expiry nudge (F-2026-003) ──────────────────────────────
  // Pending proposals silently lapse 48h after creation; Telegram once per
  // proposal as it enters its final 24h so decisions stop expiring unseen.
  // Marked nudged only AFTER a successful send, so a Telegram failure retries
  // on the next tick instead of losing the nudge.
  try {
    const expiring = selectExpiringProposals(openProposals);
    const toNudge = [];
    for (const p of expiring) {
      if (!(await wasProposalNudged(p.id))) toNudge.push(p);
    }
    if (toNudge.length) {
      await sendTelegram(formatExpiryNudge(toNudge));
      for (const p of toNudge) await markProposalNudged(p.id);
      console.log(`[Intraday] Nudged ${toNudge.length} proposal(s) nearing expiry.`);
    }
  } catch (e) {
    console.error("[Intraday] Expiry nudge failed:", e.message);
  }

  console.log(`[Intraday] ${context} check complete.`);
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  runIntradayMonitor({ context: "manual" }).catch((e) => {
    console.error("[Intraday] Error:", e.message);
    process.exit(1);
  });
}
