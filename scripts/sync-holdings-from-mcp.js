/**
 * Write Robinhood Agentic account positions to the portfolio tracking sheet.
 *
 * Replaces jobs/holdings-sync.js (which used robin_stocks/Python) for the Agentic
 * sub-account. Called by a Claude agent session after it reads positions via the
 * robinhood-trading MCP tool. Updates Holdings, Performance/NAV, Overview, cached
 * portfolio value, tax reserve, and the SPY benchmark.
 *
 * Usage: node scripts/sync-holdings-from-mcp.js < positions.json
 *        node scripts/sync-holdings-from-mcp.js --scan < positions.json
 *
 * Input (JSON on stdin) — normalize MCP output to this shape before piping:
 * {
 *   "positions": [
 *     {
 *       "ticker":       "CRWD",        // required — stock symbol
 *       "name":         "CrowdStrike", // optional company name
 *       "shares":       10.5,          // required — shares held (number)
 *       "avgCost":      180.00,        // required — average cost per share
 *       "currentPrice": 220.00,        // required — latest market price
 *       "marketValue":  2310.00,       // optional — computed if omitted
 *       "costBasis":    1890.00,       // optional — computed if omitted
 *       "gainLoss":     420.00,        // optional — computed if omitted
 *       "gainLossPct":  22.22          // optional — computed if omitted (0-100 scale or decimal, both handled)
 *     }
 *   ],
 *   "cash": 1500.00   // required — idle buying power
 * }
 *
 * All numeric fields may be strings (Robinhood API returns strings); they are
 * coerced to numbers here.
 */
import "dotenv/config";
import { fetchQuotes } from "../lib/yahoo.js";
import { writePortfolioSnapshot } from "../lib/portfolio-snapshot.js";
import { getServiceAccountClients, getSheetIds, resolveSharedSpreadsheetId } from "../lib/sheets.js";
import { runResearchScan } from "../jobs/research-scan.js";

const shouldRunScan = process.argv.includes("--scan");

const raw = await new Promise((resolve, reject) => {
  let buf = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => (buf += chunk));
  process.stdin.on("end", () => resolve(buf));
  process.stdin.on("error", reject);
});

let input;
try {
  input = JSON.parse(raw);
} catch {
  console.error("stdin is not valid JSON. Pipe MCP position output (normalized to the expected schema) to this script.");
  process.exit(1);
}

if (!Array.isArray(input.positions)) {
  console.error('Input must have a "positions" array. See script header for schema.');
  process.exit(1);
}

const f = (v) => (v == null ? null : parseFloat(v));

const holdings = input.positions.map((p) => {
  const shares = f(p.shares ?? p.quantity) ?? 0;
  const avgCost = f(p.avgCost ?? p.average_buy_price) ?? 0;
  const currentPrice = f(p.currentPrice ?? p.current_price ?? p.last_trade_price) ?? null;
  const marketValue = f(p.marketValue ?? p.equity ?? p.market_value) ?? (currentPrice != null ? shares * currentPrice : null);
  const costBasis = f(p.costBasis ?? p.cost_basis) ?? shares * avgCost;
  const gainLoss = f(p.gainLoss ?? p.equity_change ?? p.unrealized_profit_loss) ?? (marketValue != null ? marketValue - costBasis : null);
  let gainLossPct = f(p.gainLossPct ?? p.percent_change ?? p.unrealized_profit_loss_percentage);
  // Robinhood returns percent_change as a decimal (0.22 = 22%); normalize to 0-100 scale
  if (gainLossPct != null && Math.abs(gainLossPct) < 10 && costBasis > 0) {
    gainLossPct = gainLossPct * 100;
  }

  return {
    ticker: (p.ticker ?? p.symbol ?? "").toUpperCase(),
    name: p.name ?? p.simpleName ?? "",
    shares,
    avgCost,
    currentPrice,
    marketValue,
    costBasis,
    gainLoss,
    gainLossPct,
  };
}).filter((h) => h.ticker);

const cash = f(input.cash ?? input.buying_power ?? 0) ?? 0;
const timestamp = new Date().toISOString();

const { sheets, drive } = getServiceAccountClients();
const spreadsheetId = await resolveSharedSpreadsheetId(sheets, drive);
const sheetIds = await getSheetIds(sheets, spreadsheetId);
const quotes = await fetchQuotes(["SPY"]);
const spyPrice = quotes.SPY?.regularMarketPrice ?? null;

const snapshot = await writePortfolioSnapshot({
  sheets,
  spreadsheetId,
  sheetIds,
  holdings,
  cash,
  spyPrice,
  timestamp,
  holdingsNote: "Synced via Robinhood Agentic MCP",
});

console.log(`Portfolio synced: ${holdings.length} position(s), cash $${cash.toFixed(2)}, total $${snapshot.totalValue.toFixed(2)}`);
holdings.forEach((h) => console.log(`  ${h.ticker}: ${h.shares} shares @ $${h.avgCost} avg cost`));

if (shouldRunScan) {
  console.log("Starting all-agent research scan against the updated cash balance...");
  await runResearchScan();
  console.log("All-agent research scan complete. BUY proposals were capped by available idle cash.");
}
