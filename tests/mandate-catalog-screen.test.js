import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateMandateBusinessEligibility,
  observedBusinessFamily,
  screenCatalogForAgent,
} from "../lib/mandate-catalog-screen.js";

function candidate(overrides = {}) {
  return {
    ticker: "ACME",
    sector: "Consumer Defensive",
    industry: "Beverages",
    marketCap: 5_000_000_000,
    avgDollarVolume: 25_000_000,
    fiftyTwoWeekChangePct: 20,
    ...overrides,
  };
}

test("all agents can discover the same eligible non-technology operating company", () => {
  for (const agentId of ["agent-1", "agent-2", "agent-3"]) {
    const result = screenCatalogForAgent(agentId, [candidate()]);
    assert.equal(result.passed.length, 1, agentId);
    assert.equal(result.rejected.length, 0, agentId);
  }
});

test("Agent One preserves its microcap-versus-ordinary liquidity distinction", () => {
  const { passed, rejected } = screenCatalogForAgent("agent-1", [
    candidate({ ticker: "MICRO", marketCap: 200_000_000, avgDollarVolume: 3_000_000 }),
    candidate({ ticker: "SMALL", marketCap: 500_000_000, avgDollarVolume: 3_000_000 }),
  ]);
  assert.deepEqual(passed.map((row) => row.ticker), ["MICRO"]);
  assert.equal(rejected[0].ticker, "SMALL");
  assert.equal(rejected[0].reasonCode, "avg_dollar_volume_below_floor");
});

test("Agent Two deterministically enforces its no-microcap and liquidity catalog gates", () => {
  const { passed, rejected } = screenCatalogForAgent("agent-2", [
    candidate({ ticker: "PASS", marketCap: 300_000_000, avgDollarVolume: 10_000_000 }),
    candidate({ ticker: "MICRO", marketCap: 299_999_999 }),
    candidate({ ticker: "ILLIQ", avgDollarVolume: 9_999_999 }),
  ]);
  assert.deepEqual(passed.map((row) => row.ticker), ["PASS"]);
  assert.deepEqual(rejected.map((row) => row.reasonCode), ["market_cap_below_floor", "avg_dollar_volume_below_floor"]);
});

test("Agent Three requires supported liquidity but does not invent a hard market-cap threshold", () => {
  const { passed, rejected } = screenCatalogForAgent("agent-3", [
    candidate({ ticker: "NOCAP", marketCap: null }),
    candidate({ ticker: "NOADDV", avgDollarVolume: null }),
  ]);
  assert.deepEqual(passed.map((row) => row.ticker), ["NOCAP"]);
  assert.equal(rejected[0].reasonCode, "avg_dollar_volume_unavailable");
});

test("missing critical catalog facts fail closed with stable reason codes", () => {
  assert.equal(
    screenCatalogForAgent("agent-1", [candidate({ marketCap: null })]).rejected[0].reasonCode,
    "market_cap_unavailable"
  );
  assert.equal(
    screenCatalogForAgent("agent-2", [candidate({ avgDollarVolume: null })]).rejected[0].reasonCode,
    "avg_dollar_volume_unavailable"
  );
  assert.equal(
    screenCatalogForAgent("agent-3", [candidate({ avgDollarVolume: null })]).rejected[0].reasonCode,
    "avg_dollar_volume_unavailable"
  );
});

test("a financial-services company cannot be described as Agent One technology because of a sub-vertical label", () => {
  const dave = candidate({
    ticker: "DAVE",
    sector: "Financial Services",
    industry: "Banks - Regional",
    // This is an old convenience label, not admissible classification evidence.
    subVertical: "Tech-Adjacent High-Growth",
  });

  assert.deepEqual(observedBusinessFamily(dave), {
    family: "financial_services",
    sourceFields: ["sector", "industry"],
  });
  const result = evaluateMandateBusinessEligibility({
    agentId: "agent-1",
    candidate: dave,
    claimedBusinessFamily: "technology",
  });
  assert.equal(result.eligible, false);
  assert.equal(result.reasonCode, "business_family_claim_mismatch");
  assert.equal(result.classification.family, "financial_services");
});

test("the sector-agnostic mandates retain eligible discovery for every observed business family", () => {
  const bank = candidate({ ticker: "BANK", sector: "Financial Services", industry: "Banks - Regional" });
  const software = candidate({ ticker: "SOFT", sector: "Technology", industry: "Software - Application" });

  for (const agentId of ["agent-1", "agent-2", "agent-3"]) {
    const bankResult = evaluateMandateBusinessEligibility({ agentId, candidate: bank });
    assert.equal(bankResult.eligible, true, `${agentId} bank discovery`);
    assert.equal(bankResult.reasonCode, "business_family_observed");

    const softwareResult = evaluateMandateBusinessEligibility({
      agentId,
      candidate: software,
      claimedBusinessFamily: "technology",
    });
    assert.equal(softwareResult.eligible, true, `${agentId} technology claim`);
    assert.equal(softwareResult.classification.family, "technology");
  }
});

test("a business-family claim fails closed when classification evidence is absent", () => {
  const result = evaluateMandateBusinessEligibility({
    agentId: "agent-2",
    candidate: candidate({ sector: null, industry: null }),
    claimedBusinessFamily: "technology",
  });
  assert.equal(result.eligible, false);
  assert.equal(result.reasonCode, "business_family_unverifiable");
});
