import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const guide = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "EXECUTION-GUIDE.md"), "utf8");

test("execution guide preserves fractional quantities instead of flooring to whole shares", () => {
  assert.match(guide, /shares = proposal\.amountDollars \/ currentPrice/);
  assert.doesNotMatch(guide, /floor\(proposal\.amountDollars \/ currentPrice\)/);
  assert.match(guide, /do not round down to a whole\s+share/i);
});
