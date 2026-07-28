import test from "node:test";
import assert from "node:assert/strict";
import {
  appendResearchDecisionAudits,
  legacyRecommendationToDecisionAudit,
  normalizeResearchDecisionAudit,
} from "../lib/research-decision-audit.js";
import { backfillableLegacyAudits } from "../scripts/backfill-research-decision-audit.js";

test("decision audit preserves the full evaluator critique and final disposition", () => {
  const audit = normalizeResearchDecisionAudit({
    runId: "run-1", agentId: "agent-2", ticker: "wat", decidedAt: "2026-07-27T18:00:00.000Z",
    quantScore: 75.56, generatorAction: "BUY", finalAction: "HOLD", evaluatorState: "rejected",
    evaluatorVerdict: "REJECT after 1 revision", evaluatorCritique: ["unsupported claim", "thin bear case"],
    proposalDisposition: "not_applicable", reason: "evaluator rejected", ruleCheck: ["evaluator_reject: unsupported claim"],
  });
  assert.deepEqual(audit.evaluatorCritique, ["unsupported claim", "thin bear case"]);
  assert.equal(audit.finalAction, "HOLD");
  assert.equal(audit.quantScore, 75.56);
});

test("decision audits append an immutable ordered run record", async () => {
  const calls = [];
  const redis = {
    rpush: async (...args) => calls.push(["rpush", ...args]),
    expire: async (...args) => calls.push(["expire", ...args]),
    lpush: async (...args) => calls.push(["lpush", ...args]),
    ltrim: async (...args) => calls.push(["ltrim", ...args]),
  };
  const result = await appendResearchDecisionAudits([{
    runId: "run-1", agentId: "agent-2", ticker: "GS", decidedAt: "2026-07-27T18:00:00.000Z", evaluatorState: "approved",
  }], { redis, ttlSeconds: 60 });
  assert.equal(result.retained, 1);
  assert.match(calls[0][1], /pm:research-decision-audit:run:run-1$/);
  assert.equal(JSON.parse(calls[0][2]).evaluatorState, "approved");
  assert.deepEqual(calls[1], ["expire", calls[0][1], 60]);
  assert.match(calls[2][1], /pm:research-decision-audit:history$/);
  assert.deepEqual(calls[3], ["ltrim", calls[2][1], 0, 4999]);
});

test("legacy recommendation audit preserves provenance and does not fabricate review stages", () => {
  const audit = legacyRecommendationToDecisionAudit({
    date: "2026-07-20", ticker: "gs", action: "BUY", quantScore: 72.4,
    rationale: "Legacy thesis", status: "pending", ruleCheck: "OK", targetWeight: 3,
  }, { agentId: "agent-3", sheetRow: 18 });
  assert.equal(audit.source, "legacy_recommendation_sheet");
  assert.equal(audit.runId, "legacy-sheet:agent-3:18");
  assert.equal(audit.decidedAt, "2026-07-20T12:00:00.000Z");
  assert.equal(audit.evaluatorState, "not_recorded_legacy");
  assert.equal(audit.kairosOutcome, "not_recorded_legacy");
  assert.match(audit.ruleCheck.join(" "), /row 18/);
});

test("legacy backfill is stable, deduplicated, and newest-first behind live records", () => {
  const audits = backfillableLegacyAudits({
    "agent-1": [{ sheetRow: 14, date: "2026-07-18", ticker: "AAPL", action: "HOLD", rationale: "older" }],
    "agent-2": [{ sheetRow: 15, date: "2026-07-20", ticker: "MSFT", action: "BUY", rationale: "newer" }],
  }, [JSON.stringify({ runId: "legacy-sheet:agent-1:14" })]);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].ticker, "MSFT");
  assert.equal(audits[0].runId, "legacy-sheet:agent-2:15");
});
