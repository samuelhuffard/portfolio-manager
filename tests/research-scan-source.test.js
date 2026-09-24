import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8");

test("only the cron owner labels a research scan scheduled", () => {
  const scan = read("../jobs/research-scan.js");
  const scheduler = read("../scheduler.js");
  const mcpSync = read("../scripts/sync-holdings-from-mcp.js");

  assert.match(scan, /runResearchScanUnlocked\(\{ agentIds = DEFAULT_AGENT_IDS, source = "manual" \}/);
  assert.match(scan, /source: "manual"/);
  assert.match(scheduler, /\(\) => runResearchScan\(\{ source: "scheduled" \}\)/);
  assert.match(mcpSync, /runResearchScan\(\{ source: "manual" \}\)/);
  assert.match(scan, /\{ breaker, boundaryToken, budget, runId, source = "manual",/);
  assert.match(scan, /createScheduledPeerFundamentalProposalCanary\(\{ source \}\)/);
});

test("generator and evaluator-revision paths both retain the macro tier ceiling after risk checks", () => {
  const scan = read("../jobs/research-scan.js");
  assert.match(
    scan,
    /let rec = applyConvictionClamp\(applyRiskChecks\(proposal, riskContext, riskLimits\), agent, c, riskLimits\);[\s\S]{0,1800}applySingleRedMacroTierCap\(rec, \{ agentId: agent\.id, macroRedFlags: ctx\.macroRedFlags \}\)/,
    "the generator result must be capped after deterministic risk checks",
  );
  assert.match(
    scan,
    /const revised = applySingleRedMacroTierCap\(\s*applyConvictionClamp\(applyRiskChecks\(revisedRaw, riskContext, riskLimits\), agent, c, riskLimits\),\s*\{ agentId: agent\.id, macroRedFlags: ctx\.macroRedFlags \},/,
    "an evaluator revision must be capped after its fresh deterministic risk checks",
  );
});
