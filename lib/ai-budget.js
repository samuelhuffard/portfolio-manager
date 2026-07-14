export class BudgetExhaustedError extends Error {
  constructor(message) {
    super(message);
    this.name = "BudgetExhaustedError";
    this.code = "budget_exhausted";
  }
}

function positive(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function createResearchRunBudget({ env = process.env, onWarning = null } = {}) {
  const maxUsd = positive(env.RESEARCH_RUN_MAX_USD, 3);
  const warnPct = Math.min(1, positive(env.RESEARCH_RUN_WARN_PCT, 0.8));
  // Reserve defaults sized from measured production spend (2026-07 usage records:
  // generator ~$0.009/call avg, Opus evaluator ~$0.024/call) with ~3x headroom for
  // cache-miss worst cases. The old 0.06/0.20 reserves were 6-8x actuals and made
  // runs exhaust the budget on paper while spending ~$0.35 real.
  const reserves = {
    generator: positive(env.RESEARCH_GENERATOR_RESERVE_USD, 0.03),
    evaluatorOpus: positive(env.RESEARCH_EVALUATOR_OPUS_RESERVE_USD, 0.1),
    evaluatorSonnet: positive(env.RESEARCH_EVALUATOR_SONNET_RESERVE_USD, 0.02),
  };
  // Proposal-impacting judgment is quality-first. A cheaper evaluator is only
  // permitted when an operator explicitly opts in; otherwise an unavailable
  // Opus reservation blocks the review and the caller records a real failure.
  const allowEvaluatorFallback = String(env.RESEARCH_ALLOW_EVALUATOR_FALLBACK ?? "").trim().toLowerCase() === "true";
  let reservedUsd = 0;
  let warned = false;
  const reserve = (role, amount) => {
    if (reservedUsd + amount > maxUsd + 1e-9) {
      throw new BudgetExhaustedError(`research run budget exhausted before ${role}: reserved $${reservedUsd.toFixed(2)} of $${maxUsd.toFixed(2)}.`);
    }
    reservedUsd += amount;
    if (!warned && reservedUsd + 1e-9 >= maxUsd * warnPct) {
      warned = true;
      onWarning?.({ reservedUsd, maxUsd, warnPct, role });
    }
  };
  return {
    reserveGenerator() { reserve("generator", reserves.generator); },
    reserveEvaluator() {
      if (reservedUsd + reserves.evaluatorOpus <= maxUsd + 1e-9) {
        reserve("evaluator-opus", reserves.evaluatorOpus);
        return "opus";
      }
      if (allowEvaluatorFallback && reservedUsd + reserves.evaluatorSonnet <= maxUsd + 1e-9) {
        reserve("evaluator-sonnet-fallback", reserves.evaluatorSonnet);
        return "sonnet";
      }
      throw new BudgetExhaustedError(`research run budget exhausted before evaluator: reserved $${reservedUsd.toFixed(2)} of $${maxUsd.toFixed(2)}.`);
    },
    snapshot() { return { reservedUsd, maxUsd, warnPct, warned, allowEvaluatorFallback }; },
  };
}
