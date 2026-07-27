import test from "node:test";
import assert from "node:assert/strict";
import { MARKET_SCAN_TRIGGER_KEY, requestMcpMarketScan } from "../jobs/market-scan-requests.js";

test("market-scan requests are coalesced into a short-lived Mac companion trigger", async () => {
  const calls = [];
  const redis = {
    async set(...args) {
      calls.push(args);
      return "OK";
    },
  };
  const now = new Date("2026-07-26T15:00:00.000Z");

  const result = await requestMcpMarketScan({ redis, now });

  assert.deepEqual(result, { queued: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], MARKET_SCAN_TRIGGER_KEY);
  assert.deepEqual(JSON.parse(calls[0][1]), {
    requestedAt: now.toISOString(),
    source: "research-scan",
  });
  assert.deepEqual(calls[0][2], { nx: true, ex: 600 });
});

test("market-scan requests report an already-pending trigger without replacing it", async () => {
  const redis = { set: async () => null };
  assert.deepEqual(await requestMcpMarketScan({ redis }), { queued: false });
});
