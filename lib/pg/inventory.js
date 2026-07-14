import { createHash } from "node:crypto";

function incrementDecimalDigits(digits) {
  const chars = digits.split("");
  for (let index = chars.length - 1; index >= 0; index -= 1) {
    if (chars[index] !== "9") {
      chars[index] = String(Number(chars[index]) + 1);
      return chars.join("");
    }
    chars[index] = "0";
  }
  return `1${chars.join("")}`;
}

export function canonicalDecimal(value, precision) {
  const input = typeof value === "string" ? value.trim() : String(value);
  const match = input.match(/^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/);
  if (!match) return input;

  const negative = match[1] === "-";
  const integerDigits = match[2] ?? "0";
  const fractionDigits = match[3] ?? match[4] ?? "";
  const exponent = match[5] == null ? 0 : Number(match[5]);
  // Every financial typmod in this schema is at most 20 digits. The generous
  // bound keeps scientific notation useful without allowing hostile Sheet or
  // Redis text to trigger an enormous string allocation.
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 1_000) return input;

  const digits = `${integerDigits}${fractionDigits}`;
  const decimalIndex = integerDigits.length + exponent;
  let integer;
  let fraction;
  if (decimalIndex <= 0) {
    integer = "0";
    fraction = `${"0".repeat(-decimalIndex)}${digits}`;
  } else if (decimalIndex >= digits.length) {
    integer = `${digits}${"0".repeat(decimalIndex - digits.length)}`;
    fraction = "";
  } else {
    integer = digits.slice(0, decimalIndex);
    fraction = digits.slice(decimalIndex);
  }
  integer = integer.replace(/^0+(?=\d)/, "");

  if (precision == null) {
    fraction = fraction.replace(/0+$/, "");
  } else if (fraction.length <= precision) {
    fraction = fraction.padEnd(precision, "0");
  } else {
    const retained = fraction.slice(0, precision);
    const shouldRound = fraction[precision] >= "5";
    let combined = `${integer}${retained}`;
    if (shouldRound) combined = incrementDecimalDigits(combined);
    const integerLength = Math.max(1, combined.length - precision);
    integer = combined.slice(0, integerLength) || "0";
    fraction = precision === 0 ? "" : combined.slice(integerLength).padStart(precision, "0");
  }

  const zero = /^0+$/.test(integer) && (fraction === "" || /^0+$/.test(fraction));
  return `${negative && !zero ? "-" : ""}${integer}${fraction === "" ? "" : `.${fraction}`}`;
}

function canonicalValue(value, numeric, precision) {
  if (value == null || value === "") return null;
  if (numeric) {
    // Never cross a JavaScript Number boundary here. Postgres returns NUMERIC
    // as exact strings; parsing those values as binary floating point can make
    // two distinct NUMERIC(18,8) values produce the same parity digest.
    return canonicalDecimal(value, precision);
  }
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

/**
 * Stable, key-aware inventory for daily parity. A count alone cannot detect a
 * stale decision or fulfillment update; the digest changes when any selected
 * lifecycle/current-state field changes.
 */
export function buildInventory(rows, { key, fields, numericFields = [], numericPrecisions = {} }) {
  const numeric = new Set(numericFields);
  const canonical = [...(rows ?? [])]
    .map((row) => Object.fromEntries(fields.map((field) => [
      field,
      canonicalValue(row[field], numeric.has(field), numericPrecisions[field]),
    ])))
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

/**
 * Accounting/current-position truth. Quote-derived market value deliberately
 * does not belong in this digest: two otherwise identical stores may have been
 * refreshed from different quote moments.
 */
export const POSITION_TRANSACTIONAL_INVENTORY = {
  key: "ticker",
  fields: ["ticker", "name", "shares", "avgCost", "costBasis"],
  numericFields: ["shares", "avgCost", "costBasis"],
  numericPrecisions: { shares: 8, avgCost: 4, costBasis: 2 },
};

// Compatibility export for callers/tests that used the old name. Its semantics
// are now explicitly transactional.
export const POSITION_INVENTORY = POSITION_TRANSACTIONAL_INVENTORY;

export const POSITION_VALUATION_INVENTORY = {
  key: "ticker",
  fields: ["ticker", "marketValue"],
  numericFields: ["marketValue"],
  numericPrecisions: { marketValue: 2 },
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

/** Latest signed-Sheets accounting projection versus the Postgres shadow. */
export const ACCOUNTING_SNAPSHOT_INVENTORY = {
  key: "date",
  fields: ["date", "totalValue", "cash", "unitsOutstanding", "navPerUnit"],
  numericFields: ["totalValue", "cash", "unitsOutstanding", "navPerUnit"],
  numericPrecisions: { totalValue: 2, cash: 2, unitsOutstanding: 6, navPerUnit: 6 },
};
