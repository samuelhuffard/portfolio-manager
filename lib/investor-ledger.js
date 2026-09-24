import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export function normalizeEmail(email) {
  return String(email ?? "").trim().toLowerCase();
}

export function defaultInvestorId(email) {
  return `email:${normalizeEmail(email)}`;
}

export function getInvestorLedgerSecret() {
  const secret = process.env.INVESTOR_LEDGER_HMAC_SECRET?.trim() || process.env.AUDIT_HMAC_SECRET?.trim();
  if (!secret && process.env.ALLOW_UNSIGNED_INVESTOR_LEDGER !== "true") {
    throw new Error("INVESTOR_LEDGER_HMAC_SECRET is required to record investor ledger entries.");
  }
  return secret || null;
}

function stableJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
    .join(",")}}`;
}

export function computeInvestorLedgerHmac(entry, secret) {
  if (!secret) return null;
  const canonical = {
    amount: entry.amount,
    date: entry.date,
    email: normalizeEmail(entry.email),
    entryId: entry.entryId,
    investorId: entry.investorId,
    name: entry.name,
    navPerUnit: entry.navPerUnit,
    type: entry.type,
    units: entry.units,
  };
  return createHmac("sha256", secret).update(stableJson(canonical)).digest("hex");
}

/**
 * Verify one entry's investor-ledger signature. Needed where an entry arrives
 * from a store signed with a DIFFERENT key — the withdrawal recovery plan is
 * signed with the operational-ledger secret, and holding that signature must
 * never imply authority to append an arbitrary row to the investor ledger.
 */
export function investorLedgerEntryHmacMatches(entry, secret = getInvestorLedgerSecret()) {
  if (!entry?.rowHmac || !secret) return false;
  const expectedHex = computeInvestorLedgerHmac(entry, secret);
  if (!expectedHex) return false;
  const expected = Buffer.from(expectedHex, "hex");
  const provided = Buffer.from(String(entry.rowHmac), "hex");
  return provided.length === expected.length && provided.length > 0 && timingSafeEqual(provided, expected);
}

export function assertInvestorLedgerEntries(entries, secret = getInvestorLedgerSecret()) {
  let unsigned = 0;
  let mismatched = 0;
  for (const entry of entries) {
    if (!entry.rowHmac) {
      unsigned += 1;
      continue;
    }
    const expected = Buffer.from(computeInvestorLedgerHmac(entry, secret), "hex");
    const provided = Buffer.from(String(entry.rowHmac), "hex");
    if (provided.length !== expected.length || provided.length === 0 || !timingSafeEqual(provided, expected)) mismatched += 1;
  }
  if (unsigned || mismatched) {
    throw new Error(`investor ledger integrity check failed: ${unsigned} unsigned, ${mismatched} mismatched row(s).`);
  }
  return entries;
}

export function buildInvestorLedgerEntry(input, secret) {
  const entry = {
    date: input.date,
    email: normalizeEmail(input.email),
    name: String(input.name ?? "").trim(),
    type: input.type,
    amount: input.amount,
    navPerUnit: input.navPerUnit,
    units: input.units,
    investorId: String(input.investorId || defaultInvestorId(input.email)).trim(),
    entryId: input.entryId || randomUUID(),
    rowHmac: null,
  };
  return { ...entry, rowHmac: computeInvestorLedgerHmac(entry, secret) };
}

export function investorLedgerRow(entry) {
  return [
    entry.date,
    entry.email,
    entry.name,
    entry.type,
    entry.amount,
    entry.navPerUnit,
    entry.units,
    entry.investorId ?? defaultInvestorId(entry.email),
    entry.entryId ?? "",
    entry.rowHmac ?? "",
  ];
}

export function parseInvestorLedgerRow(row) {
  const email = normalizeEmail(row[1] ?? "");
  return {
    date: row[0],
    email,
    name: row[2] ?? "",
    type: row[3] ?? "",
    amount: row[4] != null && row[4] !== "" ? Number(row[4]) : 0,
    navPerUnit: row[5] != null && row[5] !== "" ? Number(row[5]) : null,
    units: row[6] != null && row[6] !== "" ? Number(row[6]) : 0,
    investorId: row[7] || defaultInvestorId(email),
    entryId: row[8] || null,
    rowHmac: row[9] || null,
  };
}

export function getTodayInNewYork(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function round4(value) {
  return Math.round(value * 10000) / 10000;
}

export const UNATTRIBUTED_TOLERANCE = 1;

/**
 * Capital that has reached the broker but has not yet been assigned in the
 * signed investor ledger. Cost basis, not market value, keeps gains/losses
 * out of the detection calculation.
 */
export function computeUnattributedCapital(holdings, cash, ledger) {
  const costBasisTotal = holdings.reduce((sum, holding) => sum + (Number.isFinite(holding.costBasis) ? holding.costBasis : 0), 0);
  const capitalIn = (Number.isFinite(cash) ? cash : 0) + costBasisTotal;
  const contributions = ledger.filter((entry) => entry.type === "Contribution").reduce((sum, entry) => sum + entry.amount, 0);
  const withdrawals = ledger.filter((entry) => entry.type === "Withdrawal").reduce((sum, entry) => sum + entry.amount, 0);
  const netContributions = contributions - withdrawals;
  const amount = Math.round((capitalIn - netContributions) * 100) / 100;
  return { amount, capitalIn, netContributions, detected: amount > UNATTRIBUTED_TOLERANCE };
}

/**
 * The system-wide investor-identity predicate. Exported so every caller that
 * sums an investor's units reuses THIS definition rather than growing a second
 * copy that can drift from the ceiling check.
 *
 * Behaviour, stated exactly: a matching stable `investorId` matches, AND a
 * matching email matches *regardless of investorId*. It is NOT "stable ID
 * first, email only as a fallback" — an entry carrying a DIFFERENT populated
 * investorId still matches on email alone.
 *
 * The email arm cannot simply be dropped: rows predating stable Clerk IDs carry
 * a derived `email:` id, so requiring agreement would stop matching them and
 * silently understate a real balance. The pooling risk that creates is handled
 * where it matters instead — calculateInvestorLedgerEntry REFUSES when the
 * matched rows carry two different STABLE identities, rather than summing them.
 */
export function entryMatchesInvestor(entry, { investorId, email }) {
  if (investorId && entry.investorId === investorId) return true;
  return normalizeEmail(entry.email) === normalizeEmail(email);
}

export function calculateInvestorLedgerEntry({
  agentId,
  ledger,
  performanceHistory,
  email,
  name,
  amount,
  isWithdrawal = false,
  isSeedOwner = false,
  investorId,
  isExistingCapitalAttribution = false,
  existingCapitalNavPerUnit = null,
  pricingNavPerUnit = null,
  entryId = null,
  now = new Date(),
  secret = null,
}) {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Amount must be a positive number.");

  const resolvedInvestorId = String(investorId || defaultInvestorId(email)).trim();
  const unitsOutstandingBefore = ledger.reduce((sum, entry) => sum + entry.units, 0);
  let navPerUnit;
  let seeded = false;

  if (unitsOutstandingBefore <= 0) {
    if (!isSeedOwner && !isExistingCapitalAttribution) {
      const existingValue = performanceHistory[performanceHistory.length - 1]?.portfolioValue ?? 0;
      if (existingValue > 1) {
        throw new Error(
          `[${agentId}] This agent already holds $${existingValue.toFixed(2)} of value with no investor ledger yet. Record the true owner first with --seed-owner.`
        );
      }
    }
    navPerUnit = 1;
    seeded = true;
  } else if (isExistingCapitalAttribution) {
    if (!Number.isFinite(existingCapitalNavPerUnit) || existingCapitalNavPerUnit <= 0) {
      throw new Error(`[${agentId}] Existing-capital attribution requires a positive contribution-basis NAV per unit.`);
    }
    navPerUnit = existingCapitalNavPerUnit;
  } else if (pricingNavPerUnit != null) {
    if (!Number.isFinite(pricingNavPerUnit) || pricingNavPerUnit <= 0) {
      throw new Error(`[${agentId}] A ${isWithdrawal ? "withdrawal" : "new-cash contribution"} requires a positive signed NAV per unit.`);
    }
    navPerUnit = pricingNavPerUnit;
  } else {
    throw new Error(`[${agentId}] Existing investor entries require an explicit signed pricing NAV per unit.`);
  }

  // Round BEFORE the ceiling check, not after. The persisted row stores
  // round4(units), so checking the raw quotient can pass while the value
  // actually written is larger — burning fractionally more than the investor
  // holds and leaving a negative residue.
  const units = round4((isWithdrawal ? -1 : 1) * (amount / navPerUnit));
  const matchedEntries = ledger.filter((entry) => entryMatchesInvestor(entry, { investorId: resolvedInvestorId, email }));

  // entryMatchesInvestor matches on email even when stable IDs differ, so two
  // investors sharing an email address would silently pool their units and each
  // could withdraw against the other's balance. Re-scoping the predicate would
  // break legitimate withdrawals whose historical rows carry a derived ID, so
  // instead: detect the ambiguity and refuse. A single-identity ledger — every
  // matched row agreeing on its investor ID, or carrying none — is unaffected.
  // `email:<addr>` is what parseInvestorLedgerRow synthesises for a row with a
  // blank investor-ID column. It is the ABSENCE of a stable identity, not a
  // competing one — treating it as a conflict would refuse every withdrawal on
  // a ledger containing pre-Clerk rows.
  const conflictingIds = [...new Set(matchedEntries
    .map((entry) => String(entry.investorId ?? "").trim())
    .filter(Boolean)
    .filter((id) => id !== resolvedInvestorId && !id.startsWith("email:")))];
  if (conflictingIds.length) {
    throw new Error(
      `[${agentId}] Email ${normalizeEmail(email)} resolves to more than one investor identity (${resolvedInvestorId}, ${conflictingIds.join(", ")}). `
      + "Refusing to pool their units — pass the correct --investor-id, and never reuse an email across investors."
    );
  }

  const existingInvestorUnits = matchedEntries.reduce((sum, entry) => sum + entry.units, 0);

  if (isWithdrawal && Math.abs(units) > existingInvestorUnits + 1e-6) {
    throw new Error(
      `[${agentId}] Investor only holds ${existingInvestorUnits.toFixed(4)} units (~$${(existingInvestorUnits * navPerUnit).toFixed(2)}) and cannot withdraw $${amount}.`
    );
  }

  const entry = buildInvestorLedgerEntry(
    {
      date: getTodayInNewYork(now),
      email,
      name,
      type: isWithdrawal ? "Withdrawal" : "Contribution",
      amount,
      navPerUnit: round4(navPerUnit),
      units: round4(units),
      investorId: resolvedInvestorId,
      entryId: entryId ?? undefined,
    },
    secret
  );

  const unitsOutstandingAfter = unitsOutstandingBefore + units;
  const investorUnitsAfter = existingInvestorUnits + units;
  const ownershipPct = unitsOutstandingAfter > 0 ? (investorUnitsAfter / unitsOutstandingAfter) * 100 : 0;

  return {
    entry,
    navPerUnit,
    seeded,
    units,
    unitsOutstandingAfter,
    investorUnitsAfter,
    ownershipPct,
  };
}
