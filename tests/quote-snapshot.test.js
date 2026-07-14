import test from "node:test";
import assert from "node:assert/strict";
import {
  buildHoldingsQuoteSnapshot,
  buildHoldingsValuationDigest,
  canonicalizeHoldingsForPersistence,
  HOLDINGS_QUOTE_SOURCE,
} from "../lib/quote-snapshot.js";
import { parseHoldingsQuoteSnapshot } from "../lib/sheets.js";

test("quote snapshot identity is stable across ticker order and carries provider source time", () => {
  const quotes = {
    NVDA: { regularMarketPrice: 205.5, regularMarketTime: new Date("2026-07-14T19:59:58.000Z") },
    AMD: { regularMarketPrice: 160.25, regularMarketTime: new Date("2026-07-14T19:59:57.000Z") },
  };
  const first = buildHoldingsQuoteSnapshot(quotes, ["NVDA", "AMD"]);
  const second = buildHoldingsQuoteSnapshot(quotes, ["amd", "NVDA"]);
  assert.deepEqual(first, second);
  assert.match(first.quoteSnapshotVersion, /^yahoo-quote-set-v1:[0-9a-f]{64}$/);
  assert.equal(first.quoteSource, HOLDINGS_QUOTE_SOURCE);
  assert.equal(first.quoteTimestamp, "2026-07-14T19:59:58.000Z");
});

test("missing provider price or source timestamp keeps valuation non-comparable", () => {
  assert.equal(buildHoldingsQuoteSnapshot({ NVDA: { regularMarketPrice: 205.5 } }, ["NVDA"]), null);
  assert.equal(buildHoldingsQuoteSnapshot({ NVDA: { regularMarketTime: new Date() } }, ["NVDA"]), null);
  assert.equal(buildHoldingsQuoteSnapshot({}, []), null);
});

test("Holdings marker round-trips quote provenance without becoming a security row", () => {
  const positions = [["NVDA", "Nvidia", 1, 100, 205.5, 205.5, 100]];
  const valuationDigest = buildHoldingsValuationDigest(positions);
  const value = parseHoldingsQuoteSnapshot([
    ...positions,
    ["Cash", ""],
    ["Last synced: 7/14/2026, 4:00 PM", "yahoo-quote-set-v1:abc", "yahoo-finance2:quote", "2026-07-14T19:59:58.000Z", valuationDigest],
  ]);
  assert.deepEqual(value, {
    quoteSnapshotVersion: "yahoo-quote-set-v1:abc",
    quoteSource: "yahoo-finance2:quote",
    quoteTimestamp: "2026-07-14T19:59:58.000Z",
  });
  assert.equal(parseHoldingsQuoteSnapshot([["Last synced: now", "", "", ""]]), null);
});

test("Holdings quote provenance fails closed when a value changes under an unchanged marker", () => {
  const original = [["NVDA", "Nvidia", 1, 100, 205.5, 205.5, 100]];
  const valuationDigest = buildHoldingsValuationDigest(original);
  const marker = ["Last synced: now", "yahoo-quote-set-v1:abc", "yahoo-finance2:quote", "2026-07-14T19:59:58.000Z", valuationDigest];

  assert.ok(parseHoldingsQuoteSnapshot([...original, marker]));
  assert.equal(parseHoldingsQuoteSnapshot([
    ["NVDA", "Nvidia", 1, 100, 205.5, 999.99, 100],
    marker,
  ]), null);
  assert.equal(parseHoldingsQuoteSnapshot([
    ["NVDA", "Nvidia", 2, 100, 205.5, 205.5, 100],
    marker,
  ]), null, "share edits must invalidate provenance");
  assert.equal(parseHoldingsQuoteSnapshot([
    ["NVDA", "Nvidia", 1, 100, 999.99, 205.5, 100],
    marker,
  ]), null, "current-price edits must invalidate provenance");
});

test("one half-cent-safe projection feeds both Sheet and Postgres writes", () => {
  const [positive, negative] = canonicalizeHoldingsForPersistence([
    { ticker: "POS", marketValue: 1.005, costBasis: 2.005, gainLoss: 3.005 },
    { ticker: "NEG", marketValue: -1.005, costBasis: -2.005, gainLoss: -3.005 },
  ]);
  assert.deepEqual(
    [positive.marketValue, positive.costBasis, positive.gainLoss],
    [1.01, 2.01, 3.01],
  );
  assert.deepEqual(
    [negative.marketValue, negative.costBasis, negative.gainLoss],
    [-1.01, -2.01, -3.01],
  );
});
