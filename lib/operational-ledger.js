import { createHmac, timingSafeEqual } from "node:crypto";

const FIELDS = {
  performance: ["date", "portfolioValue", "spyPrice", "unitsOutstanding", "navPerUnit"],
  trade: ["date", "ticker", "side", "shares", "price", "amount", "orderId", "agentId", "proposalId", "realizedGain"],
  lot: ["lotId", "ticker", "openDate", "agentId", "costPerShare", "sharesOriginal", "sharesOpen", "status"],
  // A durable, signed "this fill's lot ledger could not be reconciled" record
  // (Codex re-review): the in-memory needsReconciliation flag is not enough —
  // the state must survive a missed alert and the order-id dedupe on later syncs.
  reconciliation: ["orderId", "proposalId", "ticker", "side", "shares", "reason", "createdAt"],
  reconciliation_resolution: ["orderId", "resolution", "attestedBy", "attestation", "createdAt"],
  legacy_approval_attestation: ["proposalId", "ticker", "side", "attestedBy", "attestation", "createdAt"],
};

function stableJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

export function getOperationalLedgerSecret() {
  const secret = process.env.OPERATIONAL_LEDGER_HMAC_SECRET?.trim()
    || process.env.INVESTOR_LEDGER_HMAC_SECRET?.trim()
    || process.env.AUDIT_HMAC_SECRET?.trim();
  if (!secret) throw new Error("OPERATIONAL_LEDGER_HMAC_SECRET (or an approved fallback signing secret) is required.");
  return secret;
}

/**
 * Signing always uses the primary secret above. Verification accepts any
 * configured secret in the chain so that introducing a dedicated
 * OPERATIONAL_LEDGER_HMAC_SECRET does not invalidate rows historically signed
 * with the investor/audit fallback. Once a dedicated key exists, legacy keys
 * must be listed explicitly in OPERATIONAL_LEDGER_LEGACY_HMAC_SECRETS. Removing
 * that migration-only variable retires their operational signing authority
 * without removing investor/audit keys required by their own subsystems.
 */
export function getOperationalLedgerVerificationSecrets(env = process.env) {
  const dedicated = env.OPERATIONAL_LEDGER_HMAC_SECRET?.trim();
  const explicitLegacy = String(env.OPERATIONAL_LEDGER_LEGACY_HMAC_SECRETS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  // Before the dedicated key is configured, preserve the historical fallback
  // behavior. After cutover, merely having investor/audit keys in the process
  // must not grant them operational-ledger verification authority.
  const compatibilityFallbacks = dedicated
    ? []
    : [env.INVESTOR_LEDGER_HMAC_SECRET, env.AUDIT_HMAC_SECRET];
  const secrets = [dedicated, ...explicitLegacy, ...compatibilityFallbacks]
    .map((value) => value?.trim())
    .filter(Boolean);
  return [...new Set(secrets)];
}

function verificationCandidates(secret) {
  const candidates = [...new Set([...(secret ? [secret] : []), ...getOperationalLedgerVerificationSecrets()])];
  if (!candidates.length) throw new Error("OPERATIONAL_LEDGER_HMAC_SECRET (or an approved fallback signing secret) is required.");
  return candidates;
}

export function operationalLedgerEntryHmacMatches(kind, entry, secret = null) {
  if (!entry?.rowHmac) return false;
  return verificationCandidates(secret)
    .some((candidate) => hmacsEqual(computeOperationalLedgerHmac(kind, entry, candidate), entry.rowHmac));
}

export function computeOperationalLedgerHmac(kind, entry, secret) {
  const fields = FIELDS[kind];
  if (!fields) throw new Error(`Unknown operational ledger kind: ${kind}`);
  const canonical = Object.fromEntries(fields.map((field) => [field, entry[field] ?? null]));
  return createHmac("sha256", secret).update(stableJson({ kind, ...canonical })).digest("hex");
}

export function signOperationalLedgerEntry(kind, entry, secret = getOperationalLedgerSecret()) {
  return { ...entry, rowHmac: computeOperationalLedgerHmac(kind, entry, secret) };
}

// Performance rows predate MCP request ids, so changing the main performance
// HMAC payload would invalidate history. A request id therefore gets its own
// domain-separated HMAC bound to the already-signed money-state row.
export function computePerformanceSourceRequestHmac(entry, secret = getOperationalLedgerSecret()) {
  if (!entry.sourceRequestId) return null;
  return createHmac("sha256", secret)
    .update(stableJson({ kind: "performance-source-request", sourceRequestId: entry.sourceRequestId, rowHmac: entry.rowHmac ?? null }))
    .digest("hex");
}

export function assertPerformanceSourceRequestEntries(entries, secret = getOperationalLedgerSecret()) {
  const candidates = verificationCandidates(secret);
  for (const entry of entries) {
    if (!entry.sourceRequestId && !entry.sourceRequestHmac) continue; // legacy row
    const matches = candidates.some((candidate) =>
      hmacsEqual(computePerformanceSourceRequestHmac(entry, candidate) ?? "", entry.sourceRequestHmac ?? ""));
    if (!matches) {
      throw new Error("performance source-request integrity check failed.");
    }
  }
  return entries;
}

function hmacsEqual(expectedHex, providedHex) {
  const expected = Buffer.from(String(expectedHex), "hex");
  const provided = Buffer.from(String(providedHex), "hex");
  return provided.length === expected.length && provided.length > 0 && timingSafeEqual(provided, expected);
}

export function verifyOperationalLedgerEntries(kind, entries, secret = getOperationalLedgerSecret()) {
  const unsigned = [];
  const mismatched = [];
  let verified = 0;
  for (const entry of entries) {
    if (!entry.rowHmac) {
      unsigned.push(entry);
      continue;
    }
    if (operationalLedgerEntryHmacMatches(kind, entry, secret)) verified += 1;
    else mismatched.push(entry);
  }
  return { total: entries.length, verified, unsigned, mismatched };
}

export function assertOperationalLedgerEntries(kind, entries, secret = getOperationalLedgerSecret()) {
  const result = verifyOperationalLedgerEntries(kind, entries, secret);
  if (result.unsigned.length || result.mismatched.length) {
    throw new Error(
      `${kind} ledger integrity check failed: ${result.unsigned.length} unsigned, ${result.mismatched.length} mismatched row(s).`
    );
  }
  return entries;
}
