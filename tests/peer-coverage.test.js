import test from "node:test";
import assert from "node:assert/strict";
import { assessPeerCoverage, coveragePriorityTickers, mergeCoverageRequests, resolveLabMandateScore } from "../lib/peer-coverage.js";
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

test("Lab refuses a self-normalized score until its mandate snapshot is actionable", () => {
  assert.deepEqual(resolveLabMandateScore(null, "V"), { ready: false, reason: "mandate_score_unavailable", score: null });
  assert.equal(resolveLabMandateScore({ scores: [{ ticker: "V", actionable: false }] }, "V").reason, "mandate_score_not_actionable");
  const result = resolveLabMandateScore({ scores: [{ ticker: "V", actionable: true, total: 72 }] }, "V");
  assert.equal(result.ready, true);
  assert.equal(result.score.total, 72);
});
