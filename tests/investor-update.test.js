import { test } from "node:test";
import assert from "node:assert/strict";
import { computeInvestorSummaries, isoWeekOf, renderInvestorUpdateEmail } from "../lib/investor-update.js";

const performanceHistory = [
  { date: "2026-07-06", portfolioValue: 1200, unitsOutstanding: 1000, navPerUnit: 1.2 },
];

const holdings = [
  { ticker: "AAA", shares: 10, currentPrice: 50, marketValue: 500 },
  { ticker: "BBB", shares: 5, currentPrice: 60, marketValue: 300 },
  { ticker: "CCC", shares: 2, currentPrice: 100, marketValue: 200 },
  { ticker: "DDD", shares: 1, currentPrice: 100, marketValue: 100 },
];

test("computeInvestorSummaries isolates each investor by units and pro-rata holdings", () => {
  const ledger = [
    { date: "2026-07-01", email: "a@example.com", name: "Investor A", type: "Contribution", amount: 500, navPerUnit: 1, units: 500, investorId: "user_a" },
    { date: "2026-07-01", email: "b@example.com", name: "Investor B", type: "Contribution", amount: 500, navPerUnit: 1, units: 500, investorId: "user_b" },
  ];
  const summaries = computeInvestorSummaries({
    ledger,
    performanceHistory,
    holdings,
    trades: [],
    now: new Date("2026-07-07T12:00:00-04:00"),
  });

  assert.equal(summaries.length, 2);
  assert.equal(summaries[0].email, "a@example.com");
  assert.equal(summaries[0].value, 600);
  assert.equal(summaries[0].gainLoss, 100);
  assert.equal(Math.round(summaries[0].ownershipPct), 50);
  assert.deepEqual(summaries[0].topHoldings.map((h) => [h.ticker, h.marketValue]), [
    ["AAA", 250],
    ["BBB", 150],
    ["CCC", 100],
  ]);
});

test("computeInvestorSummaries includes only trades from the last seven days", () => {
  const ledger = [
    { date: "2026-07-01", email: "a@example.com", name: "Investor A", type: "Contribution", amount: 500, navPerUnit: 1, units: 500, investorId: "user_a" },
  ];
  const summaries = computeInvestorSummaries({
    ledger,
    performanceHistory,
    holdings,
    trades: [
      { date: "2026-07-07T14:00:00.000Z", ticker: "AAA", side: "BUY", shares: 1, price: 50, amount: 50 },
      { date: "2026-06-20T14:00:00.000Z", ticker: "OLD", side: "SELL", shares: 1, price: 10, amount: 10 },
    ],
    now: new Date("2026-07-07T12:00:00-04:00"),
  });

  assert.equal(summaries[0].weeklyTrades.length, 1);
  assert.equal(summaries[0].weeklyTrades[0].ticker, "AAA");
});

test("renderInvestorUpdateEmail includes actions, investor value, exposures, and disclaimer", () => {
  const [summary] = computeInvestorSummaries({
    ledger: [
      { date: "2026-07-01", email: "a@example.com", name: "Investor A", type: "Contribution", amount: 500, navPerUnit: 1, units: 500, investorId: "user_a" },
    ],
    performanceHistory,
    holdings,
    trades: [{ date: "2026-07-07T14:00:00.000Z", ticker: "AAA", side: "BUY", shares: 1, price: 50, amount: 50 }],
    now: new Date("2026-07-07T12:00:00-04:00"),
  });

  const rendered = renderInvestorUpdateEmail(summary, {
    isoWeek: isoWeekOf(new Date("2026-07-07T12:00:00-04:00")),
    dashboardUrl: "https://example.com/investors",
    subjectPrefix: "[Test]",
  });

  assert.match(rendered.subject, /^\[Test\] Portfolio update 2026 W28:/);
  assert.match(rendered.text, /Current value: \$600.00/);
  assert.match(rendered.text, /BUY AAA at avg \$50.00 \(your pro-rata amount \$25.00\)/);
  assert.match(rendered.text, /AAA: \$250.00 of your pro-rata exposure/);
  assert.match(rendered.text, /not investment advice/);
  assert.match(rendered.html, /Open the investor dashboard/);
});

test("renderInvestorUpdateEmail handles weeks with no trades", () => {
  const [summary] = computeInvestorSummaries({
    ledger: [
      { date: "2026-07-01", email: "a@example.com", name: "Investor A", type: "Contribution", amount: 500, navPerUnit: 1, units: 500, investorId: "user_a" },
    ],
    performanceHistory,
    holdings,
    trades: [],
    now: new Date("2026-07-07T12:00:00-04:00"),
  });
  const rendered = renderInvestorUpdateEmail(summary, { isoWeek: "2026-W28" });
  assert.match(rendered.text, /No buys or sells were executed this week/);
});
