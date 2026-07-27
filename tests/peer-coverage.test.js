import test from "node:test";
import assert from "node:assert/strict";
import { assessPeerCoverage, coveragePriorityTickers, mergeCoverageRequests, scorePeerFundamentals } from "../lib/peer-coverage.js";
import { selectEnrichmentBatch } from "../lib/universe.js";

const row = (ticker, industry = "Payments", sector = "Financial Services") => ({
  ticker, industry, sector, metrics: { revGrowth: 0.1, peerValuation: 20 },
});

test("coverage requires target metrics and six usable peers", () => {
  const peers = Object.fromEntries(["A", "B", "C", "D", "E", "F"].map((ticker) => [ticker, row(ticker)]));
  const missingTarget = assessPeerCoverage({ ticker: "V", industry: "Payments", sector: "Financial Services", peerMetrics: peers });
  assert.equal(missingTarget.ready, false);
  assert.equal(missingTarget.reason, "target_peer_metrics_unavailable");
  const covered = assessPeerCoverage({ ticker: "V", peerMetrics: { ...peers, V: row("V") } });
  assert.equal(covered.ready, true);
  assert.equal(covered.peerCount, 6);
  assert.equal(covered.fallbackMethod, "blended_50_50");
});

test("coverage requests merge rather than duplicating a ticker", () => {
  const first = mergeCoverageRequests({}, [{ ticker: "V", industry: "Payments", source: "lab" }], "2026-07-27T12:00:00.000Z");
  const second = mergeCoverageRequests(first, [{ ticker: "v", sector: "Financial Services", source: "lab" }], "2026-07-27T13:00:00.000Z");
  assert.equal(Object.keys(second).length, 1);
  assert.equal(second.V.requestCount, 2);
  assert.equal(second.V.industry, "Payments");
  assert.equal(second.V.sector, "Financial Services");
});

test("requested target and cohort preempt ordinary enrichment", () => {
  const catalog = {
    V: { t: "V", i: "Payments", s: "Financial Services", mc: 500 },
    MA: { t: "MA", i: "Payments", s: "Financial Services", mc: 450 },
    PYPL: { t: "PYPL", i: "Payments", s: "Financial Services", mc: 100 },
    OLD: { t: "OLD", mc: 999 },
  };
  const requests = { V: { ticker: "V", industry: "Payments", lastRequestedAt: "2026-07-27T12:00:00.000Z" } };
  const priority = coveragePriorityTickers(catalog, requests);
  assert.deepEqual(priority.slice(0, 3), ["V", "MA", "PYPL"]);
  assert.deepEqual(selectEnrichmentBatch(catalog, { perRun: 3, priorityTickers: priority }), ["V", "MA", "PYPL"]);
});

test("Lab scores a target against stored peer fundamentals rather than itself", () => {
  const candidate = { ticker: "V", quant: { revenueGrowth: 0.2, earningsGrowth: 0.3, profitMargins: 0.5, returnOnEquity: 0.4, trailingPE: 20, debtToEquity: 1, pegRatio: 1 } };
  const peers = Array.from({ length: 7 }, (_, index) => ({
    ticker: `P${index}`,
    quant: { revenueGrowth: 0.02 * index, earningsGrowth: 0.03 * index, profitMargins: 0.05 * index, returnOnEquity: 0.04 * index, trailingPE: 30 + index, debtToEquity: 10 + index, pegRatio: 2 + index },
  }));
  const result = scorePeerFundamentals({ candidate, peers });
  assert.ok(result.quantScore > 90);
  assert.ok(result.breakdown.revenueGrowth > 90);
  assert.ok(result.breakdown.trailingPE > 90); // lower P/E ranks higher
});
