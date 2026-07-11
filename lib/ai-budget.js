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
  const maxUsd = positive(env.RESEARCH_RUN_MAX_USD, 2);
  const warnPct = Math.min(1, positive(env.RESEARCH_RUN_WARN_PCT, 0.8));
  const reserves = {
    generator: positive(env.RESEARCH_GENERATOR_RESERVE_USD, 0.06),
    evaluatorOpus: positive(env.RESEARCH_EVALUATOR_OPUS_RESERVE_USD, 0.2),
    evaluatorSonnet: positive(env.RESEARCH_EVALUATOR_SONNET_RESERVE_USD, 0.04),
  };
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
      if (reservedUsd + reserves.evaluatorSonnet <= maxUsd + 1e-9) {
        reserve("evaluator-sonnet-fallback", reserves.evaluatorSonnet);
        return "sonnet";
      }
      throw new BudgetExhaustedError(`research run budget exhausted before evaluator: reserved $${reservedUsd.toFixed(2)} of $${maxUsd.toFixed(2)}.`);
    },
    snapshot() { return { reservedUsd, maxUsd, warnPct, warned }; },
  };
}
