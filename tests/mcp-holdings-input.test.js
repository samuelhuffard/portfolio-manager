import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMcpHoldingsQuoteSnapshot, parseMcpHoldingsInput } from "../lib/mcp-holdings-input.js";

const valid = {
  positions: [{ ticker: "NVDA", name: "NVIDIA", shares: "0.075555", avgCost: "198.5309", currentPrice: "206.1" }],
  cash: "12.34",
};

test("MCP holdings input normalizes broker numeric strings without losing fractional shares", () => {
  const { holdings, cash } = parseMcpHoldingsInput(valid);
  assert.equal(cash, 12.34);
  assert.equal(holdings[0].shares, 0.075555);
  assert.equal(holdings[0].marketValue, 0.075555 * 206.1);
});

test("MCP holdings input refuses absent cash, invalid numbers, and duplicate tickers", () => {
  assert.throws(() => parseMcpHoldingsInput({ positions: [] }), /explicit cash/);
  assert.throws(() => parseMcpHoldingsInput({ ...valid, cash: "NaN" }), /cash/);
  assert.throws(() => parseMcpHoldingsInput({ ...valid, positions: [{ ...valid.positions[0], shares: -1 }] }), /shares/);
  assert.throws(() => parseMcpHoldingsInput({ ...valid, positions: [valid.positions[0], valid.positions[0]] }), /duplicates/);
});

test("builds a timestamped provenance marker for a broker MCP position snapshot", () => {
  assert.deepEqual(buildMcpHoldingsQuoteSnapshot("2026-08-04T14:00:00.000Z"), {
    quoteSnapshotVersion: "robinhood-mcp-positions-v1",
    quoteSource: "robinhood-trading-mcp:get_equity_positions",
    quoteTimestamp: "2026-08-04T14:00:00.000Z",
  });
  assert.throws(() => buildMcpHoldingsQuoteSnapshot("not-a-date"), /valid timestamp/);
});
