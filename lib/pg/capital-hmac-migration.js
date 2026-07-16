import { canonicalDecimal } from "./inventory.js";

const PAYLOAD_FIELDS = Object.freeze([
  "date", "email", "name", "type", "amount", "navPerUnit", "units", "investorId",
]);
const NUMERIC_FIELDS = new Set(["amount", "navPerUnit", "units"]);
const HMAC_RE = /^[a-f0-9]{64}$/i;

function normalizedType(value) {
  const type = String(value ?? "").trim().toLowerCase();
  return type === "correction" ? "contribution" : type;
}

function canonicalValue(field, value) {
  if (value == null || value === "") return null;
  if (field === "type") return normalizedType(value);
  if (field === "email") return String(value).trim().toLowerCase();
  if (NUMERIC_FIELDS.has(field)) return canonicalDecimal(value);
  return String(value);
}

function indexRows(rows, label) {
  if (!Array.isArray(rows)) throw new TypeError(`${label} capital entries must be an array.`);
  const indexed = new Map();
  for (const row of rows) {
    const entryId = String(row?.entryId ?? "").trim();
    if (!entryId) throw new Error(`${label} capital entry is missing entryId.`);
    if (indexed.has(entryId)) throw new Error(`${label} contains duplicate capital entry IDs.`);
    indexed.set(entryId, row);
  }
  return indexed;
}

/**
 * Build a fail-closed migration plan without exposing signature values.
 * HMAC rotation is safe only when the authoritative and shadow ledgers have
 * identical entry sets and identical signed payload fields.
 */
export function planCapitalEntryHmacMigration(authoritativeRows, shadowRows) {
  const authoritative = indexRows(authoritativeRows, "Authoritative");
  const shadow = indexRows(shadowRows, "Postgres shadow");
  const missingFromAuthoritative = [];
  const missingFromShadow = [];
  const payloadMismatches = [];
  const updates = [];
  const invalidAuthoritativeHmacs = [];

  for (const entryId of shadow.keys()) {
    if (!authoritative.has(entryId)) missingFromAuthoritative.push(entryId);
  }
  for (const [entryId, source] of authoritative) {
    const target = shadow.get(entryId);
    if (!target) {
      missingFromShadow.push(entryId);
      continue;
    }
    const differingFields = PAYLOAD_FIELDS.filter(
      (field) => canonicalValue(field, source[field]) !== canonicalValue(field, target[field]),
    );
    if (differingFields.length) {
      payloadMismatches.push({ entryId, fields: differingFields });
      continue;
    }
    const expectedHmac = String(source.rowHmac ?? "").trim();
    const currentHmac = String(target.rowHmac ?? "").trim() || null;
    if (!HMAC_RE.test(expectedHmac)) {
      invalidAuthoritativeHmacs.push(entryId);
      continue;
    }
    if (expectedHmac !== currentHmac) updates.push({ entryId, expectedHmac, currentHmac });
  }

  const safeToApply = missingFromAuthoritative.length === 0
    && missingFromShadow.length === 0
    && payloadMismatches.length === 0
    && invalidAuthoritativeHmacs.length === 0;
  return {
    authoritativeCount: authoritative.size,
    shadowCount: shadow.size,
    updateCount: updates.length,
    safeToApply,
    blockers: {
      missingFromAuthoritative,
      missingFromShadow,
      payloadMismatches,
      invalidAuthoritativeHmacs,
    },
    updates,
  };
}

function safeSummary(plan) {
  return {
    authoritativeCount: plan.authoritativeCount,
    shadowCount: plan.shadowCount,
    updateCount: plan.updateCount,
    safeToApply: plan.safeToApply,
    blockerCounts: {
      missingFromAuthoritative: plan.blockers.missingFromAuthoritative.length,
      missingFromShadow: plan.blockers.missingFromShadow.length,
      payloadMismatches: plan.blockers.payloadMismatches.length,
      invalidAuthoritativeHmacs: plan.blockers.invalidAuthoritativeHmacs.length,
    },
  };
}

/** Update only stale shadow HMAC copies, atomically and with compare-and-swap. */
export async function applyCapitalEntryHmacMigration(plan, { transaction } = {}) {
  if (!plan?.safeToApply) throw new Error(`Capital-entry HMAC migration blocked: ${JSON.stringify(safeSummary(plan))}`);
  if (typeof transaction !== "function") throw new TypeError("A Postgres transaction function is required.");
  if (plan.updateCount === 0) return { ...safeSummary(plan), updated: 0 };

  const updated = await transaction(async (client) => {
    let count = 0;
    for (const change of plan.updates) {
      const result = await client.query(
        `UPDATE capital_entries
            SET row_hmac = $1
          WHERE entry_id = $2
            AND row_hmac IS NOT DISTINCT FROM $3`,
        [change.expectedHmac, change.entryId, change.currentHmac],
      );
      if (result.rowCount !== 1) {
        throw new Error("Capital-entry HMAC compare-and-swap failed; shadow state changed during migration.");
      }
      count += 1;
    }
    return count;
  });
  return { ...safeSummary(plan), updated };
}

export function summarizeCapitalEntryHmacPlan(plan) {
  return safeSummary(plan);
}
