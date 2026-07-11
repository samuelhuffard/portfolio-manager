import test from "node:test";
import assert from "node:assert/strict";
import { BudgetExhaustedError, createResearchRunBudget } from "../lib/ai-budget.js";

test("research budget warns at 80% and blocks calls above its dollar cap", () => {
  const warnings = [];
  const budget = createResearchRunBudget({ env: { RESEARCH_RUN_MAX_USD: "0.10", RESEARCH_GENERATOR_RESERVE_USD: "0.08", RESEARCH_EVALUATOR_OPUS_RESERVE_USD: "0.20", RESEARCH_EVALUATOR_SONNET_RESERVE_USD: "0.04" }, onWarning: (event) => warnings.push(event) });
  budget.reserveGenerator();
  assert.equal(warnings.length, 1);
  assert.throws(() => budget.reserveEvaluator(), BudgetExhaustedError);
});

test("research budget falls back from Opus to Sonnet when only the lower reservation fits", () => {
  const budget = createResearchRunBudget({ env: { RESEARCH_RUN_MAX_USD: "0.10", RESEARCH_GENERATOR_RESERVE_USD: "0.06", RESEARCH_EVALUATOR_OPUS_RESERVE_USD: "0.20", RESEARCH_EVALUATOR_SONNET_RESERVE_USD: "0.04" } });
  budget.reserveGenerator();
  assert.equal(budget.reserveEvaluator(), "sonnet");
  assert.deepEqual(budget.snapshot(), { reservedUsd: 0.1, maxUsd: 0.1, warnPct: 0.8, warned: true });
});
