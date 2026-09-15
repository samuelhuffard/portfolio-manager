import { test } from "node:test";
import assert from "node:assert/strict";
import { applySingleRedMacroTierCap, evaluateMacroRedFlags, formatMacroRedFlags } from "../lib/macro-regime.js";

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

test("one fully known red macro condition caps Agent 1 and Agent 2 BUYs at their configured Tier-2 upper bound", () => {
  const flags = { spyRed: true, rateRed: false, redCount: 1, dualRed: false };
  const agentOne = applySingleRedMacroTierCap({ action: "BUY", targetWeight: 15 }, { agentId: "agent-1", macroRedFlags: flags });
  const agentTwo = applySingleRedMacroTierCap({ action: "BUY", targetWeight: 12 }, { agentId: "agent-2", macroRedFlags: flags });

  assert.equal(agentOne.targetWeight, 10);
  assert.match(agentOne.overrideNotes.at(-1), /tier_2 capped 15%→10%/);
  assert.equal(agentTwo.targetWeight, 8);
  assert.match(agentTwo.overrideNotes.at(-1), /tier_2 capped 12%→8%/);
});

test("single-red macro cap is strictly downgrade-only and ignores Agent 3, HOLD, SELL, dual red, and fully missing macro data", () => {
  const buy = { action: "BUY", targetWeight: 5 };
  const singleRed = { spyRed: false, rateRed: true, redCount: 1, dualRed: false };
  const alreadyConservative = applySingleRedMacroTierCap(buy, { agentId: "agent-1", macroRedFlags: singleRed });
  assert.equal(alreadyConservative.targetWeight, 5);
  assert.match(alreadyConservative.overrideNotes.at(-1), /ceiling 10% retained 5%/);
  assert.equal(applySingleRedMacroTierCap({ action: "BUY", targetWeight: 15 }, { agentId: "agent-3", macroRedFlags: singleRed }).targetWeight, 15);
  assert.equal(applySingleRedMacroTierCap({ action: "HOLD", targetWeight: 0 }, { agentId: "agent-1", macroRedFlags: singleRed }).action, "HOLD");
  assert.equal(applySingleRedMacroTierCap({ action: "SELL", targetWeight: 0 }, { agentId: "agent-1", macroRedFlags: singleRed }).action, "SELL");
  assert.equal(applySingleRedMacroTierCap({ action: "BUY", targetWeight: 15 }, { agentId: "agent-1", macroRedFlags: { spyRed: true, rateRed: true } }).targetWeight, 15);
  assert.equal(applySingleRedMacroTierCap({ action: "BUY", targetWeight: 15 }, { agentId: "agent-1", macroRedFlags: { spyRed: true, rateRed: null, redCount: 1 } }).targetWeight, 10);
  assert.equal(applySingleRedMacroTierCap({ action: "BUY", targetWeight: 15 }, { agentId: "agent-1", macroRedFlags: { spyRed: null, rateRed: null, redCount: 0 } }).targetWeight, 15);
});
