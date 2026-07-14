// Dual-write parity comparison (ADR 0001, migration step 3). During the shadow
// period, Sheets/Redis stay authoritative and Postgres is a shadow copy; this
// compares the two so any divergence is caught BEFORE canonical reads move to
// Postgres. Pure comparator (testable) + a runner (scripts/db-parity.mjs).
//
// The exit gate is "30 calendar days with zero unexplained differences", so this
// is meant to run daily and its output tracked.

const DEFAULT_TOLERANCE = 0.005; // half a cent — money sums must match to the penny

function nearlyEqual(a, b, tol = DEFAULT_TOLERANCE) {
  if (a == null || b == null) return a === b;
  return Math.abs(Number(a) - Number(b)) <= tol;
}

/**
 * Compare two snapshots keyed by object type. Each snapshot value is
 * `{ count, ...metrics }`. Returns a structured report; `ok` is true only when
 * every metric matches (numbers use penny tolerance, strings such as inventory
 * digests require exact equality).
 *
 * @param {Record<string, {count:number, sum?:number}>} sheets  authoritative side
 * @param {Record<string, {count:number, sum?:number}>} postgres shadow side
 */
export function compareParity(sheets, postgres) {
  const keys = [...new Set([...Object.keys(sheets ?? {}), ...Object.keys(postgres ?? {})])].sort();
  const divergences = [];
  const matched = [];

  for (const key of keys) {
    const a = sheets?.[key];
    const b = postgres?.[key];
    if (!a || !b) {
      divergences.push({ key, reason: !a ? "missing on sheets side" : "missing on postgres side", sheets: a ?? null, postgres: b ?? null });
      continue;
    }
    const metrics = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    const mismatch = metrics.find((metric) => {
      const left = a[metric];
      const right = b[metric];
      return typeof left === "number" && typeof right === "number"
        ? !nearlyEqual(left, right)
        : left !== right;
    });
    if (!mismatch) {
      matched.push(key);
    } else {
      divergences.push({
        key,
        reason: `${mismatch} ${a[mismatch]} vs ${b[mismatch]}`,
        sheets: a,
        postgres: b,
      });
    }
  }

  return { ok: divergences.length === 0, matched, divergences, comparedAt: new Date().toISOString() };
}

function present(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validInventory(value) {
  return Number.isInteger(value?.count) && value.count >= 0 && present(value?.digest);
}

function validTimestamp(value) {
  return present(value) && Number.isFinite(Date.parse(value));
}

/**
 * Compare replaceable quote-derived valuation state without conflating it with
 * transactional position truth. An exact comparison is meaningful only when
 * both projections identify the same versioned quote snapshot, source, and
 * source timestamp. Storage write times are deliberately not quote timestamps.
 */
export function comparePositionValuation(authoritative, postgres) {
  if (authoritative?.error || postgres?.error) {
    return {
      status: "UNREADABLE",
      comparable: false,
      reason: authoritative?.error
        ? `authoritative valuation read failed: ${authoritative.error}`
        : `postgres valuation read failed: ${postgres.error}`,
      authoritative: authoritative ?? null,
      postgres: postgres ?? null,
    };
  }
  if (!validInventory(authoritative?.inventory) || !validInventory(postgres?.inventory)) {
    return {
      status: "UNREADABLE",
      comparable: false,
      reason: "valuation inventory unavailable or invalid",
      authoritative: authoritative ?? null,
      postgres: postgres ?? null,
    };
  }

  const required = ["quoteSnapshotVersion", "quoteSource", "quoteTimestamp"];
  const missing = required.filter((field) => !present(authoritative?.[field]) || !present(postgres?.[field]));
  if (missing.length) {
    return {
      status: "NON_COMPARABLE",
      comparable: false,
      reason: `versioned quote provenance unavailable (${missing.join(", ")})`,
      authoritative: authoritative ?? null,
      postgres: postgres ?? null,
    };
  }
  if (!validTimestamp(authoritative.quoteTimestamp) || !validTimestamp(postgres.quoteTimestamp)) {
    return {
      status: "NON_COMPARABLE",
      comparable: false,
      reason: "quote source timestamp is invalid",
      authoritative,
      postgres,
    };
  }

  if (
    authoritative.quoteSnapshotVersion !== postgres.quoteSnapshotVersion
    || authoritative.quoteSource !== postgres.quoteSource
  ) {
    return {
      status: "PROVENANCE_MISMATCH",
      comparable: false,
      reason: "quote snapshot version/source differ",
      authoritative,
      postgres,
    };
  }

  if (authoritative.quoteTimestamp !== postgres.quoteTimestamp) {
    return {
      status: "FRESHNESS_MISMATCH",
      comparable: false,
      reason: "quote source timestamps differ",
      authoritative,
      postgres,
    };
  }

  const exact = authoritative.inventory?.count === postgres.inventory?.count
    && authoritative.inventory?.digest === postgres.inventory?.digest;
  return {
    status: exact ? "EXACT_MATCH" : "VALUE_MISMATCH",
    comparable: true,
    reason: exact ? "same quote snapshot and exact valuation inventory" : "same quote snapshot but valuation inventory differs",
    authoritative,
    postgres,
  };
}

/** One-line-per-key human report for the daily log / Telegram. */
export function renderParityReport(result) {
  const scope = result.valuation ? "transactional parity" : "parity";
  const lines = [`Dual-write ${scope} @ ${result.comparedAt}: ${result.ok ? "MATCH" : "DIVERGENCE"}`];
  for (const key of result.matched) lines.push(`  ✓ ${key}`);
  for (const d of result.divergences) lines.push(`  ✗ ${d.key}: ${d.reason}`);
  if (result.valuation) {
    const marker = result.valuation.status === "EXACT_MATCH" ? "✓" : result.valuation.status === "VALUE_MISMATCH" ? "✗" : "•";
    lines.push(`  ${marker} positions valuation: ${result.valuation.status} — ${result.valuation.reason}`);
  }
  return lines.join("\n");
}
