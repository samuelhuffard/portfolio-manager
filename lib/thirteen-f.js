/**
 * 13F institutional-ownership evidence (mandate v3 §5, categories D).
 *
 * Pure, no I/O. Consumes already-aggregated per-quarter institutional share counts
 * (lib/thirteen-f-dataset.js) plus the company's own period-end share count
 * (CONCEPTS.sharesOutstanding), and emits the named inputs that
 * config/scoring/absolute-thresholds.js `institutionalOwnership` and `thirteenF` read.
 *
 * DECISIONS BOUND HERE (owner sign-off 2026-08-02):
 *
 *  - `ownershipChangePoints` is PERCENTAGE POINTS OF SHARES OUTSTANDING. The band table
 *    (>= 5 full, >= 2 strong, -2..2 neutral) only coheres under that reading: a 5pp
 *    quarterly swing in institutional ownership is rare and signal-bearing, whereas a 5%
 *    change in shares held is routine and would push most of the book into the top band.
 *  - The `thirteenF` table's *ChangePct fields are a DIFFERENT quantity — percent change
 *    in aggregate shares held. Both metrics exist because they answer different
 *    questions; do not collapse them.
 *  - Retention is TWO quarters of change plus the publication lag. Beyond that the
 *    metric reports missing (null) and lib/absolute-rules.js rescales it out. It is
 *    NEVER scored zero: a zero is the "institutions sold" band, and stale data must not
 *    be read as selling.
 *  - Usability keys off ACTUAL DATASET PUBLICATION, not the 45-day statutory due date.
 *    The SEC runs the quarterly 13F data sets after the Feb/May/Aug/Nov month-ends, so a
 *    quarter is routinely past due before it is readable, and counting it as usable
 *    early would silently shorten the history.
 *
 * THE DENOMINATOR HAZARD: ownership percentage is institutional shares / shares
 * outstanding. If those two numbers come from different dates, a buyback shrinking the
 * denominator reads as institutional accumulation. Every percentage below therefore
 * requires a share count matched to that quarter's own period end, and yields null
 * rather than borrowing a neighbouring quarter's figure.
 */

const DAY = 86400000;
const finite = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Two quarters of retained change, plus room for the publication lag. */
export const MAX_QUARTER_AGE_DAYS = 2 * 91 + 45;
/** The rule table never looks past the prior quarter, so two changes is all it can use. */
export const MAX_USABLE_CHANGES = 2;
/** Share count must land on the holdings period end; filings report both at period end. */
const SHARE_COUNT_TOLERANCE_DAYS = 10;

const pctChange = (current, prior) =>
  finite(current) != null && finite(prior) != null && prior > 0 ? ((current - prior) / prior) * 100 : null;

/** Period-end share count for one holdings quarter — never borrowed from another date. */
function sharesOutstandingAt(series = [], periodEnd) {
  const target = Date.parse(periodEnd);
  if (!Number.isFinite(target)) return null;
  let best = null;
  for (const fact of series) {
    const at = Date.parse(fact.end);
    if (!Number.isFinite(at)) continue;
    if (Math.abs(at - target) > SHARE_COUNT_TOLERANCE_DAYS * DAY) continue;
    if (!best || Math.abs(at - target) < Math.abs(Date.parse(best.end) - target)) best = fact;
  }
  return finite(best?.val ?? null);
}

/**
 * @param {object} args
 * @param {{periodEnd:string, publishedAt:string|null, institutionalShares:number}[]} args.quarters
 *        oldest→newest, one row per 13F reporting quarter
 * @param {{end:string,val:number}[]} args.sharesOutstanding  instant series (CONCEPTS.sharesOutstanding)
 * @param {string} args.asOf  chronology cutoff — nothing published after this is visible
 * @returns {{ usableQuarters:number, instOwnershipDir:object|null, thirteenF:object|null,
 *             unavailableReason:string|null, asOf:string|null }}
 */
