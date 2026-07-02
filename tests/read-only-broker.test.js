import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Guards INVARIANTS.md #1 and #9: the robin_stocks Python layer is read-only
// forever (no order placement outside the human-approved MCP path), and login
// session pickles never persist unless ROBINHOOD_STORE_SESSION deliberately
// opts in. These are text-level assertions on the source files — crude, but
// they turn a silent policy into a failing test.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PY_FILES = ["robinhood-sync.py", "robinhood-scan.py"].map((f) =>
  path.join(__dirname, "..", "lib", f)
);

test("robin_stocks Python layer contains no order-placing or account-mutating calls", () => {
  // robin_stocks order functions all start with rh.order (order_buy_market,
  // order_sell_fractional_by_price, etc.); cancel_* and withdrawl/transfer
  // functions round out the mutation surface.
  const forbidden = /rh\.order|rh\.cancel_|order_buy|order_sell|withdrawl|transfer_funds/;
  for (const file of PY_FILES) {
    const source = readFileSync(file, "utf8");
    const match = source.match(forbidden);
    assert.equal(
      match,
      null,
      `${path.basename(file)} contains forbidden broker mutation call: "${match?.[0]}"`
    );
  }
});

test("robinhood session pickle is deleted unless ROBINHOOD_STORE_SESSION opts in", () => {
  for (const file of PY_FILES) {
    const source = readFileSync(file, "utf8");
    // The env flag must gate persistence...
    assert.match(source, /ROBINHOOD_STORE_SESSION/, `${path.basename(file)} missing the store-session env gate`);
    // ...and the cleanup path must exist (store_session=True is passed to work
    // around robin_stocks' login-return bug, then the pickle is removed).
    assert.match(source, /if not persist_session:/, `${path.basename(file)} missing persist_session gate`);
    assert.match(source, /os\.remove\(PICKLE_PATH\)/, `${path.basename(file)} missing pickle cleanup`);
  }
});
