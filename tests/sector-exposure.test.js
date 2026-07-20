import { test } from "node:test";
import assert from "node:assert/strict";
import { applyRiskChecks } from "../lib/risk-engine.js";
import { resolveSectorExposureKey } from "../lib/sector-exposure.js";

const buy = {
  action: "BUY",
  targetWeight: 10,
  confidence: 0.8,
  risks: ["reimbursement pressure"],
  killCriteria: ["guidance cut"],
};

test("broad-sector candidates use canonical sector and hit the deterministic sector cap", () => {
  const candidate = { ticker: "HEAL", sector: "Healthcare", subVertical: null };
  const sector = resolveSectorExposureKey(candidate);
  const result = applyRiskChecks(
    buy,
    {
      sector,
      currentSectorWeightPct: 55,
      currentPositionWeightPct: 0,
      isHeldAtLoss: false,
      dataStale: false,
    },
    {
      maxPositionPct: 12,
      maxSectorPct: 60,
      minConfidence: 0.55,
      requireBearCase: true,
      prohibitAveragingDown: true,
      blockOnStaleData: true,
    }
  );

  assert.equal(sector, "Healthcare");
  assert.equal(result.action, "HOLD");
  assert.equal(result.ruleChecks.sector_ok, false);
  assert.match(result.overrideNotes.join("; "), /Healthcare/);
});

test("legacy sub-vertical is only a fallback when broad sector is unavailable", () => {
  assert.equal(
    resolveSectorExposureKey({ sector: "Industrials", subVertical: "Tech Hardware" }),
    "Industrials"
  );
  assert.equal(
    resolveSectorExposureKey({ sector: null, subVertical: "Tech Hardware" }),
    "Tech Hardware"
  );
});
