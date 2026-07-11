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

/** One-line-per-key human report for the daily log / Telegram. */
export function renderParityReport(result) {
  const lines = [`Dual-write parity @ ${result.comparedAt}: ${result.ok ? "MATCH" : "DIVERGENCE"}`];
  for (const key of result.matched) lines.push(`  ✓ ${key}`);
  for (const d of result.divergences) lines.push(`  ✗ ${d.key}: ${d.reason}`);
  return lines.join("\n");
}
