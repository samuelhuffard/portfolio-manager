import { canonicalDecimal, PROPOSAL_INVENTORY } from "./inventory.js";

const NUMERIC_FIELDS = new Set(PROPOSAL_INVENTORY.numericFields);

function canonicalProposalValue(value, field) {
  if (value == null || value === "") return null;
  if (NUMERIC_FIELDS.has(field)) return canonicalDecimal(value);
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

/**
 * Compare the exact proposal fields covered by the parity inventory without
 * returning proposal text, HMACs, or other private values. This makes a repair
 * preview actionable while keeping its output safe for operational logs.
 */
export function summarizeProposalShadowDrift(authoritativeRows, shadowRows) {
  const shadowById = new Map((shadowRows ?? []).map((row) => [String(row.id), row]));
  const fieldCounts = {};
  let missingInShadow = 0;
  let missingInAuthoritative = 0;
  let changedRecords = 0;

  for (const authoritative of authoritativeRows ?? []) {
    const id = String(authoritative.id);
    const shadow = shadowById.get(id);
    if (!shadow) {
      missingInShadow += 1;
      continue;
    }
    shadowById.delete(id);
    const changedFields = PROPOSAL_INVENTORY.fields.filter(
      (field) => canonicalProposalValue(authoritative[field], field) !== canonicalProposalValue(shadow[field], field),
    );
    if (changedFields.length) {
      changedRecords += 1;
      for (const field of changedFields) fieldCounts[field] = (fieldCounts[field] ?? 0) + 1;
    }
  }
  missingInAuthoritative = shadowById.size;

  return {
    authoritativeCount: (authoritativeRows ?? []).length,
    shadowCount: (shadowRows ?? []).length,
    missingInShadow,
    missingInAuthoritative,
    changedRecords,
    fieldCounts: Object.fromEntries(Object.entries(fieldCounts).sort(([a], [b]) => a.localeCompare(b))),
    ok: missingInShadow === 0 && missingInAuthoritative === 0 && changedRecords === 0,
  };
}
