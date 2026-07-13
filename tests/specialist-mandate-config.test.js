import { readFile } from "node:fs/promises";
import { test } from "node:test";
import assert from "node:assert/strict";
import { AGENTS } from "../config/agents.js";
import { canCreateActionableProposal } from "../lib/research-run-health.js";

const configRoot = new URL("../config/agents/", import.meta.url);

async function readAgentFile(agentId, filename) {
  return readFile(new URL(`${agentId}/${filename}`, configRoot), "utf8");
}

test("Agents Two and Three retain supervised v3 mandate configuration", async () => {
  const expected = {
    "agent-2": { plan: "Agent Two Strategy Specification v3", minMarketCap: 300000000, minAvgDollarVolume: 10000000 },
    "agent-3": { plan: "Agent Three Strategy Specification v3", minMarketCap: null, minAvgDollarVolume: 10000000 },
  };

  for (const [agentId, requirements] of Object.entries(expected)) {
    const agent = AGENTS.find((entry) => entry.id === agentId);
    assert.equal(agent?.executionEligibility, "supervised");
    assert.equal(canCreateActionableProposal(agent), true);

    const [personality, plan, riskLimitsText] = await Promise.all([
      readAgentFile(agentId, "personality.md"),
      readAgentFile(agentId, agentId === "agent-2" ? "AGENT-TWO-PLAN.md" : "AGENT-THREE-PLAN.md"),
      readAgentFile(agentId, "risk-limits.json"),
    ]);
    const riskLimits = JSON.parse(riskLimitsText);

    assert.match(personality, /Sam gives final approval/i);
    assert.match(plan, new RegExp(requirements.plan));
    assert.equal(riskLimits.minMarketCap ?? null, requirements.minMarketCap);
    assert.equal(riskLimits.minAvgDollarVolume, requirements.minAvgDollarVolume);
  }
});
