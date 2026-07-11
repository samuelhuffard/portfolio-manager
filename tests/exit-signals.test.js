import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveExitAction, evaluateExitSignals } from "../lib/exit-signals.js";

// --- resolveExitAction: the combined-logic table (memo source of truth) ---

test("T3 alone => full exit", () => {
  const r = resolveExitAction({ t1: false, t2: false, t3: true, dataUnavailable: false });
  assert.equal(r.action, "SELL");
  assert.equal(r.reducePct, 100);
});

test("all three => full exit, same session", () => {
  const r = resolveExitAction({ t1: true, t2: true, t3: true, dataUnavailable: false });
  assert.equal(r.action, "SELL");
  assert.match(r.speed, /same session/);
});

test("price drop + momentum reversal (no fundamentals) => full exit", () => {
  const r = resolveExitAction({ t1: true, t2: true, t3: false, dataUnavailable: false });
  assert.equal(r.action, "SELL");
  assert.equal(r.reducePct, 100);
});

test("momentum reversal only => partial trim", () => {
  const r = resolveExitAction({ t1: false, t2: true, t3: false, dataUnavailable: false }, { trimPct: 40 });
  assert.equal(r.action, "TRIM");
  assert.equal(r.reducePct, 40);
});

test("price drop alone => HOLD + flag, never auto-sell", () => {
  const r = resolveExitAction({ t1: true, t2: false, t3: false, dataUnavailable: false });
  assert.equal(r.action, "HOLD");
  assert.ok(r.reasons.some((x) => /no auto-sell/.test(x)));
});

test("no triggers => HOLD", () => {
  const r = resolveExitAction({ t1: false, t2: false, t3: false, dataUnavailable: false });
  assert.equal(r.action, "HOLD");
});

test("data unavailable => NO_TRADE", () => {
  const r = resolveExitAction({ t1: false, t2: false, t3: false, dataUnavailable: true });
  assert.equal(r.action, "NO_TRADE");
});

test("partial-data score below 35 permits a full exit for existing holdings", () => {
  const s = evaluateExitSignals({
    closes: [],
    partialData: { availableDataScore: 29, missing: ["forwardEps", "recentBars"] },
  });
  assert.equal(s.partialDataExit.action, "SELL");
  assert.equal(s.dataUnavailable, false);
  const r = resolveExitAction(s);
  assert.equal(r.action, "SELL");
  assert.match(r.reasons.join(" "), /available data score 29/);
});

test("partial-data score in the defensive band queues a trim", () => {
  const s = evaluateExitSignals({
    closes: [],
    partialData: { availableDataScore: 50, missing: ["marginTrend"] },
  });
  const r = resolveExitAction(s);
  assert.equal(r.action, "TRIM");
  assert.equal(r.reducePct, 40);
});

test("fundamental deterioration outranks partial-data trim", () => {
  const s = evaluateExitSignals({
    closes: [],
    fundamental: { epsSurprisePct: -8 },
    partialData: { availableDataScore: 45, missing: ["marginTrend"] },
  });
  const r = resolveExitAction(s);
  assert.equal(r.action, "SELL");
  assert.equal(r.reducePct, 100);
});

// --- evaluateExitSignals: T3 fires from a fundamental event even without price history ---

test("EPS miss > threshold sets T3 and is actionable without price data", () => {
  const s = evaluateExitSignals({ closes: [], fundamental: { epsSurprisePct: -8 } });
  assert.equal(s.t3, true);
  assert.equal(s.dataUnavailable, false);
  const r = resolveExitAction(s);
  assert.equal(r.action, "SELL");
});

test("a small EPS miss under threshold does not trip T3", () => {
  const s = evaluateExitSignals({ closes: [], fundamental: { epsSurprisePct: -2 } });
  assert.equal(s.t3, false);
  // no price data + no fundamental break => not actionable
  assert.equal(s.dataUnavailable, true);
});

test("insufficient price data and no fundamentals => dataUnavailable", () => {
  const s = evaluateExitSignals({ closes: [100, 101, 102] });
  assert.equal(s.dataUnavailable, true);
});
