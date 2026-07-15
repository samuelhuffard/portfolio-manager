import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeYahooError } from "../lib/yahoo.js";

test("Yahoo HTML failures become one concise observable message", () => {
  const error = new Error("HTTP 503 <!DOCTYPE html><html><body>" + "upstream failure ".repeat(100) + "</body></html>");
  assert.equal(summarizeYahooError(error), "Yahoo returned an HTML error response (HTTP 503)");
});

test("Yahoo text failures are whitespace-normalized and bounded", () => {
  assert.equal(summarizeYahooError(new Error("  socket   closed\n early ")), "socket closed early");
  assert.ok(summarizeYahooError("x".repeat(400)).length <= 240);
});

test("Yahoo non-Error objects retain useful fields instead of becoming object Object", () => {
  assert.equal(
    summarizeYahooError({ code: "ECONNRESET", status: 502, detail: "upstream closed" }),
    '{"code":"ECONNRESET","status":502,"detail":"upstream closed"}'
  );
  const circular = { code: "BROKEN" };
  circular.self = circular;
  assert.equal(summarizeYahooError(circular), '{"code":"BROKEN","self":"[Circular]"}');
});
