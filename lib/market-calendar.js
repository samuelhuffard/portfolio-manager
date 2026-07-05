// US equity market (NYSE/Nasdaq) holiday calendar, computed — not a static
// list that goes stale. Full-day closures only; early-close half days (day
// after Thanksgiving, Christmas Eve) count as trading days here.
//
// Born from a real incident: July 4th 2026 fell on a Saturday, the market
// closed Friday July 3rd, and the scheduler — which only knew Mon–Fri — ran
// the full research scan (21 AI overlay calls) against a closed market.

function ymd(date) {
  return date.toISOString().slice(0, 10);
}

function utcDate(year, month, day) {
  return new Date(Date.UTC(year, month, day));
}

// Meeus/Jones/Butcher Gregorian Easter computus.
export function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3=March, 4=April
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return utcDate(year, month - 1, day);
}

function nthWeekday(year, month, weekday, n) {
  const first = utcDate(year, month, 1);
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  return utcDate(year, month, 1 + offset + (n - 1) * 7);
}

function lastWeekday(year, month, weekday) {
  const last = utcDate(year, month + 1, 0);
  const offset = (last.getUTCDay() - weekday + 7) % 7;
  return utcDate(year, month, last.getUTCDate() - offset);
}

// NYSE observance for fixed-date holidays: Saturday → preceding Friday,
// Sunday → following Monday. Exception: when New Year's Day falls on a
// Saturday, NYSE does NOT observe it on Dec 31 (rule 7.2 keeps the
// observance within the calendar year — e.g. markets were open 2021-12-31).
function observed(date, { skipSaturday = false } = {}) {
  const dow = date.getUTCDay();
  if (dow === 6) return skipSaturday ? null : new Date(date.getTime() - 86400000);
  if (dow === 0) return new Date(date.getTime() + 86400000);
  return date;
}

const cache = new Map();

/** Map of "YYYY-MM-DD" → holiday name for one year. */
export function marketHolidays(year) {
  if (cache.has(year)) return cache.get(year);
  const entries = [
    [observed(utcDate(year, 0, 1), { skipSaturday: true }), "New Year's Day"],
    [nthWeekday(year, 0, 1, 3), "Martin Luther King Jr. Day"],
    [nthWeekday(year, 1, 1, 3), "Washington's Birthday"],
    [new Date(easterSunday(year).getTime() - 2 * 86400000), "Good Friday"],
    [lastWeekday(year, 4, 1), "Memorial Day"],
    [observed(utcDate(year, 5, 19)), "Juneteenth"],
    [observed(utcDate(year, 6, 4)), "Independence Day"],
    [nthWeekday(year, 8, 1, 1), "Labor Day"],
    [nthWeekday(year, 10, 4, 4), "Thanksgiving Day"],
    [observed(utcDate(year, 11, 25)), "Christmas Day"],
  ];
  const map = new Map();
  for (const [date, name] of entries) if (date) map.set(ymd(date), name);
  cache.set(year, map);
  return map;
}

/** Holiday name for an ET calendar date ("YYYY-MM-DD"), or null. */
export function marketHolidayName(dateStr) {
  return marketHolidays(Number(dateStr.slice(0, 4))).get(dateStr) ?? null;
}

export function etDateString(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(now);
}

/** Holiday name if the market is closed today (ET), else null. */
export function marketHolidayNameET(now = new Date()) {
  return marketHolidayName(etDateString(now));
}

/** Weekday AND not a full-day market holiday, for an ET date string. */
export function isTradingDate(dateStr) {
  const dow = utcDate(Number(dateStr.slice(0, 4)), Number(dateStr.slice(5, 7)) - 1, Number(dateStr.slice(8, 10))).getUTCDay();
  if (dow === 0 || dow === 6) return false;
  return marketHolidayName(dateStr) === null;
}
