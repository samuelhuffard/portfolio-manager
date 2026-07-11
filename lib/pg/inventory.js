import { createHash } from "node:crypto";

function canonicalValue(value, numeric) {
  if (value == null || value === "") return null;
  if (numeric) {
    const number = Number(value);
    return Number.isFinite(number) ? number : value;
  }
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

/**
 * Stable, key-aware inventory for daily parity. A count alone cannot detect a
 * stale decision or fulfillment update; the digest changes when any selected
 * lifecycle/current-state field changes.
 */
export function buildInventory(rows, { key, fields, numericFields = [] }) {
  const numeric = new Set(numericFields);
  const canonical = [...(rows ?? [])]
    .map((row) => Object.fromEntries(fields.map((field) => [field, canonicalValue(row[field], numeric.has(field))])))
    .sort((a, b) => String(a[key]).localeCompare(String(b[key])));
  return {
    count: canonical.length,
    digest: createHash("sha256").update(JSON.stringify(canonical)).digest("hex"),
  };
}

export const PROPOSAL_INVENTORY = {
  key: "id",
  fields: [
    "id", "agentId", "ticker", "side", "amountDollars", "maxPrice", "rationale", "riskSummary",
    "status", "decidedAt", "decidedByUserId", "decisionNote", "decisionHmac",
    "fulfilledAt", "fulfilledOrderId", "fulfilledShares", "updatedAt",
  ],
  numericFields: ["amountDollars", "maxPrice", "fulfilledShares"],
};

export const POSITION_INVENTORY = {
  key: "ticker",
  fields: ["ticker", "name", "shares", "avgCost", "costBasis", "marketValue"],
  numericFields: ["shares", "avgCost", "costBasis", "marketValue"],
};

export const LOT_INVENTORY = {
  key: "lotId",
  fields: ["lotId", "ticker", "agentId", "openDate", "costPerShare", "sharesOriginal", "sharesOpen", "status"],
  numericFields: ["costPerShare", "sharesOriginal", "sharesOpen"],
};

export const CAPITAL_ENTRY_INVENTORY = {
  key: "entryId",
  fields: ["entryId", "date", "email", "name", "type", "amount", "navPerUnit", "units", "investorId", "rowHmac"],
  numericFields: ["amount", "navPerUnit", "units"],
};
