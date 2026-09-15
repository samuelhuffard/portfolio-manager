import test from "node:test";
import assert from "node:assert/strict";
import { writePortfolioSnapshot } from "../lib/portfolio-snapshot.js";

test("a snapshot source invocation cannot be supplied without a verified request", async () => {
  await assert.rejects(
    () => writePortfolioSnapshot({ sourceInvocationId: "2026-09-10/16:30" }),
    /requires a verified source request ID/
  );
});
