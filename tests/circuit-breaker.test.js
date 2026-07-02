import { test } from "node:test";
import assert from "node:assert/strict";
import { assessCircuitBreaker, applyBreakerToProposal } from "../lib/circuit-breaker.js";

test("tier boundaries: 7.9% NONE, 8% REDUCE, 12% NO_NEW_BUYS, 15% EXITS_ONLY, 20% HALT", () => {
  const hwm = 100;
  assert.equal(assessCircuitBreaker({ current: 92.1, highWaterMark: hwm }).tier, "NONE");
  assert.equal(assessCircuitBreaker({ current: 92, highWaterMark: hwm }).tier, "REDUCE");
  assert.equal(assessCircuitBreaker({ current: 88, highWaterMark: hwm }).tier, "NO_NEW_BUYS");
  assert.equal(assessCircuitBreaker({ current: 85, highWaterMark: hwm }).tier, "EXITS_ONLY");
  assert.equal(assessCircuitBreaker({ current: 80, highWaterMark: hwm }).tier, "HALT");
});

test("new highs raise the high-water mark and clear drawdown", () => {
  const result = assessCircuitBreaker({ current: 120, highWaterMark: 100 });
  assert.equal(result.tier, "NONE");
  assert.equal(result.drawdownPct, 0);
  assert.equal(result.highWaterMark, 120);
});

test("first run (no prior hwm) seeds the hwm at current with no drawdown", () => {
  const result = assessCircuitBreaker({ current: 50, highWaterMark: null });
  assert.equal(result.tier, "NONE");
  assert.equal(result.highWaterMark, 50);
});

test("missing/invalid current value yields UNKNOWN, preserving the stored hwm", () => {
  assert.equal(assessCircuitBreaker({ current: null, highWaterMark: 100 }).tier, "UNKNOWN");
  assert.equal(assessCircuitBreaker({ current: null, highWaterMark: 100 }).highWaterMark, 100);
  assert.equal(assessCircuitBreaker({ current: 0, highWaterMark: 100 }).tier, "UNKNOWN");
  assert.equal(assessCircuitBreaker({ current: NaN, highWaterMark: 100 }).tier, "UNKNOWN");
});

test("REDUCE halves BUY sizing and leaves SELLs untouched", () => {
  const buy = applyBreakerToProposal("REDUCE", "BUY", 100);
  assert.equal(buy.allowed, true);
  assert.equal(buy.amountDollars, 50);
  assert.ok(buy.note.includes("halved"));
  const sell = applyBreakerToProposal("REDUCE", "SELL", 100);
  assert.deepEqual([sell.allowed, sell.amountDollars, sell.note], [true, 100, null]);
});

test("NO_NEW_BUYS blocks BUYs, allows SELLs", () => {
  assert.equal(applyBreakerToProposal("NO_NEW_BUYS", "BUY", 100).allowed, false);
  assert.equal(applyBreakerToProposal("NO_NEW_BUYS", "SELL", 100).allowed, true);
});

test("EXITS_ONLY blocks BUYs, allows SELLs with a note", () => {
  assert.equal(applyBreakerToProposal("EXITS_ONLY", "BUY", 100).allowed, false);
  const sell = applyBreakerToProposal("EXITS_ONLY", "SELL", 100);
  assert.equal(sell.allowed, true);
  assert.ok(sell.note.includes("EXITS_ONLY"));
});

test("HALT blocks everything", () => {
  assert.equal(applyBreakerToProposal("HALT", "BUY", 100).allowed, false);
  assert.equal(applyBreakerToProposal("HALT", "SELL", 100).allowed, false);
});

test("UNKNOWN blocks BUYs (a breaker that can't see can't wave money through) but allows SELLs", () => {
  assert.equal(applyBreakerToProposal("UNKNOWN", "BUY", 100).allowed, false);
  assert.equal(applyBreakerToProposal("UNKNOWN", "SELL", 100).allowed, true);
});

test("NONE passes proposals through unchanged", () => {
  assert.deepEqual(applyBreakerToProposal("NONE", "BUY", 42.5), { allowed: true, amountDollars: 42.5, note: null });
});
