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

test("Agent One runtime artifacts follow the authoritative sector-agnostic v3 mandate", async () => {
  // Agent One is the split-mandate pilot: master.md + buy-playbook.md replace
  // the old flat personality.md and get concatenated the same way
  // jobs/research-scan.js's loadPersonality() does at runtime.
  const [master, buyPlaybook, plan, riskLimitsText] = await Promise.all([
    readAgentFile("agent-1", "master.md"),
    readAgentFile("agent-1", "buy-playbook.md"),
    readAgentFile("agent-1", "AGENT-ONE-PLAN.md"),
    readAgentFile("agent-1", "risk-limits.json"),
  ]);
  const personality = `${master.trim()}\n\n${buyPlaybook.trim()}`;
  const riskLimits = JSON.parse(riskLimitsText);

  assert.match(personality, /Mandate v3/i);
  assert.match(personality, /across every sector/i);
  assert.doesNotMatch(personality, /technology-growth sleeve/i);
  assert.match(plan, /Agent One Strategy Specification v3/);
  assert.match(plan, /sector-agnostic/i);
  assert.equal(riskLimits.allowedSubVerticals, undefined);
  assert.equal(riskLimits.microCapMinAvgDollarVolume, 3_000_000);
  assert.equal(riskLimits.nonMicroCapMinAvgDollarVolume, 10_000_000);
  assert.equal(riskLimits.minCashReservePct, 5);
  assert.equal(riskLimits.percentageSizingMinPortfolioValue, 500);
  assert.equal(riskLimits.starterPortfolioMaxPositions, 2);
  assert.equal(riskLimits.starterPortfolioCashReservePct, 5);
  assert.equal(riskLimits.prohibitAveragingDown, true);
});
