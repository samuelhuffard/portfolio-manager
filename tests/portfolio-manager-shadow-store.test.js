import { test } from "node:test";
import assert from "node:assert/strict";
import { PORTFOLIO_SHADOW_KEYS } from "../contracts/portfolio-decision.js";

test("Agent 4 shadow keys are isolated from live approval and execution keys", () => {
  for (const value of Object.values(PORTFOLIO_SHADOW_KEYS)) {
    assert.match(value, /^pm:(portfolio-decision|portfolio-decisions|allocation-|portfolio-risk-)/);
    assert.doesNotMatch(value, /approval_proposal|order|execution/i);
  }
});
