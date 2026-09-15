const NAV_SLOT_ET = "16:30";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Return the only signed Performance observation eligible to price a capital
 * contribution for `date`. A contribution is deliberately priced from the
 * latest completed close before its deposit date, so the incoming cash can
 * never contribute to the NAV used to issue its own units.
 *
 * readPerformanceHistory() verifies the row and its source-invocation HMAC
 * before records reach this function. These checks still make this a safe
 * pure boundary for callers/tests and reject ambiguous or incomplete rows.
 */
export function selectContributionNavSnapshot(history, date) {
  const targetDate = String(date ?? "").trim();
  if (!DATE_RE.test(targetDate)) throw new TypeError("Contribution NAV date must be YYYY-MM-DD.");
  if (!Array.isArray(history)) throw new TypeError("Performance history must be an array.");

  const sourceInvocationId = `${targetDate}/${NAV_SLOT_ET}`;
  const matches = history.filter((row) => row?.sourceInvocationId === sourceInvocationId);
  if (matches.length !== 1) {
    throw new Error(
      matches.length === 0
        ? `No signed ${NAV_SLOT_ET} ET Performance snapshot is available for ${targetDate}; refusing to price capital.`
        : `Multiple signed ${NAV_SLOT_ET} ET Performance snapshots exist for ${targetDate}; refusing to choose one.`
    );
  }

  const row = matches[0];
  const navPerUnit = Number(row.navPerUnit);
  const portfolioValue = Number(row.portfolioValue);
  const unitsOutstanding = Number(row.unitsOutstanding);
  if (
    row.date !== targetDate
    || !Number.isFinite(navPerUnit) || navPerUnit <= 0
    || !Number.isFinite(portfolioValue) || portfolioValue <= 0
    || !Number.isFinite(unitsOutstanding) || unitsOutstanding <= 0
  ) {
    throw new Error(`The signed ${NAV_SLOT_ET} ET Performance snapshot for ${targetDate} is invalid; refusing to price capital.`);
  }

  return row;
}

/** Latest eligible close before a deposit date, never an intraday fallback. */
export function selectPreDepositContributionNav(history, depositDate) {
  const targetDate = String(depositDate ?? "").trim();
  if (!DATE_RE.test(targetDate)) throw new TypeError("Deposit date must be YYYY-MM-DD.");
  if (!Array.isArray(history)) throw new TypeError("Performance history must be an array.");

  const priorDates = [...new Set(history
    .map((row) => String(row?.date ?? ""))
    .filter((date) => DATE_RE.test(date) && date < targetDate))]
    .sort((left, right) => right.localeCompare(left));
  if (!priorDates.length) {
    throw new Error("No Performance date strictly before the deposit date is available; refusing to price new cash.");
  }
  return selectContributionNavSnapshot(history, priorDates[0]);
}

/** Latest completed, signed 16:30 ET close. Never price a withdrawal from an intraday row. */
export function selectLatestContributionNav(history) {
  if (!Array.isArray(history)) throw new TypeError("Performance history must be an array.");
  const dates = [...new Set(history
    .map((row) => String(row?.date ?? ""))
    .filter((date) => DATE_RE.test(date)))]
    .sort((left, right) => right.localeCompare(left));
  if (!dates.length) throw new Error("No Performance history is available; refusing to price capital.");
  // A newer intraday observation is normal while today's close has not run. It
  // must not block a withdrawal that can safely use the last completed close.
  // Once a date claims to have a close, however, validate it strictly rather
  // than silently falling back around a duplicate or malformed signed row.
  for (const date of dates) {
    if (history.some((row) => row?.sourceInvocationId === `${date}/${NAV_SLOT_ET}`)) {
      return selectContributionNavSnapshot(history, date);
    }
  }
  throw new Error(`No signed ${NAV_SLOT_ET} ET Performance snapshot is available; refusing to price capital.`);
}

export { NAV_SLOT_ET };
