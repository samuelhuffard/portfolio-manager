import { test } from "node:test";
import assert from "node:assert/strict";
import { ownershipEnforcementEnabled } from "../lib/ownership-flag.js";

const saved = process.env.ENFORCE_OWNERSHIP;

test("ownership enforcement is ON by default", () => {
  delete process.env.ENFORCE_OWNERSHIP;
  assert.equal(ownershipEnforcementEnabled(), true);
});

test("ENFORCE_OWNERSHIP=false is a kill switch", () => {
  process.env.ENFORCE_OWNERSHIP = "false";
  assert.equal(ownershipEnforcementEnabled(), false);
  process.env.ENFORCE_OWNERSHIP = "true";
  assert.equal(ownershipEnforcementEnabled(), true);
});

test.after(() => { if (saved === undefined) delete process.env.ENFORCE_OWNERSHIP; else process.env.ENFORCE_OWNERSHIP = saved; });
