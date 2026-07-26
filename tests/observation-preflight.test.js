import test from "node:test";
import assert from "node:assert/strict";
import { evaluateObservationPreflight } from "../scripts/observation-preflight.js";

const ENV = {
  MCP_RECEIPT_HMAC_SECRET: "receipt",
  OPERATIONAL_LEDGER_HMAC_SECRET: "operational",
  SYSLOOP_DEPLOY_HMAC_SECRET: "deploy",
  PORTFOLIO_WEBHOOK_SECRET: "webhook",
  ANTHROPIC_MONTHLY_MAX_USD: "40",
  ANTHROPIC_BUDGET_REQUIRED: "true",
};

test("observation preflight accepts only a clean exact release with all required safety keys", () => {
  assert.deepEqual(evaluateObservationPreflight({ status: "", head: "abc", remoteHead: "abc", env: ENV }), { ok: true, failures: [] });
});

test("observation preflight fails closed for dirty/divergent source or missing receipt configuration", () => {
  const result = evaluateObservationPreflight({ status: " M server.js", head: "abc", remoteHead: "def", env: { ...ENV, MCP_RECEIPT_HMAC_SECRET: "" } });
  assert.equal(result.ok, false);
  assert.match(result.failures.join(" "), /worktree is not clean/);
  assert.match(result.failures.join(" "), /does not equal/);
  assert.match(result.failures.join(" "), /MCP_RECEIPT_HMAC_SECRET is missing/);
});
