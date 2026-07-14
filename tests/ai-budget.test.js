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

test("research budget does not silently downgrade proposal evaluation by default", () => {
  const budget = createResearchRunBudget({ env: { RESEARCH_RUN_MAX_USD: "0.10", RESEARCH_GENERATOR_RESERVE_USD: "0.06", RESEARCH_EVALUATOR_OPUS_RESERVE_USD: "0.20", RESEARCH_EVALUATOR_SONNET_RESERVE_USD: "0.04" } });
  budget.reserveGenerator();
  assert.throws(() => budget.reserveEvaluator(), BudgetExhaustedError);
});

test("an explicit operator opt-in permits the lower-cost evaluator fallback", () => {
  const budget = createResearchRunBudget({ env: { RESEARCH_RUN_MAX_USD: "0.10", RESEARCH_GENERATOR_RESERVE_USD: "0.06", RESEARCH_EVALUATOR_OPUS_RESERVE_USD: "0.20", RESEARCH_EVALUATOR_SONNET_RESERVE_USD: "0.04", RESEARCH_ALLOW_EVALUATOR_FALLBACK: "true" } });
  budget.reserveGenerator();
  assert.equal(budget.reserveEvaluator(), "sonnet");
  assert.deepEqual(budget.snapshot(), { reservedUsd: 0.1, maxUsd: 0.1, warnPct: 0.8, warned: true, allowEvaluatorFallback: true });
});

test("per-run cap reserves the request upper bound even without a monthly ceiling", async () => {
  const request = { model: "claude-opus-4-8", max_tokens: 700, messages: [{ role: "user", content: "test" }] };
  const blocked = createResearchRunBudget({ env: { RESEARCH_RUN_MAX_USD: "0.05", RESEARCH_GENERATOR_RESERVE_USD: "0.01" } });
  blocked.reserveGenerator();
  assert.throws(
    () => blocked.authorizeAnthropicCall({ role: "generator", model: request.model, request }),
    BudgetExhaustedError
  );
  assert.equal(blocked.snapshot().reservedUsd, 0);

  const allowed = createResearchRunBudget({ env: { RESEARCH_RUN_MAX_USD: "0.20", RESEARCH_GENERATOR_RESERVE_USD: "0.01" } });
  allowed.reserveGenerator();
  const auth = await allowed.authorizeAnthropicCall({ role: "generator", model: request.model, request });
  assert.ok(auth.reserveUsd > 0.09);
  assert.equal(allowed.snapshot().reservedUsd, auth.reserveUsd);

  const unbounded = createResearchRunBudget({ env: { RESEARCH_RUN_MAX_USD: "1" } });
  unbounded.reserveGenerator();
  assert.throws(
    () => unbounded.authorizeAnthropicCall({ role: "generator", model: request.model, request: { model: request.model, messages: [] } }),
    /unbounded Anthropic request/
  );
  assert.equal(unbounded.snapshot().reservedUsd, 0);
});

test("36 sequential successful Opus calls settle upper bounds down to actual spend", async () => {
  const budget = createResearchRunBudget({ env: { RESEARCH_RUN_MAX_USD: "3" } });
  const request = { model: "claude-opus-4-8", max_tokens: 700, messages: [{ role: "user", content: "realistic research prompt" }] };
  for (let index = 0; index < 36; index += 1) {
    budget.reserveGenerator();
    const auth = await budget.authorizeAnthropicCall({ role: "generator", model: request.model, request });
    assert.ok(auth.reserveUsd > 0.09);
    await budget.settleAnthropicCall(auth, { persisted: true, record: { estimatedCostUsd: 0.02 } });
  }
  assert.ok(Math.abs(budget.snapshot().reservedUsd - 0.72) < 1e-9);
});

test("run reservations charge ambiguity, release rejection, and reject double settlement", async () => {
  const request = { model: "claude-opus-4-8", max_tokens: 700, messages: [{ role: "user", content: "test" }] };

  const ambiguous = createResearchRunBudget({ env: { RESEARCH_RUN_MAX_USD: "1" } });
  ambiguous.reserveGenerator();
  const ambiguousAuth = await ambiguous.authorizeAnthropicCall({ role: "generator", model: request.model, request });
  await ambiguous.settleAnthropicProviderFailure(ambiguousAuth, new Error("timeout"));
  assert.equal(ambiguous.snapshot().reservedUsd, ambiguousAuth.reserveUsd);
  await assert.rejects(
    () => ambiguous.settleAnthropicProviderFailure(ambiguousAuth, new Error("timeout")),
    /missing or already settled/
  );

  const rejected = createResearchRunBudget({ env: { RESEARCH_RUN_MAX_USD: "1" } });
  rejected.reserveGenerator();
  const rejectedAuth = await rejected.authorizeAnthropicCall({ role: "generator", model: request.model, request });
  await rejected.settleAnthropicProviderFailure(rejectedAuth, Object.assign(new Error("rate limited"), { status: 429 }));
  assert.equal(rejected.snapshot().reservedUsd, 0);

  await assert.rejects(
    () => rejected.settleAnthropicCall({ runReservationId: "missing" }, { persisted: true, record: { estimatedCostUsd: 0.01 } }),
    /missing or already settled/
  );
});
