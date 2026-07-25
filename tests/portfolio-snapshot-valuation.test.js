import { test } from "node:test";
import assert from "node:assert/strict";
import { applyComparableQuoteValuation } from "../lib/portfolio-snapshot.js";

test("a complete source quote set drives both Holdings valuation and provenance", () => {
  const result = applyComparableQuoteValuation([
    { ticker: "NVDA", shares: 2, avgCost: 100, costBasis: 200, currentPrice: 99, marketValue: 198 },
  ], {
    NVDA: { regularMarketPrice: 125.25, regularMarketTime: "2026-07-25T20:00:00.000Z" },
  });
  assert.match(result.quoteSnapshot.quoteSnapshotVersion, /^yahoo-quote-set-v1:/);
  assert.equal(result.quoteSnapshot.quoteSource, "yahoo-finance2:quote");
  assert.equal(result.holdings[0].currentPrice, 125.25);
  assert.equal(result.holdings[0].marketValue, 250.5);
  assert.equal(result.holdings[0].gainLoss, 50.5);
});

test("an incomplete quote set preserves broker values and fails valuation comparability closed", () => {
  const holdings = [{ ticker: "NVDA", shares: 2, avgCost: 100, costBasis: 200, currentPrice: 99, marketValue: 198 }];
  const result = applyComparableQuoteValuation(holdings, { NVDA: { regularMarketPrice: 125.25 } });
  assert.equal(result.quoteSnapshot, null);
  assert.equal(result.holdings, holdings);
});
