import test from "node:test";
import assert from "node:assert/strict";
import { evaluateObservationPreflight } from "../scripts/observation-preflight.js";

const ENV = {
  AUDIT_HMAC_SECRET: "audit",
  INVESTOR_LEDGER_HMAC_SECRET: "investor",
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

test("observation preflight refuses an environment missing the approval-signature key", () => {
  // AUDIT_HMAC_SECRET is what assertApprovedProposalSignature verifies against.
  // Without it that check cannot run, so a preflight that passes here would
  // certify a production environment with the execution boundary switched off.
  const result = evaluateObservationPreflight({ status: "", head: "abc", remoteHead: "abc", env: { ...ENV, AUDIT_HMAC_SECRET: "" } });
  assert.equal(result.ok, false);
  assert.match(result.failures.join(" "), /AUDIT_HMAC_SECRET is missing/);
});

test("observation preflight refuses any signature escape hatch left switched on", () => {
  // Every spelling a consumer treats as true must fail, not just the literal
  // "true": lib/robinhood-sync.py and lib/robinhood-scan.py enable session
  // persistence for "1"/"true"/"yes", so matching only "true" would pass
  // ROBINHOOD_STORE_SESSION=yes with a reusable brokerage pickle on disk.
  for (const name of ["ALLOW_UNSIGNED_PROPOSALS", "ALLOW_UNSIGNED_INVESTOR_LEDGER", "ROBINHOOD_STORE_SESSION"]) {
    for (const value of ["true", "TRUE", "1", "yes", "Yes", "on", " true "]) {
      const result = evaluateObservationPreflight({ status: "", head: "abc", remoteHead: "abc", env: { ...ENV, [name]: value } });
      assert.equal(result.ok, false, `${name}=${value} must fail preflight`);
      assert.match(result.failures.join(" "), new RegExp(`${name}=.*disables a safety check`));
    }
  }
  // Explicitly "false" — the documented production value — must still pass.
  assert.equal(evaluateObservationPreflight({
    status: "", head: "abc", remoteHead: "abc",
    env: { ...ENV, ALLOW_UNSIGNED_PROPOSALS: "false", ROBINHOOD_STORE_SESSION: "false" },
  }).ok, true);
});

test("observation preflight refuses an ownership-enforcement kill switch left pulled", () => {
  // Inverted sense: enforcement is on unless explicitly "false". With it off, a
  // signed SELL can consume another strategy's lots and misattribute gains.
  for (const value of ["false", "FALSE", " false "]) {
    const result = evaluateObservationPreflight({ status: "", head: "abc", remoteHead: "abc", env: { ...ENV, ENFORCE_OWNERSHIP: value } });
    assert.equal(result.ok, false, `ENFORCE_OWNERSHIP=${value} must fail preflight`);
    assert.match(result.failures.join(" "), /ENFORCE_OWNERSHIP=false reverts to legacy account-wide FIFO/);
  }
  // Unset and "true" are the production states and must pass.
  assert.equal(evaluateObservationPreflight({ status: "", head: "abc", remoteHead: "abc", env: ENV }).ok, true);
  assert.equal(evaluateObservationPreflight({ status: "", head: "abc", remoteHead: "abc", env: { ...ENV, ENFORCE_OWNERSHIP: "true" } }).ok, true);
});
