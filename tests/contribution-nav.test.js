import assert from "node:assert/strict";
import { test } from "node:test";
import { selectContributionNavSnapshot, selectLatestContributionNav, selectPreDepositContributionNav } from "../lib/contribution-nav.js";

const close = (date, overrides = {}) => ({
  date,
  sourceInvocationId: `${date}/16:30`,
  portfolioValue: 1_050,
  unitsOutstanding: 1_000,
  navPerUnit: 1.05,
  ...overrides,
});

test("contribution NAV selects only the signed 16:30 ET close for a requested date", () => {
  const selected = selectContributionNavSnapshot([
    { ...close("2026-09-10"), sourceInvocationId: "2026-09-10/15:00", navPerUnit: 1.01 },
    close("2026-09-10"),
    { ...close("2026-09-10"), sourceInvocationId: "2026-09-10/09:30", navPerUnit: 0.99 },
  ], "2026-09-10");
  assert.equal(selected.navPerUnit, 1.05);
});

test("contribution NAV refuses a day without the 16:30 ET close rather than using another intraday row", () => {
  assert.throws(
    () => selectContributionNavSnapshot([{ ...close("2026-09-10"), sourceInvocationId: "2026-09-10/15:00" }], "2026-09-10"),
    /No signed 16:30 ET Performance snapshot/
  );
});

test("contribution NAV refuses duplicate, invalid, and cross-date close records", () => {
  assert.throws(() => selectContributionNavSnapshot([close("2026-09-10"), close("2026-09-10")], "2026-09-10"), /Multiple signed/);
  assert.throws(() => selectContributionNavSnapshot([close("2026-09-10", { navPerUnit: 0 })], "2026-09-10"), /invalid/);
  assert.throws(() => selectContributionNavSnapshot([close("2026-09-11")], "2026-09-10"), /No signed/);
});

test("new cash uses the latest eligible prior-day close, never same-day or another intraday row", () => {
  const selected = selectPreDepositContributionNav([
    close("2026-09-08", { navPerUnit: 1 }),
    { ...close("2026-09-08"), sourceInvocationId: "2026-09-08/15:00", navPerUnit: 1.1 },
    close("2026-09-10", { navPerUnit: 1.2 }),
  ], "2026-09-10");
  assert.equal(selected.date, "2026-09-08");
  assert.equal(selected.navPerUnit, 1);
});

test("new cash fails closed when the latest prior Performance date lacks a 16:30 ET close", () => {
  assert.throws(
    () => selectPreDepositContributionNav([{ ...close("2026-09-09"), sourceInvocationId: "2026-09-09/15:00" }, close("2026-09-08")], "2026-09-10"),
    /No signed 16:30 ET Performance snapshot is available for 2026-09-09/
  );
});

test("withdrawal pricing skips a newer intraday-only date and uses the latest signed 16:30 close", () => {
  const history = [
    close("2026-09-08", { navPerUnit: 1 }),
    close("2026-09-09", { navPerUnit: 1.1 }),
    { ...close("2026-09-10"), sourceInvocationId: "2026-09-10/15:00", navPerUnit: 1.2 },
  ];
  assert.equal(selectLatestContributionNav(history).navPerUnit, 1.1);
});

test("withdrawal pricing fails closed for a malformed claimed latest close rather than falling back", () => {
  assert.throws(
    () => selectLatestContributionNav([close("2026-09-09"), close("2026-09-10", { navPerUnit: 0 })]),
    /snapshot for 2026-09-10 is invalid/
  );
});
