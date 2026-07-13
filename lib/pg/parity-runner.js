import { compareParity, renderParityReport } from "./parity.js";
import {
  buildInventory,
  CAPITAL_ENTRY_INVENTORY,
  LOT_INVENTORY,
  POSITION_INVENTORY,
  PROPOSAL_INVENTORY,
} from "./inventory.js";
import { pgConfigured, pgQuery } from "./client.js";

/** Rows appended to Holdings for display/provenance are not broker positions. */
export function isHoldingMarkerRow(row) {
  const ticker = String(row?.[0] ?? "").trim();
  return (
    !ticker ||
    ticker === "Cash" ||
    /^last synced\b/i.test(ticker) ||
    /^synced via robinhood agentic mcp\b/i.test(ticker) ||
    ticker.startsWith("⚠️")
  );
}

async function pgRows(sql) {
  try {
    return (await pgQuery(sql)).rows;
  } catch (error) {
    return { error: error.message };
  }
}

export async function gatherPostgresShadow() {
  if (!pgConfigured()) return { error: "DATABASE_URL not set" };
  const [proposalRows, positionRows, lotRows, capitalRows] = await Promise.all([
    pgRows(`SELECT id, agent_id::text AS "agentId", ticker, side::text AS side,
                   amount_dollars AS "amountDollars", max_price AS "maxPrice", rationale, risk_summary AS "riskSummary",
                   status, decided_at AS "decidedAt", decided_by_user_id AS "decidedByUserId",
                   decision_note AS "decisionNote", decision_hmac AS "decisionHmac",
                   fulfilled_at AS "fulfilledAt", fulfilled_order_id AS "fulfilledOrderId",
                   fulfilled_shares AS "fulfilledShares", updated_at AS "updatedAt"
              FROM proposals`),
    pgRows(`SELECT ticker, name, shares, avg_cost AS "avgCost", cost_basis AS "costBasis", market_value AS "marketValue" FROM positions`),
    pgRows(`SELECT lot_id AS "lotId", ticker, COALESCE(owner_agent_id::text, 'unattributed') AS "agentId",
                   open_date::text AS "openDate", cost_per_share AS "costPerShare", shares_original AS "sharesOriginal",
                   shares_open AS "sharesOpen", status FROM lots`),
    pgRows(`SELECT c.entry_id AS "entryId", c.entry_date::text AS date, i.email, i.name, c.type,
                   c.amount, c.nav_per_unit AS "navPerUnit", c.units, c.investor_id AS "investorId", c.row_hmac AS "rowHmac"
              FROM capital_entries c JOIN investors i ON i.investor_id = c.investor_id`),
  ]);
  return {
    proposals: Array.isArray(proposalRows) ? buildInventory(proposalRows, PROPOSAL_INVENTORY) : proposalRows,
    capital_entries: Array.isArray(capitalRows) ? buildInventory(capitalRows, CAPITAL_ENTRY_INVENTORY) : capitalRows,
    lots: Array.isArray(lotRows) ? buildInventory(lotRows, LOT_INVENTORY) : lotRows,
    positions: Array.isArray(positionRows) ? buildInventory(positionRows, POSITION_INVENTORY) : positionRows,
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
    const { getServiceAccountClients, resolveSharedSpreadsheetId, readAllLots, readInvestorLedger } = await import("../sheets.js");
    const { sheets, drive } = getServiceAccountClients();
    const spreadsheetId = await resolveSharedSpreadsheetId(sheets, drive);
    const [lots, capitalEntries, holdingsResponse] = await Promise.all([
      readAllLots(sheets, spreadsheetId),
      readInvestorLedger(sheets, spreadsheetId),
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
      .filter((row) => !isHoldingMarkerRow(row))
      .map((row) => ({
        ticker: String(row[0]).trim().toUpperCase(),
        name: row[1] == null ? undefined : String(row[1]),
        shares: Number(row[2]),
        avgCost: Number(row[3]),
        marketValue: row[5] === "" || row[5] == null ? null : Number(row[5]),
        costBasis: Number(row[6]),
      }));
    out.positions = buildInventory(positions, POSITION_INVENTORY);
  } catch (error) {
    for (const key of ["lots", "capital_entries", "positions"]) {
      if (!out[key]) out[key] = { error: error.message };
    }
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

/** Missing/unreadable stores are divergences, never an empty successful sample. */
export async function runParityCheck() {
  const [authoritative, postgres] = await Promise.all([gatherAuthoritativeState(), gatherPostgresShadow()]);
  const comparison = failClosedOnReadErrors(compareParity(authoritative, postgres), authoritative, postgres);
  return {
    ...comparison,
    authoritative,
    postgres,
    report: renderParityReport(comparison),
  };
}
