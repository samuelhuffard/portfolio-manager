import { projectAgentOwnedHoldings } from "./research-holding-ownership.js";

export const SPECIALIST_HOLDING_AGENT_IDS = Object.freeze(["agent-1", "agent-2", "agent-3"]);

export function specialistExitPolicyMode(agentId) {
  return agentId === "agent-1" ? "agent_one_atr_intraday" : "quote_surveillance_only";
}

export function initializeSpecialistHoldingCoverage(ownership) {
  const quarantined = Array.isArray(ownership?.quarantined) ? ownership.quarantined.length : 0;
  return {
    monitored: 0,
    degraded: 0,
    failed: quarantined,
    reasons: quarantined
      ? { unsupported_or_unattributed_holding_owner: quarantined }
      : {},
  };
}

function round(value, places = 8) {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

/**
 * Convert the verified open-lot book into strategy-owned monitor positions.
 *
 * `projectAgentOwnedHoldings` first reconciles the complete lot book to the
 * aggregate Holdings snapshot. This wrapper then flattens all three specialist
 * projections and preserves unsupported/unattributed lots as explicit
 * quarantine rows so a monitor can never silently skip real account exposure.
 */
export function projectSpecialistMonitorHoldings({
  holdings = [],
  lots = [],
  agentIds = SPECIALIST_HOLDING_AGENT_IDS,
} = {}) {
  const projections = agentIds.map((agentId) =>
    projectAgentOwnedHoldings({ agentId, lots, holdings })
  );
  const firstOpenByOwnerTicker = new Map();
  for (const lot of lots) {
    if (lot?.status !== "OPEN" || Number(lot?.sharesOpen) <= 0 || !supportedAgent(agentIds, lot?.agentId)) continue;
    const ticker = String(lot?.ticker ?? "").trim().toUpperCase();
    const key = `${lot.agentId}:${ticker}`;
    const instant = openDateInstant(lot.openDate);
    const prior = firstOpenByOwnerTicker.get(key);
    if (instant && (!prior || Date.parse(instant) < Date.parse(prior))) firstOpenByOwnerTicker.set(key, instant);
  }
  const positions = projections.flatMap((projection) =>
    projection.positions.map((position) => ({
      ...position,
      agentId: projection.agentId,
      firstOpenAt: firstOpenByOwnerTicker.get(`${projection.agentId}:${position.ticker}`) ?? null,
    }))
  );

  const holdingByTicker = new Map(
    holdings.map((holding) => [String(holding?.ticker ?? "").trim().toUpperCase(), holding])
  );
  const supported = new Set(agentIds);
  const quarantinedByOwnerTicker = new Map();
  for (const lot of lots) {
    if (lot?.status !== "OPEN" || Number(lot?.sharesOpen) <= 0 || supported.has(lot?.agentId)) continue;
    const ticker = String(lot?.ticker ?? "").trim().toUpperCase();
    const owner = String(lot?.agentId ?? "unattributed").trim() || "unattributed";
    const key = `${owner}:${ticker}`;
    const row = quarantinedByOwnerTicker.get(key) ?? { agentId: owner, ticker, shares: 0, marketValue: 0 };
    row.shares += Number(lot.sharesOpen);
    quarantinedByOwnerTicker.set(key, row);
  }

  const quarantined = [...quarantinedByOwnerTicker.values()]
    .map((row) => {
      const aggregate = holdingByTicker.get(row.ticker);
      const price = aggregate?.shares > 0 ? aggregate.marketValue / aggregate.shares : null;
      if (!Number.isFinite(price) || price < 0) {
        throw new Error(`holding_ownership_invalid: ${row.ticker} cannot value quarantined open lots`);
      }
      return {
        ...row,
        shares: round(row.shares),
        marketValue: round(row.shares * price, 2),
      };
    })
    .sort((left, right) =>
      left.agentId.localeCompare(right.agentId) || left.ticker.localeCompare(right.ticker)
    );

  return {
    positions: positions.sort((left, right) =>
      left.agentId.localeCompare(right.agentId) || left.ticker.localeCompare(right.ticker)
    ),
    quarantined,
  };
}

function supportedAgent(agentIds, agentId) {
  return agentIds.includes(agentId);
}

function openDateInstant(value) {
  if (value === "legacy") return null;
  const parsed = Date.parse(String(value ?? ""));
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString();
}
