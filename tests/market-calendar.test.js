import { test } from "node:test";
import assert from "node:assert/strict";
import { easterSunday, marketHolidays, marketHolidayName, isTradingDate } from "../lib/market-calendar.js";

test("2026 holiday calendar matches published NYSE schedule", () => {
  const h = marketHolidays(2026);
  assert.equal(h.get("2026-01-01"), "New Year's Day");
  assert.equal(h.get("2026-01-19"), "Martin Luther King Jr. Day");
  assert.equal(h.get("2026-02-16"), "Washington's Birthday");
  assert.equal(h.get("2026-04-03"), "Good Friday"); // Easter 2026-04-05
  assert.equal(h.get("2026-05-25"), "Memorial Day");
  assert.equal(h.get("2026-06-19"), "Juneteenth");
  assert.equal(h.get("2026-07-03"), "Independence Day"); // Jul 4 is a Saturday → observed Friday
  assert.equal(h.get("2026-09-07"), "Labor Day");
  assert.equal(h.get("2026-11-26"), "Thanksgiving Day");
  assert.equal(h.get("2026-12-25"), "Christmas Day");
  assert.equal(h.size, 10);
});

test("the July 3rd 2026 incident date is a holiday, July 6th is a trading day", () => {
  assert.equal(marketHolidayName("2026-07-03"), "Independence Day");
  assert.equal(isTradingDate("2026-07-03"), false);
  assert.equal(isTradingDate("2026-07-04"), false); // Saturday
  assert.equal(isTradingDate("2026-07-06"), true); // Monday
});

test("Easter computus is correct across known years", () => {
  assert.equal(easterSunday(2026).toISOString().slice(0, 10), "2026-04-05");
  assert.equal(easterSunday(2024).toISOString().slice(0, 10), "2024-03-31");
  assert.equal(easterSunday(2027).toISOString().slice(0, 10), "2027-03-28");
});

test("Sunday holidays observe on Monday", () => {
  // July 4th 2027 is a Sunday → observed Monday July 5th.
  assert.equal(marketHolidays(2027).get("2027-07-05"), "Independence Day");
  assert.equal(marketHolidays(2027).has("2027-07-04"), false);
});

test("New Year's on a Saturday is NOT observed the prior Friday (NYSE rule)", () => {
  // Jan 1 2022 was a Saturday; markets were open Friday 2021-12-31.
  assert.equal(marketHolidays(2022).has("2022-01-01"), false);
  assert.equal(marketHolidays(2021).has("2021-12-31"), false);
  assert.equal(isTradingDate("2021-12-31"), true);
});

test("regular weekdays are trading days", () => {
  assert.equal(isTradingDate("2026-07-07"), true);
  assert.equal(isTradingDate("2026-11-27"), true); // day after Thanksgiving: early close, still a trading day
});
