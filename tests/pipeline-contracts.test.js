import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ResearchIntentSchema,
  StrategyProposalSchema,
  OrderIntentSchema,
  INTENT_SOURCES,
} from "../contracts/pipeline.js";
import { checkApprovalStillValid, assertApprovalStillValid } from "../lib/approval-validity.js";

test("ResearchIntent accepts a directed exit intent and an undirected discovery intent", () => {
  assert.doesNotThrow(() =>
    ResearchIntentSchema.parse({
      id: "ri1", source: "exit-signal", agentId: "agent-1", ticker: "NVDA", side: "SELL",
      createdAt: "2026-07-11T00:00:00Z", reason: "stop breached", evidenceRefs: ["e1"],
    })
  );
  const undirected = ResearchIntentSchema.parse({
    id: "ri2", source: "scheduled-discovery", agentId: "agent-2", ticker: null, side: null,
    createdAt: "2026-07-11T00:00:00Z", reason: "daily scan",
  });
  assert.deepEqual(undirected.evidenceRefs, []); // default applied
});

test("ResearchIntent rejects an unknown source", () => {
  assert.ok(!INTENT_SOURCES.includes("webhook"));
  assert.throws(() =>
    ResearchIntentSchema.parse({
      id: "ri3", source: "webhook", agentId: "agent-1", ticker: "NVDA", side: "BUY",
      createdAt: "2026-07-11T00:00:00Z", reason: "x",
    })
  );
});

test("StrategyProposal requires >=1 kill criterion and (for SELL) cited lots", () => {
  const base = {
    intentId: "ri1", agentId: "agent-1", ticker: "NVDA", amountDollars: 500, maxPrice: null,
    thesis: "momentum", killCriteria: ["close below 50DMA"], horizonDays: 30, evidenceSnapshotId: "e1",
  };
  assert.doesNotThrow(() => StrategyProposalSchema.parse({ ...base, side: "BUY", citedLotIds: [] }));
  // SELL with no cited lots must fail.
  assert.throws(() => StrategyProposalSchema.parse({ ...base, side: "SELL", citedLotIds: [] }), /cite the owned lots/);
  // SELL with cited lots passes.
  assert.doesNotThrow(() => StrategyProposalSchema.parse({ ...base, side: "SELL", citedLotIds: ["lot-1"] }));
  // Zero kill criteria fails.
  assert.throws(() => StrategyProposalSchema.parse({ ...base, side: "BUY", citedLotIds: [], killCriteria: [] }));
});

test("OrderIntent enforces refId === proposalId", () => {
  const good = {
    proposalId: "p1", refId: "p1", agentId: "agent-1", ticker: "NVDA", side: "BUY",
    amountDollars: 500, maxPrice: null, approvedAt: "2026-07-11T00:00:00Z", decisionHmac: "abc",
  };
  assert.doesNotThrow(() => OrderIntentSchema.parse(good));
  assert.throws(() => OrderIntentSchema.parse({ ...good, refId: "other" }), /must equal proposalId/);
});

// --- state-version validity -------------------------------------------------

test("BUY approval invalidated when cash is no longer available", () => {
  const buy = { side: "BUY", amountDollars: 500, maxPrice: null, ticker: "NVDA" };
  assert.deepEqual(checkApprovalStillValid(buy, { cashAvailable: 500 }), { ok: true });
  const stale = checkApprovalStillValid(buy, { cashAvailable: 400 });
  assert.equal(stale.ok, false);
  assert.match(stale.reason, /only \$400\.00 cash remains/);
});

test("BUY limit approval invalidated when quote ran past max price", () => {
  const buy = { side: "BUY", amountDollars: 500, maxPrice: 100, ticker: "NVDA" };
  assert.deepEqual(checkApprovalStillValid(buy, { cashAvailable: 500, quote: 99 }), { ok: true });
  assert.equal(checkApprovalStillValid(buy, { cashAvailable: 500, quote: 101 }).ok, false);
});

test("SELL approval invalidated when the position shrank below the implied shares", () => {
  const sell = { side: "SELL", amountDollars: 1000, maxPrice: 100, ticker: "NVDA" }; // implies ~10 shares
  assert.deepEqual(checkApprovalStillValid(sell, { ownedShares: 10, quote: 100 }), { ok: true });
  const stale = checkApprovalStillValid(sell, { ownedShares: 8, quote: 100 });
  assert.equal(stale.ok, false);
  assert.match(stale.reason, /only 8 are held now/);
});

test("assertApprovalStillValid throws on a stale approval and passes on a fresh one", () => {
  const buy = { side: "BUY", amountDollars: 500, maxPrice: null, ticker: "NVDA" };
  assert.throws(() => assertApprovalStillValid(buy, { cashAvailable: 100 }), /no longer valid/);
  assert.doesNotThrow(() => assertApprovalStillValid(buy, { cashAvailable: 500 }));
});

test("missing current state does not false-positive (only known changes invalidate)", () => {
  // If we can't observe cash/shares/quote, we don't fabricate an invalidation
  // here — the money path has its own hard gates; this check only fires on an
  // observed material change.
  const buy = { side: "BUY", amountDollars: 500, maxPrice: 100, ticker: "NVDA" };
  assert.deepEqual(checkApprovalStillValid(buy, {}), { ok: true });
});
