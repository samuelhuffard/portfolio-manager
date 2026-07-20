import { mandatePolicyFor } from "../config/agents/mandate-policy.js";
import { atr, macd, relativeStrength } from "./indicators.js";

const DAY_MS = 86_400_000;
const QUARTER_SESSIONS = 63;

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function mean(values) {
  return values.length && values.every(finite)
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
}

function instant(value) {
  if (value == null) return null;
  const parsed = Date.parse(value instanceof Date ? value.toISOString() : String(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function fresh(value, source, observedAt, retrievedAt) {
  return { value, state: "fresh", source, observedAt, retrievedAt };
}

function sourced(value, state, source, observedAt, retrievedAt) {
  return { value, state, source, observedAt, retrievedAt };
}

function unavailable(source, asOf) {
  return { value: null, state: "unavailable", source, observedAt: asOf, retrievedAt: asOf };
}

function latestSessionAt(bars) {
  return instant(bars.at(-1)?.date);
}

export function holdingMarketSeriesIsFresh(bars, asOf, maxAgeDays = 4) {
  const sessionAt = latestSessionAt(Array.isArray(bars) ? bars : []);
  const ageMs = Date.parse(asOf ?? "") - Date.parse(sessionAt ?? "");
  return Boolean(sessionAt)
    && Number.isInteger(maxAgeDays)
    && maxAgeDays >= 0
    && ageMs >= 0
    && ageMs <= maxAgeDays * DAY_MS;
}

function simpleMovingAverage(closes, period) {
  return closes.length >= period ? mean(closes.slice(-period)) : null;
}

function consecutiveClosesBelowMovingAverage(closes, period) {
  if (closes.length < period) return null;
  let count = 0;
  for (let index = closes.length - 1; index >= period - 1; index--) {
    const average = mean(closes.slice(index - period + 1, index + 1));
    if (average == null || !finite(closes[index])) return null;
    if (closes[index] >= average) break;
    count += 1;
  }
  return count;
}

function tradingSessionsSince(bars, openedAt) {
  const openedMs = Date.parse(openedAt ?? "");
  if (!Number.isFinite(openedMs)) return null;
  const sessions = bars.filter((bar) => {
    const date = Date.parse(instant(bar?.date) ?? "");
    return Number.isFinite(date) && date > openedMs;
  }).length;
  return sessions;
}

function atrDistanceFrom20SessionClosingHigh(bars) {
  if (bars.length < 20) return null;
  const closes = bars.map((bar) => Number(bar.close));
  if (!closes.every(finite)) return null;
  const atrValue = atr(bars, 14);
  if (!finite(atrValue) || atrValue <= 0) return null;
  const high20 = Math.max(...closes.slice(-20));
  return Math.max(0, (high20 - closes.at(-1)) / atrValue);
}

function relativeStrengthState(bars, benchmarkBars) {
  const result = relativeStrength(
    bars.map((bar) => bar.close),
    benchmarkBars.map((bar) => bar.close)
  );
  return result && Number.isInteger(result.consecutiveDecliningWeeks) ? result : null;
}

function momentumDeteriorating(bars, relativeStrengthResult) {
  const closes = bars.map((bar) => bar.close);
  const macdResult = macd(closes);
  if (!macdResult && !relativeStrengthResult) return null;
  return macdResult?.bearishCrossoverConfirmed === true
    || relativeStrengthResult?.consecutiveDecliningWeeks >= 3;
}

function consecutiveUnderperformingQuarters(bars, benchmarkBars) {
  const length = Math.min(bars.length, benchmarkBars.length);
  if (length < QUARTER_SESSIONS + 1) return null;
  const name = bars.slice(-length).map((bar) => bar.close);
  const benchmark = benchmarkBars.slice(-length).map((bar) => bar.close);
  if (![...name, ...benchmark].every(finite)) return null;
  let count = 0;
  for (
    let end = length - 1;
    end - QUARTER_SESSIONS >= 0;
    end -= QUARTER_SESSIONS
  ) {
    const start = end - QUARTER_SESSIONS;
    if (name[start] <= 0 || benchmark[start] <= 0) return null;
    const nameReturn = name[end] / name[start] - 1;
    const benchmarkReturn = benchmark[end] / benchmark[start] - 1;
    if (nameReturn > benchmarkReturn) break;
    count += 1;
  }
  return count;
}

function nextEarningsInstant(fundamentals) {
  const date = fundamentals?.nextEarningsDate;
  return date ? instant(`${date}T20:00:00.000Z`) : null;
}

function businessDaysUntil(from, to) {
  const start = new Date(`${from.slice(0, 10)}T00:00:00.000Z`);
  const end = new Date(`${to.slice(0, 10)}T00:00:00.000Z`);
  if (start > end) return null;
  let days = 0;
  for (let cursor = new Date(start.getTime() + DAY_MS); cursor <= end; cursor = new Date(cursor.getTime() + DAY_MS)) {
    const weekday = cursor.getUTCDay();
    if (weekday !== 0 && weekday !== 6) days += 1;
  }
  return days;
}

function addIfKnown(evidence, evidenceId, value, source, observedAt, asOf, state = "fresh") {
  evidence[evidenceId] = value == null
    ? unavailable(source, asOf)
    : sourced(value, state, source, observedAt, asOf);
}

/**
 * Build the same provenance-bearing holding evidence contract for every
 * specialist. The adapter never substitutes a nearby metric: unsupported
 * mandate facts remain explicit `unavailable` records and therefore fail
 * closed in `evaluateMandateHolding`.
 */
export function buildLiveHoldingMandateEvidence({
  agentId,
  position,
  bars = [],
  benchmarkBars = [],
  fundamentals = null,
  portfolioValue = null,
  portfolioValueAsOf = null,
  asOf,
} = {}) {
  const policy = mandatePolicyFor(agentId);
  const evidence = Object.fromEntries(
    policy.holdingEvidence.map((evidenceId) => [
      evidenceId,
      unavailable("live_holding_adapter.unavailable", asOf),
    ])
  );
  const sessionAt = latestSessionAt(bars);
  const marketState = holdingMarketSeriesIsFresh(bars, asOf) ? "fresh" : "stale";
  const benchmarkAt = latestSessionAt(benchmarkBars);
  const benchmarkAgeMs = Date.parse(asOf) - Date.parse(benchmarkAt ?? "");
  const relativeMarketState = marketState === "fresh"
    && benchmarkAgeMs >= 0
    && benchmarkAgeMs <= 4 * DAY_MS
    ? "fresh"
    : "stale";

  evidence.lastCompletedSessionAt = sessionAt
    ? sourced(sessionAt, marketState, "yahoo.daily_bars", sessionAt, asOf)
    : unavailable("yahoo.daily_bars", asOf);
  evidence.lastDailyMonitorAt = fresh(asOf, "exit_monitor.current_run", asOf, asOf);
  // The current research ledger proves a scan occurred, not that a full
  // mandate rescore or post-earnings re-underwrite completed. Those cadence
  // facts stay unavailable until durable typed receipts exist.

  const closes = bars.map((bar) => bar.close);
  const relativeStrengthResult = relativeStrengthState(bars, benchmarkBars);
  const nextEarningsAt = nextEarningsInstant(fundamentals);

  if (agentId === "agent-1") {
    addIfKnown(
      evidence,
      "atrFrom20SessionHigh",
      atrDistanceFrom20SessionClosingHigh(bars),
      "yahoo.daily_bars",
      sessionAt ?? asOf,
      asOf,
      marketState
    );
    addIfKnown(
      evidence,
      "relativeStrengthBroken",
      relativeStrengthResult == null ? null : relativeStrengthResult.consecutiveDecliningWeeks >= 3,
      "yahoo.daily_bars+sector_benchmark",
      sessionAt ?? asOf,
      asOf,
      relativeMarketState
    );
    const momentum = momentumDeteriorating(bars, relativeStrengthResult);
    addIfKnown(
      evidence,
      "momentumDeteriorationTrigger",
      momentum === true ? true : null,
      "yahoo.daily_bars+sector_benchmark",
      sessionAt ?? asOf,
      asOf,
      relativeMarketState
    );
    addIfKnown(
      evidence,
      "tradingDaysSinceEntry",
      tradingSessionsSince(bars, position?.firstOpenAt),
      "signed_open_lot+yahoo.daily_bars",
      sessionAt ?? asOf,
      asOf,
      marketState
    );
    const catalystWithinWindow = nextEarningsAt
      ? Date.parse(nextEarningsAt) >= Date.parse(asOf)
        && businessDaysUntil(asOf, nextEarningsAt) <= 10
      : null;
    addIfKnown(
      evidence,
      "datedCatalystWithin10TradingDays",
      catalystWithinWindow,
      "yahoo.calendar_events",
      asOf,
      asOf
    );
  } else if (agentId === "agent-2") {
    addIfKnown(
      evidence,
      "consecutiveClosesBelow50Day",
      consecutiveClosesBelowMovingAverage(closes, 50),
      "yahoo.daily_bars",
      sessionAt ?? asOf,
      asOf,
      marketState
    );
    addIfKnown(
      evidence,
      "relativeStrengthDecliningWeeks",
      relativeStrengthResult?.consecutiveDecliningWeeks ?? null,
      "yahoo.daily_bars+spy",
      sessionAt ?? asOf,
      asOf,
      relativeMarketState
    );
    const average200 = simpleMovingAverage(closes, 200);
    addIfKnown(
      evidence,
      "priceBelow200DayAverage",
      average200 == null || !finite(closes.at(-1)) ? null : closes.at(-1) < average200,
      "yahoo.daily_bars",
      sessionAt ?? asOf,
      asOf,
      marketState
    );
    addIfKnown(
      evidence,
      "quartersFlatOrUnderperformingSpy",
      consecutiveUnderperformingQuarters(bars, benchmarkBars),
      "yahoo.daily_bars+spy",
      sessionAt ?? asOf,
      asOf,
      relativeMarketState
    );
    addIfKnown(
      evidence,
      "datedCatalystPresent",
      nextEarningsAt ? Date.parse(nextEarningsAt) >= Date.parse(asOf) : null,
      "yahoo.calendar_events",
      asOf,
      asOf
    );
  } else {
    // A signed lot proves ownership and entry date, not that a current-policy
    // annual re-underwrite occurred. This remains unavailable until a durable
    // re-underwrite receipt exists.
    const portfolioDate = instant(portfolioValueAsOf)?.slice(0, 10) ?? "";
    const sessionDate = sessionAt?.slice(0, 10) ?? "";
    const currentPrice = finite(closes.at(-1)) ? closes.at(-1) : null;
    addIfKnown(
      evidence,
      "currentWeightPct",
      finite(position?.shares) && finite(currentPrice) && finite(portfolioValue)
        && portfolioValue > 0 && portfolioDate === sessionDate
        ? ((position.shares * currentPrice) / portfolioValue) * 100
        : null,
      "signed_open_lot+yahoo.daily_bars+signed_performance",
      sessionAt ?? asOf,
      asOf,
      marketState
    );
  }

  return evidence;
}

export function holdingPolicyExitAmount({ evaluation, position, portfolioValue }) {
  if (evaluation?.action === "SELL_FULL") return roundMoney(position?.marketValue);
  if (evaluation?.action !== "SELL_PARTIAL") return null;
  const reasons = new Set(evaluation.reasonCodes ?? []);
  if (evaluation.agentId === "agent-3" && reasons.has("position_drift_above_25_pct")) {
    if (!finite(portfolioValue) || portfolioValue <= 0) return null;
    return roundMoney(position.marketValue - portfolioValue * 0.2);
  }
  if (evaluation.agentId === "agent-2") return roundMoney(position.marketValue * 0.5);
  const reduction = reasons.has("dead_trade_30_day_trim") ? 0.5 : 0.4;
  return roundMoney(position.marketValue * reduction);
}

export function canQueueHoldingPolicyExit(evaluation) {
  return evaluation?.coverageComplete === true
    && ["SELL_FULL", "SELL_PARTIAL"].includes(evaluation?.action);
}

function roundMoney(value) {
  if (!finite(value) || value <= 0) return null;
  return Math.round(value * 100) / 100;
}
