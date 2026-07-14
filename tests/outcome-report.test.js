import test from "node:test";
import assert from "node:assert/strict";
import { biweeklyPeriodId, renderOutcomeReportEmail } from "../lib/outcome-report.js";

test("biweekly period remains stable within the same fourteen-day window", () => {
  assert.equal(biweeklyPeriodId(new Date("2026-07-13T00:00:00Z")), biweeklyPeriodId(new Date("2026-07-17T00:00:00Z")));
});

test("outcome email is aggregate-only and never claims an edge or authorizes a trade", () => {
  const rendered = renderOutcomeReportEmail({ metadata: { asOf: "2026-07-14T00:00:00Z" }, conclusion: "not_assessed", sections: { dataCoverage: { observationCount: 2, outcomeCount: 1, snapshotCount: 1, freshness: "fresh", statusCounts: {} }, evidenceClasses: { shadow: { state: "available", counts: { sample: 1 } } } } }, { periodId: "biweekly-test" });
  assert.match(rendered.text, /not_assessed/);
  assert.match(rendered.text, /does not claim an investment edge/i);
  assert.doesNotMatch(rendered.text, /BUY|SELL|NVDA/);
});
