import { test } from "node:test";
import assert from "node:assert/strict";
import { writeAsyncJson } from "../lib/http-json.js";

function responseRecorder() {
  const calls = [];
  return {
    calls,
    writeHead(status) { calls.push(["writeHead", status]); },
    end(body) { calls.push(["end", body]); },
  };
}

test("writeAsyncJson sends one 200 response after a successful async read", async () => {
  const res = responseRecorder();
  await writeAsyncJson(res, async () => ({ decisions: [] }));
  assert.deepEqual(res.calls, [
    ["writeHead", 200],
    ["end", JSON.stringify({ decisions: [] })],
  ]);
});

test("writeAsyncJson sends one 500 response when the async read fails before headers", async () => {
  const res = responseRecorder();
  await writeAsyncJson(res, async () => { throw new Error("shadow store unavailable"); });
  assert.deepEqual(res.calls, [
    ["writeHead", 500],
    ["end", JSON.stringify({ error: "shadow store unavailable" })],
  ]);
});

test("writeAsyncJson also catches JSON serialization failures before headers", async () => {
  const circular = {};
  circular.self = circular;
  const res = responseRecorder();
  await writeAsyncJson(res, async () => circular);
  assert.equal(res.calls.length, 2);
  assert.deepEqual(res.calls[0], ["writeHead", 500]);
  assert.match(res.calls[1][1], /circular/i);
});
