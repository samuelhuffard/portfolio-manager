import { randomUUID } from "node:crypto";
import { estimateAnthropicRequestUpperBound, resolveAnthropicPricingVersion } from "./anthropic-pricing.js";

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

function roundUsd(value) {
  return Number(Number(value).toFixed(12));
}

export function createResearchRunBudget({ env = process.env, onWarning = null, monthlyBudget = null, now = () => new Date() } = {}) {
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
  let committedUsd = 0;
  let warned = false;
  const pendingCallFloors = [];
  const activeReservations = new Map();
  const activeUsd = () => roundUsd([...activeReservations.values()].reduce((sum, entry) => sum + entry.amount, 0));
  const accountedUsd = () => roundUsd(committedUsd + activeUsd());
  const checkWarning = (role) => {
    const reservedUsd = accountedUsd();
    if (!warned && reservedUsd + 1e-9 >= maxUsd * warnPct) {
      warned = true;
      onWarning?.({ reservedUsd, maxUsd, warnPct, role });
    }
  };
  const createActiveReservation = (role, amount) => {
    if (roundUsd(accountedUsd() + amount) > maxUsd) {
      throw new BudgetExhaustedError(`research run budget exhausted before ${role}: accounted $${accountedUsd().toFixed(2)} of $${maxUsd.toFixed(2)}.`);
    }
    const id = randomUUID();
    activeReservations.set(id, { id, role, amount });
    checkWarning(role);
    return id;
  };
  const resizeActiveReservation = (id, role, amount) => {
    const active = activeReservations.get(id);
    if (!active) throw new BudgetExhaustedError(`research run reservation ${id} is missing before ${role}.`);
    const delta = amount - active.amount;
    if (delta > 0 && roundUsd(accountedUsd() + delta) > maxUsd) {
      throw new BudgetExhaustedError(`research run budget exhausted before ${role}: accounted $${accountedUsd().toFixed(2)} of $${maxUsd.toFixed(2)}.`);
    }
    active.amount = amount;
    checkWarning(role);
  };
  const settleActiveReservation = (authorization, disposition, actualUsd = 0) => {
    const id = authorization?.runReservationId;
    const active = id ? activeReservations.get(id) : null;
    if (!active) throw new BudgetExhaustedError("research run reservation is missing or already settled");
    if (disposition === "SUCCESS") {
      const actual = Number(actualUsd);
      if (!Number.isFinite(actual) || actual < 0 || roundUsd(actual) > roundUsd(active.amount)) {
        throw new BudgetExhaustedError(`research run actual cost $${String(actualUsd)} exceeded or invalidated its $${active.amount.toFixed(6)} reservation`);
      }
      committedUsd = roundUsd(committedUsd + actual);
    } else if (disposition === "AMBIGUOUS_FAILURE") {
      committedUsd = roundUsd(committedUsd + active.amount);
    }
    activeReservations.delete(id);
  };
  return {
    reserveGenerator() {
      const id = createActiveReservation("generator", reserves.generator);
      pendingCallFloors.push({ id, role: "generator" });
    },
    reserveEvaluator() {
      if (roundUsd(accountedUsd() + reserves.evaluatorOpus) <= maxUsd) {
        const id = createActiveReservation("evaluator-opus", reserves.evaluatorOpus);
        pendingCallFloors.push({ id, role: "evaluator" });
        return "opus";
      }
      if (allowEvaluatorFallback && roundUsd(accountedUsd() + reserves.evaluatorSonnet) <= maxUsd) {
        const id = createActiveReservation("evaluator-sonnet-fallback", reserves.evaluatorSonnet);
        pendingCallFloors.push({ id, role: "evaluator" });
        return "sonnet";
      }
      throw new BudgetExhaustedError(`research run budget exhausted before evaluator: accounted $${accountedUsd().toFixed(2)} of $${maxUsd.toFixed(2)}.`);
    },
    authorizeAnthropicCall({ role, model, request, reserveUsd = null, protectedCapacity = false }) {
      const normalizedRole = role === "evaluator" ? "evaluator" : "generator";
      const floorIndex = pendingCallFloors.findIndex((entry) => entry.role === normalizedRole);
      let requestBound;
      const authorizationAt = now();
      let pricingVersion;
      try {
        pricingVersion = resolveAnthropicPricingVersion({ env, at: authorizationAt });
        requestBound = estimateAnthropicRequestUpperBound({ model, pricingVersion, request });
        const maxRequestBytes = Math.floor(positive(env.ANTHROPIC_MAX_REQUEST_BYTES, 1_000_000));
        if (requestBound.requestBytes > maxRequestBytes) throw new Error(`request is ${requestBound.requestBytes} bytes, above ${maxRequestBytes}`);
      } catch (error) {
        if (floorIndex >= 0) {
          const [pending] = pendingCallFloors.splice(floorIndex, 1);
          activeReservations.delete(pending.id);
        }
        throw new BudgetExhaustedError(`research run cannot authorize an unbounded Anthropic request: ${error.message}`);
      }
      const pendingFloor = floorIndex >= 0 ? pendingCallFloors.splice(floorIndex, 1)[0] : null;
      const requestReserve = Math.max(Number(reserveUsd) || 0, requestBound.upperBoundUsd);
      const runReservationId = pendingFloor?.id ?? createActiveReservation(`${role}-request-upper-bound`, 0);
      try {
        resizeActiveReservation(runReservationId, `${role}-request-upper-bound`, requestReserve);
      } catch (error) {
        activeReservations.delete(runReservationId);
        throw error;
      }
      if (!monthlyBudget) return Promise.resolve({ configured: false, role, model, reserveUsd: requestReserve, pricingVersion, authorizedAt: new Date(authorizationAt).toISOString(), runReservationId });
      const monthlyReserve = reserveUsd ?? (role === "evaluator"
        ? (model === "claude-sonnet-4-6" ? reserves.evaluatorSonnet : reserves.evaluatorOpus)
        : reserves.generator);
      return monthlyBudget.authorizeCall({ role, model, request, reserveUsd: monthlyReserve, protectedCapacity })
        .then((authorization) => ({ ...authorization, runReservationId }))
        .catch((error) => {
          activeReservations.delete(runReservationId);
          throw error;
        });
    },
    async settleAnthropicCall(authorization, telemetryResult) {
      const record = telemetryResult?.record;
      settleActiveReservation(authorization, "SUCCESS", record?.estimatedCostUsd);
      return monthlyBudget?.settleCall(authorization, telemetryResult) ?? record ?? null;
    },
    async settleAnthropicProviderFailure(authorization, error) {
      const status = Number(error?.status);
      const disposition = Number.isInteger(status) && status >= 400 && status <= 599 ? "PROVIDER_REJECTION" : "AMBIGUOUS_FAILURE";
      settleActiveReservation(authorization, disposition);
      if (monthlyBudget) await monthlyBudget.settleProviderFailure(authorization, error);
      return disposition;
    },
    get requiresTelemetry() { return Boolean(monthlyBudget?.requiresTelemetry); },
    snapshot() { return { reservedUsd: accountedUsd(), maxUsd, warnPct, warned, allowEvaluatorFallback }; },
  };
}
