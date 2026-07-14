import { compareParity, comparePositionValuation, renderParityReport } from "./parity.js";
import {
  ACCOUNTING_SNAPSHOT_INVENTORY,
  buildInventory,
  CAPITAL_ENTRY_INVENTORY,
  LOT_INVENTORY,
  POSITION_TRANSACTIONAL_INVENTORY,
  POSITION_VALUATION_INVENTORY,
  PROPOSAL_INVENTORY,
} from "./inventory.js";
import { pgConfigured, pgQuery } from "./client.js";
import { isSecurityHoldingRow } from "../holdings-rows.js";
export { isHoldingMarkerRow, isSecurityHoldingRow } from "../holdings-rows.js";

const DECIMAL_TEXT_RE = /^[+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?$/;

function isFiniteDecimalInput(value) {
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") return DECIMAL_TEXT_RE.test(value.trim());
  return false;
}

export function holdingsRowToParityPosition(row) {
  return {
    ticker: String(row[0]).trim().toUpperCase(),
    name: row[1] == null ? undefined : String(row[1]),
    // Keep decimal strings intact for buildInventory's schema-scale decimal
    // canonicalizer. Number(...) here used to collapse distinct NUMERIC(18,8)
    // values before the parity digest could see them.
    shares: row[2],
    avgCost: row[3],
    marketValue: row[5] === "" || row[5] == null ? null : row[5],
    costBasis: row[6],
  };
}

async function pgRows(sql) {
  try {
    return (await pgQuery(sql)).rows;
  } catch (error) {
    return { error: error.message };
  }
}

export function positionValuationState(rows, quoteSnapshot = null) {
  if (!Array.isArray(rows)) return rows;
  let provenance = quoteSnapshot;
  if (!provenance && rows.length > 0) {
    const variants = new Map();
    for (const row of rows) {
      const timestamp = row.quoteTimestamp instanceof Date
        ? row.quoteTimestamp.toISOString()
        : row.quoteTimestamp == null
          ? null
          : Number.isFinite(Date.parse(row.quoteTimestamp))
            ? new Date(row.quoteTimestamp).toISOString()
            : String(row.quoteTimestamp);
      const value = {
        quoteSnapshotVersion: row.quoteSnapshotVersion ?? null,
        quoteSource: row.quoteSource ?? null,
        quoteTimestamp: timestamp,
      };
      variants.set(JSON.stringify(value), value);
    }
    if (variants.size !== 1) return { error: "Postgres positions contain mixed quote provenance" };
    provenance = [...variants.values()][0];
  }
  return {
    inventory: buildInventory(rows, POSITION_VALUATION_INVENTORY),
    quoteSnapshotVersion: provenance?.quoteSnapshotVersion ?? null,
    quoteSource: provenance?.quoteSource ?? null,
    quoteTimestamp: provenance?.quoteTimestamp ?? null,
  };
}

export async function gatherPostgresShadow() {
  if (!pgConfigured()) return { error: "DATABASE_URL not set" };
  const [proposalRows, positionRows, lotRows, capitalRows, accountingRows] = await Promise.all([
    pgRows(`SELECT id, agent_id::text AS "agentId", ticker, side::text AS side,
                   amount_dollars AS "amountDollars", max_price AS "maxPrice", rationale, risk_summary AS "riskSummary",
                   status, decided_at AS "decidedAt", decided_by_user_id AS "decidedByUserId",
                   decision_note AS "decisionNote", decision_hmac AS "decisionHmac",
                   fulfilled_at AS "fulfilledAt", fulfilled_order_id AS "fulfilledOrderId",
                   fulfilled_shares AS "fulfilledShares", updated_at AS "updatedAt"
              FROM proposals`),
    pgRows(`SELECT ticker, name, shares, avg_cost AS "avgCost", cost_basis AS "costBasis", market_value AS "marketValue",
                   quote_snapshot_version AS "quoteSnapshotVersion", quote_source AS "quoteSource",
                   quote_timestamp AS "quoteTimestamp" FROM positions`),
    pgRows(`SELECT lot_id AS "lotId", ticker, COALESCE(owner_agent_id::text, 'unattributed') AS "agentId",
                   open_date::text AS "openDate", cost_per_share AS "costPerShare", shares_original AS "sharesOriginal",
                   shares_open AS "sharesOpen", status FROM lots`),
    pgRows(`SELECT c.entry_id AS "entryId", c.entry_date::text AS date, i.email, i.name, c.type,
                   c.amount, c.nav_per_unit AS "navPerUnit", c.units, c.investor_id AS "investorId", c.row_hmac AS "rowHmac"
              FROM capital_entries c JOIN investors i ON i.investor_id = c.investor_id`),
    pgRows(`SELECT snapshot_date::text AS date, total_value AS "totalValue", cash,
                   units_outstanding AS "unitsOutstanding", nav_per_unit AS "navPerUnit"
              FROM nav_snapshots ORDER BY snapshot_date DESC, id DESC LIMIT 1`),
  ]);
  return {
    proposals: Array.isArray(proposalRows) ? buildInventory(proposalRows, PROPOSAL_INVENTORY) : proposalRows,
    capital_entries: Array.isArray(capitalRows) ? buildInventory(capitalRows, CAPITAL_ENTRY_INVENTORY) : capitalRows,
    lots: Array.isArray(lotRows) ? buildInventory(lotRows, LOT_INVENTORY) : lotRows,
    positions: Array.isArray(positionRows) ? buildInventory(positionRows, POSITION_TRANSACTIONAL_INVENTORY) : positionRows,
    accounting_snapshot: Array.isArray(accountingRows) && accountingRows.length > 0
      ? buildInventory(accountingRows, ACCOUNTING_SNAPSHOT_INVENTORY)
      : { error: Array.isArray(accountingRows) ? "Postgres accounting snapshot unavailable" : accountingRows?.error ?? "Postgres accounting snapshot unreadable" },
    valuation: {
      positions: positionValuationState(positionRows),
    },
  };
}

export async function gatherAuthoritativeState() {
  const out = {};
  try {
    const { listAllProposals } = await import("../redis.js");
    const proposals = await listAllProposals();
    if (Array.isArray(proposals)) out.proposals = buildInventory(proposals, PROPOSAL_INVENTORY);
    else out.proposals = { error: "Redis proposal list unavailable" };
  } catch (error) {
    out.proposals = { error: error.message };
  }

  try {
    const {
      getServiceAccountClients,
      parseHoldingsQuoteSnapshot,
      resolveSharedSpreadsheetId,
      readAllLots,
      readInvestorLedger,
      readPerformanceHistory,
    } = await import("../sheets.js");
    const { sheets, drive } = getServiceAccountClients();
    const spreadsheetId = await resolveSharedSpreadsheetId(sheets, drive);
    const [lots, capitalEntries, performanceHistory, holdingsResponse] = await Promise.all([
      readAllLots(sheets, spreadsheetId),
      readInvestorLedger(sheets, spreadsheetId),
      readPerformanceHistory(sheets, spreadsheetId),
      sheets.spreadsheets.values.get({ spreadsheetId, range: "Holdings!A2:G", valueRenderOption: "UNFORMATTED_VALUE" }),
    ]);
    out.lots = buildInventory(lots, LOT_INVENTORY);
    const normalizedCapitalEntries = capitalEntries.map((entry) => {
      const legacyType = String(entry?.type ?? "").trim().toLowerCase();
      return legacyType
        ? { ...entry, type: legacyType === "correction" ? "contribution" : legacyType }
        : entry;
    });
    out.capital_entries = buildInventory(normalizedCapitalEntries, CAPITAL_ENTRY_INVENTORY);
    const positions = (holdingsResponse.data.values || [])
      .filter((row) => isSecurityHoldingRow(row))
      .map(holdingsRowToParityPosition);
    out.positions = buildInventory(positions, POSITION_TRANSACTIONAL_INVENTORY);
    const latestPerformance = performanceHistory.at(-1);
    const cashRow = (holdingsResponse.data.values || []).find((row) => /^cash$/i.test(String(row?.[0] ?? "").trim()));
    const cash = cashRow?.[5] === "" || cashRow?.[5] == null ? null : cashRow[5];
    if (!latestPerformance || latestPerformance.portfolioValue == null || !isFiniteDecimalInput(cash)) {
      out.accounting_snapshot = { error: "Latest signed Performance row or Holdings cash is unavailable" };
    } else {
      out.accounting_snapshot = buildInventory([{
        date: latestPerformance.date,
        totalValue: latestPerformance.portfolioValue,
        cash,
        unitsOutstanding: latestPerformance.unitsOutstanding ?? 0,
        navPerUnit: latestPerformance.navPerUnit,
      }], ACCOUNTING_SNAPSHOT_INVENTORY);
    }
    out.valuation = {
      positions: positionValuationState(positions, parseHoldingsQuoteSnapshot(holdingsResponse.data.values || [])),
    };
  } catch (error) {
    for (const key of ["lots", "capital_entries", "positions", "accounting_snapshot"]) {
      if (!out[key]) out[key] = { error: error.message };
    }
    if (!out.valuation) out.valuation = { positions: { error: error.message } };
  }
  return out;
}

export function failClosedOnReadErrors(comparison, authoritative, postgres) {
  const readFailures = [];
  for (const [side, snapshot] of [["authoritative", authoritative], ["postgres", postgres]]) {
    for (const [key, value] of Object.entries(snapshot)) {
      if (value?.error) readFailures.push({ key, reason: `${side} read failed: ${value.error}`, sheets: null, postgres: null });
    }
  }
  if (readFailures.length) {
    comparison.ok = false;
    comparison.matched = comparison.matched.filter((key) => !readFailures.some((failure) => failure.key === key));
    comparison.divergences.push(...readFailures);
  }
  return comparison;
}

export function applyPositionValuationComparison(comparison, valuation) {
  // A mismatch from the *same identified quote snapshot* is a real shadow
  // projection divergence. Missing/different quote provenance remains visible
  // but cannot honestly be classified as accounting divergence.
  if (valuation.status === "VALUE_MISMATCH" || valuation.status === "UNREADABLE") {
    comparison.ok = false;
    comparison.divergences.push({
      key: "positions_valuation",
      reason: valuation.reason,
      sheets: valuation.authoritative,
      postgres: valuation.postgres,
    });
  }
  comparison.valuation = valuation;
  return comparison;
}

/** Missing/unreadable stores are divergences, never an empty successful sample. */
export async function runParityCheck() {
  const [authoritative, postgres] = await Promise.all([gatherAuthoritativeState(), gatherPostgresShadow()]);
  const { valuation: authoritativeValuation, ...authoritativeParity } = authoritative;
  const { valuation: postgresValuation, ...postgresParity } = postgres;
  const comparison = failClosedOnReadErrors(
    compareParity(authoritativeParity, postgresParity),
    authoritativeParity,
    postgresParity,
  );
  const valuation = comparePositionValuation(
    authoritativeValuation?.positions,
    postgresValuation?.positions,
  );
  applyPositionValuationComparison(comparison, valuation);
  return {
    ...comparison,
    authoritative,
    postgres,
    report: renderParityReport(comparison),
  };
}
