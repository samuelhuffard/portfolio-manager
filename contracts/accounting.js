// CANONICAL — edit here only. Mirrored to portfolio-dashboard/lib/contracts/ by
// `npm run contracts:sync`; the dashboard's contracts-drift test enforces equality.
//
// Accounting contracts — the NAV/units/cash side of the system, needed to
// complete the Neon schema (ADR 0001) and to give the eventual Postgres
// migration one typed definition of each object instead of Sheet-row + parser +
// per-repo copies. Shapes mirror lib/investor-ledger.js + lib/sheets.js today.

import { z } from "zod";

const Iso = z.string().min(1);
const Money = z.number().finite();
const Ticker = z.string().min(1);

// ── Capital entries (investor ledger) ───────────────────────────────────────
// A contribution or withdrawal of investor capital. Append-only + HMAC-signed
// (lib/investor-ledger.js). These ARE the capital_entries of the double-entry
// cash/units ledger.
export const CAPITAL_ENTRY_TYPES = ["contribution", "withdrawal"];
export const CapitalEntryTypeSchema = z.enum(CAPITAL_ENTRY_TYPES);

export const InvestorLedgerEntrySchema = z.object({
  entryId: z.string().min(1),
  date: Iso,
  email: z.string(), // normalized lowercase
  name: z.string(),
  type: CapitalEntryTypeSchema,
  amount: Money.nonnegative(),        // dollars moved (sign implied by type)
  navPerUnit: Money.positive().nullable(),
  units: Money,                       // units issued (contribution) or redeemed (withdrawal)
  investorId: z.string().min(1),
  rowHmac: z.string().nullable(),     // append-only integrity signature
});

// ── Investors ───────────────────────────────────────────────────────────────
// A distinct capital provider. Derived from the ledger today; a first-class row
// under Postgres.
export const InvestorSchema = z.object({
  investorId: z.string().min(1),
  email: z.string(),
  name: z.string(),
});

// ── Positions ───────────────────────────────────────────────────────────────
// Current holding of a ticker (lib/sheets.js Holdings tab). marketValue is
// nullable because a quote can be missing — the roadmap forbids inferring a held
// position from a missing quote, so null must stay representable.
export const PositionSchema = z.object({
  ticker: Ticker,
  name: z.string().optional(),
  shares: z.number().finite().nonnegative(),
  avgCost: Money.nonnegative(),
  costBasis: Money.nonnegative(),
  marketValue: Money.nullable(),
});

// ── NAV snapshots ───────────────────────────────────────────────────────────
// A point-in-time fund valuation (Performance tab). Enables reproducible
// point-in-time NAV — a Phase 2 exit-gate requirement.
export const NavSnapshotSchema = z.object({
  date: Iso,
  totalValue: Money.nonnegative(),    // NAV
  cash: Money,
  unitsOutstanding: Money.nonnegative(),
  navPerUnit: Money.positive().nullable(),
});

// ── Account ─────────────────────────────────────────────────────────────────
// The single fund account's live rollup. Minimal by design — the authoritative
// numbers derive from the ledgers above; this is the current-state projection.
export const AccountSchema = z.object({
  cash: Money.nonnegative(),
  totalValue: Money.nonnegative(),
  unitsOutstanding: Money.nonnegative(),
  navPerUnit: Money.positive().nullable(),
  updatedAt: Iso,
});

/**
 * @typedef {z.infer<typeof InvestorLedgerEntrySchema>} InvestorLedgerEntry
 * @typedef {z.infer<typeof InvestorSchema>} Investor
 * @typedef {z.infer<typeof PositionSchema>} Position
 * @typedef {z.infer<typeof NavSnapshotSchema>} NavSnapshot
 * @typedef {z.infer<typeof AccountSchema>} Account
 */
