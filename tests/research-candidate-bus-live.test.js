import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildLiveResearchCandidateBus,
  resolveAgentCatalogMode,
  LIVE_RESEARCH_CANDIDATE_BUS_VERSION,
} from "../lib/research-candidate-bus.js";

const catalog = {
  FAST: { t: "FAST", n: "Fast Co", x: "NASDAQ", mc: 2e9, advd: 20e6, p: 20, c52: 80, qa: "2026-07-20", ftd: Date.parse("2010-01-04") },
  GIANT: { t: "GIANT", n: "Giant Co", x: "NYSE", mc: 500e9, advd: 500e6, p: 200, c52: 20, qa: "2026-07-20", ftd: Date.parse("2010-01-04") },
  THIN: { t: "THIN", n: "Thin Co", x: "NYSE", mc: 1e9, advd: 2e6, p: 5, c52: 100, qa: "2026-07-20", ftd: Date.parse("2010-01-04") },
};

function configs() {
  return {
    "agent-1": { riskLimits: { microCapMinAvgDollarVolume: 3e6 } },
    "agent-2": { riskLimits: { minMarketCap: 300e6, minAvgDollarVolume: 10e6 } },
    "agent-3": { riskLimits: { minAvgDollarVolume: 10e6 } },
  };
}

test("one live research-only bus exposes identical facts and independent mandate ranks", () => {
  const bus = buildLiveResearchCandidateBus({
    catalog,
    agentConfigs: configs(),
    asOf: new Date("2026-07-20T21:00:00.000Z"),
  });
  assert.equal(bus.contractVersion, LIVE_RESEARCH_CANDIDATE_BUS_VERSION);
  assert.equal(bus.authority, "research_only");
  assert.equal(bus.executionAuthority, "none");
  assert.equal(bus.candidates.length, 3);
  assert.equal(bus.agents["agent-1"].visibleCount, 3);
  assert.equal(bus.agents["agent-2"].visibleCount, 3);
  assert.equal(bus.agents["agent-3"].visibleCount, 3);
  assert.deepEqual(bus.agents["agent-2"].eligible.map((row) => row.ticker), ["FAST", "GIANT"]);
  assert.deepEqual(bus.agents["agent-3"].eligible.map((row) => row.ticker), ["GIANT", "FAST"]);
  assert.equal(JSON.stringify(bus).includes("\"action\""), false);
  assert.equal(JSON.stringify(bus).includes("\"amountDollars\""), false);
});

test("catalog identity is deterministic and census distinguishes raw from usable coverage", () => {
  const first = buildLiveResearchCandidateBus({ catalog, agentConfigs: configs(), asOf: new Date("2026-07-20T21:00:00Z") });
  const second = buildLiveResearchCandidateBus({
    catalog: Object.fromEntries(Object.entries(catalog).reverse()),
    agentConfigs: configs(),
    asOf: new Date("2026-07-20T22:00:00Z"),
  });
  assert.equal(first.catalogSnapshotId, second.catalogSnapshotId);
  assert.deepEqual(first.census, {
    listed: 3,
    quoted: 3,
    classified: 0,
    marketCapCovered: 3,
    liquidityCovered: 3,
    quoteAndLiquidityCovered: 3,
  });
});

test("every agent's rollback receipt is explicit, independent, and degraded", () => {
  for (const agentId of ["agent-1", "agent-2", "agent-3"]) {
    const number = agentId.at(-1);
    const rollbackEnv = `AGENT_${number}_CATALOG_ROLLBACK`;
    const config = { source: "catalog", catalogRollbackEnv: rollbackEnv };
    assert.deepEqual(resolveAgentCatalogMode(agentId, config, {}), {
      requestedSource: "catalog",
      effectiveSource: "catalog",
      degraded: false,
      reasonCode: null,
      rollbackEnv,
    });
    assert.deepEqual(resolveAgentCatalogMode(agentId, config, { [rollbackEnv]: "true" }), {
      requestedSource: "catalog",
      effectiveSource: "watchlist",
      degraded: true,
      reasonCode: "catalog_rollback_enabled",
      rollbackEnv,
    });
  }
});
