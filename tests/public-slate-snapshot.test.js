import { test } from "node:test";
import assert from "node:assert/strict";
import { toPublicSlateSnapshot } from "../lib/public-slate-snapshot.js";

test("public slate health projection preserves aggregate proof and strips private additions", () => {
  const result = toPublicSlateSnapshot({
    date: "2026-07-20",
    status: "complete",
    source: "catalog",
    degraded: false,
    screenPolicyVersion: "screen-v1",
    attentionPolicyVersion: "attention-v1",
    counts: { holdings: 1, movers: 2, ranked: 3, exploration: 4 },
    census: { listed: 5000, quoted: 4900, privateTicker: "SECRET" },
    ledger: { totalNames: 50, researchedLast7d: 10, researchedLast14d: 20 },
    tickers: ["PRIVATE"],
    rationale: "private investment thesis",
    candidates: [{ ticker: "SECRET" }],
  });

  assert.equal(result.status, "complete");
  assert.deepEqual(result.counts, { holdings: 1, movers: 2, ranked: 3, exploration: 4 });
  assert.equal(result.census.listed, 5000);
  assert.equal(JSON.stringify(result).includes("PRIVATE"), false);
  assert.equal(JSON.stringify(result).includes("SECRET"), false);
  assert.equal(JSON.stringify(result).includes("investment thesis"), false);
});

test("missing public slate snapshot remains null", () => {
  assert.equal(toPublicSlateSnapshot(null), null);
});
