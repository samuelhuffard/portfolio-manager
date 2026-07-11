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

function entryMatchesInvestor(entry, { investorId, email }) {
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
  navDate,
  allowStaleNav = false,
  isExistingCapitalAttribution = false,
  existingCapitalNavPerUnit = null,
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
  } else {
    const latest = performanceHistory[performanceHistory.length - 1];
    if (!latest?.portfolioValue) {
      throw new Error(`[${agentId}] No Performance history with a portfolio value yet. Run holdings-sync first.`);
    }

    const requiredDate = navDate || getTodayInNewYork(now);
    if (!allowStaleNav && latest.date !== requiredDate) {
      throw new Error(
        `[${agentId}] Latest NAV is dated ${latest.date || "unknown"}, but this entry requires ${requiredDate}. Run holdings-sync first, pass --nav-date=${latest.date}, or pass --allow-stale-nav.`
      );
    }
    if (navDate && latest.date !== navDate) {
      throw new Error(`[${agentId}] Requested NAV date ${navDate}, but latest Performance row is ${latest.date || "unknown"}.`);
    }

    navPerUnit = latest.navPerUnit != null ? latest.navPerUnit : latest.portfolioValue / unitsOutstandingBefore;
  }

  const units = (isWithdrawal ? -1 : 1) * (amount / navPerUnit);
  const existingInvestorUnits = ledger
    .filter((entry) => entryMatchesInvestor(entry, { investorId: resolvedInvestorId, email }))
    .reduce((sum, entry) => sum + entry.units, 0);

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
