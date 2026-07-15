import { test } from "node:test";
import assert from "node:assert/strict";
import { assessCircuitBreaker, applyBreakerToProposal, deriveDailyNavBreakerBasis, reconcileNavHighWaterMark } from "../lib/circuit-breaker.js";

test("daily NAV basis ignores a transitional capital row before units are issued", () => {
  const basis = deriveDailyNavBreakerBasis([
    { date: "2026-07-12", unitsOutstanding: 75, navPerUnit: 1.0121 },
    { date: "2026-07-13", unitsOutstanding: 75, navPerUnit: 1.3397 },
    { date: "2026-07-13", unitsOutstanding: 99.7011, navPerUnit: 1.0069 },
    { date: "2026-07-13", unitsOutstanding: 99.7011, navPerUnit: 1.0067 },
    { date: "2026-07-14", unitsOutstanding: 99.7011, navPerUnit: 1.013 },
  ]);
  assert.deepEqual(basis, {
    current: 1.013,
    highWaterMark: 1.013,
    currentDate: "2026-07-14",
    dailyRows: 3,
    ignoredRows: 2,
  });
  assert.equal(assessCircuitBreaker({ current: basis.current, highWaterMark: basis.highWaterMark }).tier, "NONE");
});

test("daily NAV basis fails closed when no signed unitized measure is usable", () => {
  assert.deepEqual(deriveDailyNavBreakerBasis([
    { date: "2026-07-14", unitsOutstanding: null, navPerUnit: 1.01 },
    { date: "", unitsOutstanding: 10, navPerUnit: 1.02 },
  ]), {
    current: null,
    highWaterMark: null,
    currentDate: null,
    dailyRows: 0,
    ignoredRows: 2,
  });
});

test("scheduled scans retain a stricter stored HWM when signed ledger history shrinks", () => {
  const control = reconcileNavHighWaterMark({
    ledgerHighWaterMark: 1.2,
    dailyRows: 12,
    stored: { basis: "navPerUnit", value: 1.5, dailyRows: 13 },
  });
  assert.equal(control.highWaterMark, 1.5);
  assert.equal(control.dailyRows, 13);
  assert.deepEqual(control.issues, ["ledger_high_water_mark_decreased", "signed_daily_row_count_decreased"]);
  assert.equal(control.shouldAlert, true);
  assert.equal(assessCircuitBreaker({ current: 1.2, highWaterMark: control.highWaterMark }).tier, "HALT");
});

test("an unchanged ledger-integrity anomaly is deduplicated until manually accepted", () => {
  const first = reconcileNavHighWaterMark({
    ledgerHighWaterMark: 1.2,
    dailyRows: 12,
    stored: { basis: "navPerUnit", value: 1.5, dailyRows: 13 },
  });
  const repeated = reconcileNavHighWaterMark({
    ledgerHighWaterMark: 1.2,
    dailyRows: 12,
    stored: {
      basis: "navPerUnit",
      value: 1.5,
      dailyRows: 13,
      lastIntegrityAlertKey: first.integrityAlertKey,
    },
  });
  assert.equal(repeated.shouldAlert, false);

  const accepted = reconcileNavHighWaterMark({
    ledgerHighWaterMark: 1.2,
    dailyRows: 12,
    stored: { basis: "navPerUnit", value: 1.2, dailyRows: 12 },
  });
  assert.equal(accepted.highWaterMark, 1.2);
  assert.deepEqual(accepted.issues, []);
});

test("new signed NAV highs and additional daily rows advance both watermarks", () => {
  const control = reconcileNavHighWaterMark({
    ledgerHighWaterMark: 1.6,
    dailyRows: 14,
    stored: { basis: "navPerUnit", value: 1.5, dailyRows: 13 },
  });
  assert.equal(control.highWaterMark, 1.6);
  assert.equal(control.dailyRows, 14);
  assert.deepEqual(control.issues, []);
});

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
