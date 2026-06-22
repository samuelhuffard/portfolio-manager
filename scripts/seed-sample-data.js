import "dotenv/config";
import {
  getServiceAccountClients,
  resolveSharedSpreadsheetId,
  getSheetIds,
  writeHoldingsTab,
  appendPerformanceRow,
  appendAgentRecommendations,
  writeOverviewTab,
  agentTabName,
} from "../lib/sheets.js";
import { AGENTS } from "../config/agents.js";

// `node scripts/seed-sample-data.js [agentId]` (defaults to agent-1). Seeds the
// shared portfolio's Holdings/Performance/Overview plus one agent's Recommendations.
const agentId = process.argv[2] || "agent-1";
const agent = AGENTS.find((a) => a.id === agentId);
if (!agent) {
  console.error(`Unknown agent "${agentId}". Known agents: ${AGENTS.map((a) => a.id).join(", ")}`);
  process.exit(1);
}

const { sheets, drive } = getServiceAccountClients();
const spreadsheetId = await resolveSharedSpreadsheetId(sheets, drive);
const sheetIds = await getSheetIds(sheets, spreadsheetId);

const timestamp = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
const SAMPLE_NOTE = "⚠️ Sample data — preview only. Replaced by the next live sync.";

// ── Sample holdings ──────────────────────────────────────────────────────
const raw = [
  { ticker: "AAPL", name: "Apple Inc.", shares: 10, avgCost: 185.0, currentPrice: 210.5 },
  { ticker: "MSFT", name: "Microsoft Corporation", shares: 5, avgCost: 380.0, currentPrice: 445.2 },
  { ticker: "NVDA", name: "NVIDIA Corporation", shares: 8, avgCost: 110.0, currentPrice: 135.75 },
  { ticker: "GOOGL", name: "Alphabet Inc.", shares: 12, avgCost: 140.0, currentPrice: 178.3 },
  { ticker: "JPM", name: "JPMorgan Chase & Co.", shares: 15, avgCost: 190.0, currentPrice: 245.6 },
  { ticker: "KO", name: "The Coca-Cola Company", shares: 20, avgCost: 60.0, currentPrice: 68.4 },
];

const holdings = raw.map((h) => {
  const marketValue = h.shares * h.currentPrice;
  const costBasis = h.shares * h.avgCost;
  const gainLoss = marketValue - costBasis;
  const gainLossPct = (gainLoss / costBasis) * 100;
  return { ...h, marketValue, costBasis, gainLoss, gainLossPct };
});

const cash = 3250.75;
const investedValue = holdings.reduce((sum, h) => sum + h.marketValue, 0);
const totalValue = investedValue + cash;

await writeHoldingsTab(sheets, spreadsheetId, sheetIds["Holdings"], holdings, cash, timestamp, SAMPLE_NOTE);
console.log("[Seed] Wrote sample Holdings tab.");

// ── Sample performance history (10 days, ending today) ──────────────────────
await sheets.spreadsheets.values.clear({ spreadsheetId, range: "Performance" });

const days = 10;
const startValue = totalValue / 1.0434; // ~4.3% growth over the period
const startSpy = 540.0;
const endSpy = 548.2; // ~1.5% growth over the period
const today = new Date();

for (let i = days - 1; i >= 0; i--) {
  const d = new Date(today);
  d.setDate(d.getDate() - i);
  const progress = (days - 1 - i) / (days - 1);
  const noise = Math.sin(i * 1.7) * 0.003; // small wiggle so it doesn't look like a straight line
  const portfolioValue = i === 0 ? totalValue : startValue * (1 + progress * 0.0434 + noise);
  const spyPrice = i === 0 ? endSpy : startSpy * (1 + progress * 0.0152 + noise / 2);
  await appendPerformanceRow(sheets, spreadsheetId, sheetIds["Performance"], {
    date: d.toISOString().slice(0, 10),
    portfolioValue: Math.round(portfolioValue * 100) / 100,
    spyPrice: Math.round(spyPrice * 100) / 100,
  });
}
console.log(`[Seed] Wrote ${days} sample Performance rows.`);

// ── Sample recommendations (one agent's tab) ────────────────────────────────
const todayStr = today.toISOString().slice(0, 10);
await appendAgentRecommendations(sheets, spreadsheetId, sheetIds[agentTabName(agentId)], agentId, [
  {
    date: todayStr,
    ticker: "NVDA",
    action: "BUY",
    quantScore: 82,
    rationale:
      "Strong momentum and best-in-class margins keep NVDA at the top of the quant rankings. (Sample rationale — replaced by real AI analysis after the next research scan.)",
    newsLinks: "",
    status: "pending",
  },
  {
    date: todayStr,
    ticker: "JPM",
    action: "HOLD",
    quantScore: 64,
    rationale: "Solid fundamentals but momentum has cooled — holding steady looks reasonable for now. (Sample rationale.)",
    newsLinks: "",
    status: "pending",
  },
  {
    date: todayStr,
    ticker: "XOM",
    action: "SELL",
    quantScore: 41,
    rationale: "Weak quant score versus energy-sector peers — consider trimming this position. (Sample rationale.)",
    newsLinks: "",
    status: "pending",
  },
]);
console.log(`[Seed] Wrote 3 sample recommendations into ${agentTabName(agentId)}.`);

// ── Overview ─────────────────────────────────────────────────────────────
const totalCostBasis = holdings.reduce((sum, h) => sum + h.costBasis, 0);
const totalGainLoss = holdings.reduce((sum, h) => sum + h.gainLoss, 0);
const totalGainLossPct = (totalGainLoss / totalCostBasis) * 100;

const best = holdings.reduce((a, b) => (a.gainLossPct > b.gainLossPct ? a : b));
const worst = holdings.reduce((a, b) => (a.gainLossPct < b.gainLossPct ? a : b));

const allocation = holdings
  .map((h) => ({
    ticker: h.ticker,
    name: h.name,
    marketValue: Math.round(h.marketValue * 100) / 100,
    pct: (h.marketValue / totalValue) * 100,
  }))
  .sort((a, b) => b.marketValue - a.marketValue);

const portfolioReturnPct = ((totalValue - startValue) / startValue) * 100;
const spyReturnPct = ((endSpy - startSpy) / startSpy) * 100;

await writeOverviewTab(sheets, spreadsheetId, sheetIds["Overview"], {
  timestamp,
  totalValue: Math.round(totalValue * 100) / 100,
  cash,
  investedValue: Math.round(investedValue * 100) / 100,
  totalGainLoss: Math.round(totalGainLoss * 100) / 100,
  totalGainLossPct: Math.round(totalGainLossPct * 100) / 100,
  numHoldings: holdings.length,
  best,
  worst,
  portfolioReturnPct,
  spyReturnPct,
  allocation,
  isSample: true,
});
console.log("[Seed] Wrote sample Overview tab.");

console.log(`\nDone: https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`);
