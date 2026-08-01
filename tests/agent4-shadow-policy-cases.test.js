import test from "node:test";
import assert from "node:assert/strict";
import { AGENT4_SHADOW_POLICY_CASES } from "../fixtures/agent4-shadow-policy-cases.js";

test("W4 synthetic conflict catalog remains shadow-only and explicit about unresolved policy", () => {
  assert.deepEqual(AGENT4_SHADOW_POLICY_CASES.map((item) => item.id), [
    "duplicate-thesis", "concentration-breach", "stale-portfolio",
    "unowned-sell", "budget-exhaustion", "sam-disagrees",
  ]);
  for (const item of AGENT4_SHADOW_POLICY_CASES) {
    assert.match(item.expectedDisposition, /reject_explainable|non_actionable/);
    assert.equal("orderIntent" in item, false);
    assert.equal("approvalHmac" in item, false);
  }
});

