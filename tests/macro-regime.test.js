import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateMacroRedFlags, formatMacroRedFlags } from "../lib/macro-regime.js";

test("dual red only when SPY is below its 200-day average AND rate pressure exceeds threshold", () => {
  const dualRed = evaluateMacroRedFlags({ spyPrice: 490, spySma200: 500, treasuryYieldChangeBps: 60 });
  assert.equal(dualRed.spyRed, true);
  assert.equal(dualRed.rateRed, true);
  assert.equal(dualRed.redCount, 2);
  assert.equal(dualRed.dualRed, true);

  const singleRed = evaluateMacroRedFlags({ spyPrice: 490, spySma200: 500, treasuryYieldChangeBps: 20 });
  assert.equal(singleRed.spyRed, true);
  assert.equal(singleRed.rateRed, false);
  assert.equal(singleRed.redCount, 1);
  assert.equal(singleRed.dualRed, false);

  const allGreen = evaluateMacroRedFlags({ spyPrice: 510, spySma200: 500, treasuryYieldChangeBps: 10 });
  assert.equal(allGreen.redCount, 0);
  assert.equal(allGreen.dualRed, false);
});

test("rate pressure is a magnitude check — a large drop is red just like a large rise", () => {
  const dropping = evaluateMacroRedFlags({ spyPrice: 510, spySma200: 500, treasuryYieldChangeBps: -75 });
  assert.equal(dropping.rateRed, true);
});

test("missing inputs yield unknown (null), never a guessed true/false, and never count toward redCount", () => {
  const missingSpy = evaluateMacroRedFlags({ spyPrice: null, spySma200: 500, treasuryYieldChangeBps: 60 });
  assert.equal(missingSpy.spyRed, null);
  assert.equal(missingSpy.rateRed, true);
  assert.equal(missingSpy.redCount, 1);
  assert.equal(missingSpy.dualRed, false); // dualRed requires BOTH known and true

  const missingBoth = evaluateMacroRedFlags({ spyPrice: null, spySma200: null, treasuryYieldChangeBps: null });
  assert.equal(missingBoth.spyRed, null);
  assert.equal(missingBoth.rateRed, null);
  assert.equal(missingBoth.redCount, 0);
  assert.equal(missingBoth.dualRed, false);
});

test("formatMacroRedFlags renders a stated fact, not raw numbers to reason over", () => {
  const text = formatMacroRedFlags(evaluateMacroRedFlags({ spyPrice: 490, spySma200: 500, treasuryYieldChangeBps: 10 }));
  assert.match(text, /SPY below 200-day average: RED/);
  assert.match(text, /10-year rate pressure: green/);

  const unknown = formatMacroRedFlags(evaluateMacroRedFlags({ spyPrice: null, spySma200: null, treasuryYieldChangeBps: null }));
  assert.match(unknown, /SPY below 200-day average: unavailable/);

  assert.equal(formatMacroRedFlags(null), null);
});
