import { createHmac, timingSafeEqual } from "node:crypto";

const FIELDS = {
  performance: ["date", "portfolioValue", "spyPrice", "unitsOutstanding", "navPerUnit"],
  trade: ["date", "ticker", "side", "shares", "price", "amount", "orderId", "agentId", "proposalId", "realizedGain"],
  lot: ["lotId", "ticker", "openDate", "agentId", "costPerShare", "sharesOriginal", "sharesOpen", "status"],
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

export function computeOperationalLedgerHmac(kind, entry, secret) {
  const fields = FIELDS[kind];
  if (!fields) throw new Error(`Unknown operational ledger kind: ${kind}`);
  const canonical = Object.fromEntries(fields.map((field) => [field, entry[field] ?? null]));
  return createHmac("sha256", secret).update(stableJson({ kind, ...canonical })).digest("hex");
}

export function signOperationalLedgerEntry(kind, entry, secret = getOperationalLedgerSecret()) {
  return { ...entry, rowHmac: computeOperationalLedgerHmac(kind, entry, secret) };
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
    const expected = computeOperationalLedgerHmac(kind, entry, secret);
    if (hmacsEqual(expected, entry.rowHmac)) verified += 1;
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
