import { test } from "node:test";
import assert from "node:assert/strict";
import { planBrokerZeroLotClosure } from "../lib/lot-reconciliation.js";
const lot = { lotId: "nvda-residual", ticker: "NVDA", agentId: "agent-1", sharesOpen: 0.000115, status: "OPEN", rowIndex: 4, rowHmac: "signed" };
const fresh = { quoteSnapshot: { quoteTimestamp: "2026-08-04T12:00:00.000Z" }, rawRows: [["AAPL", "Apple", 1]], now: new Date("2026-08-04T12:05:00.000Z") };
test("closes only exact fresh broker-zero residual", () => assert.equal(planBrokerZeroLotClosure({ lots: [lot], holdings: [{ ticker: "AAPL", shares: 1 }], ...fresh, lotId: lot.lotId, expectedSharesOpen: 0.000115 }).updatedLot.status, "CLOSED"));
test("refuses malformed, empty, or live broker state", () => {
  assert.throws(() => planBrokerZeroLotClosure({ lots: [lot], holdings: [], ...fresh, lotId: lot.lotId, expectedSharesOpen: 0.000115 }), /empty/);
  assert.throws(() => planBrokerZeroLotClosure({ lots: [lot], holdings: [{ ticker: "NVDA", shares: 1 }], ...fresh, lotId: lot.lotId, expectedSharesOpen: 0.000115 }), /still reports/);
});