export function deriveThirteenFEvidence({ quarters = [], sharesOutstanding = [], asOf = null } = {}) {
  const none = (reason) => ({ usableQuarters: 0, instOwnershipDir: null, thirteenF: null, unavailableReason: reason, asOf });

  const cutoff = asOf == null ? null : Date.parse(asOf);
  if (asOf != null && !Number.isFinite(cutoff)) return none("invalid asOf cutoff");

  // Published-on-or-before-asOf only. An unpublished quarter is not merely stale, it is
  // unreadable, and treating it as present would let the score claim history it lacks.
  const visible = quarters
    .filter((q) => q && Number.isFinite(Date.parse(q.periodEnd)) && finite(q.institutionalShares) != null)
    .filter((q) => {
      if (!q.publishedAt) return false;
      const published = Date.parse(q.publishedAt);
      return Number.isFinite(published) && (cutoff == null || published <= cutoff);
    })
    .sort((a, b) => Date.parse(a.periodEnd) - Date.parse(b.periodEnd));

  if (visible.length < 2) return none("fewer than two published 13F quarters");

  const newest = visible[visible.length - 1];
  const referenceDate = cutoff ?? Date.parse(newest.periodEnd);
  const ageDays = (referenceDate - Date.parse(newest.periodEnd)) / DAY;
  if (ageDays > MAX_QUARTER_AGE_DAYS) return none(`newest 13F quarter ${newest.periodEnd} is ${Math.round(ageDays)}d old`);

  // Three holdings points yield two changes; that is the table's ceiling.
  const window = visible.slice(-(MAX_USABLE_CHANGES + 1));
  const latest = window[window.length - 1];
  const prior = window[window.length - 2];
  const twoBack = window.length >= 3 ? window[window.length - 3] : null;

  const latestQuarterChangePct = pctChange(latest.institutionalShares, prior.institutionalShares);
  const priorQuarterChangePct = twoBack ? pctChange(prior.institutionalShares, twoBack.institutionalShares) : null;
  const cumulativeTwoQuarterChangePct = twoBack ? pctChange(latest.institutionalShares, twoBack.institutionalShares) : null;

  const usableQuarters = [latestQuarterChangePct, priorQuarterChangePct].filter((v) => v != null).length;
  if (!usableQuarters) return none("no computable quarter-over-quarter change");

  // --- ownership percentage, strictly date-matched (see THE DENOMINATOR HAZARD above) ---
  const latestShares = sharesOutstandingAt(sharesOutstanding, latest.periodEnd);
  const priorShares = sharesOutstandingAt(sharesOutstanding, prior.periodEnd);
  const latestOwnershipPct = latestShares > 0 ? (latest.institutionalShares / latestShares) * 100 : null;
  const priorOwnershipPct = priorShares > 0 ? (prior.institutionalShares / priorShares) * 100 : null;
  const ownershipChangePoints =
    latestOwnershipPct != null && priorOwnershipPct != null ? latestOwnershipPct - priorOwnershipPct : null;

  // Accumulation must be visible across BOTH retained quarters and clear the same 5-point
  // cumulative bar the thirteenF full-credit band uses; one strong quarter is not a trend.
  const clearMultiQuarterAccumulation =
    latestQuarterChangePct != null && priorQuarterChangePct != null && cumulativeTwoQuarterChangePct != null
      ? latestQuarterChangePct > 0 && priorQuarterChangePct > 0 && cumulativeTwoQuarterChangePct >= 5
      : null;

  const instOwnershipDir = ownershipChangePoints == null && clearMultiQuarterAccumulation == null
    ? null
    : {
        ...(ownershipChangePoints == null ? {} : { ownershipChangePoints }),
        ...(clearMultiQuarterAccumulation == null ? {} : { clearMultiQuarterAccumulation }),
      };

  return {
    usableQuarters,
    instOwnershipDir,
    thirteenF: {
      usableQuarters,
      latestQuarterChangePct,
      ...(priorQuarterChangePct == null ? {} : { priorQuarterChangePct }),
      ...(cumulativeTwoQuarterChangePct == null ? {} : { cumulativeTwoQuarterChangePct }),
    },
    unavailableReason: null,
    asOf,
    // provenance — the mandate requires source + quarter + filing date on delayed evidence
    _latestPeriodEnd: latest.periodEnd,
    _latestPublishedAt: latest.publishedAt,
    _latestOwnershipPct: latestOwnershipPct,
  };
}
