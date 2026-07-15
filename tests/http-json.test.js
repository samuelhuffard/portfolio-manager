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
  const logs = [];
  await writeAsyncJson(res, async () => { throw new Error("shadow store unavailable"); }, { log: (...args) => logs.push(args) });
  assert.deepEqual(res.calls, [
    ["writeHead", 500],
    ["end", JSON.stringify({ error: "Internal server error" })],
  ]);
  assert.match(String(logs[0][1]), /shadow store unavailable/);
  assert.doesNotMatch(res.calls[1][1], /shadow store unavailable/);
});

test("writeAsyncJson also catches JSON serialization failures before headers", async () => {
  const circular = {};
  circular.self = circular;
  const res = responseRecorder();
  await writeAsyncJson(res, async () => circular, { log: () => {} });
  assert.equal(res.calls.length, 2);
  assert.deepEqual(res.calls[0], ["writeHead", 500]);
  assert.deepEqual(res.calls[1], ["end", JSON.stringify({ error: "Internal server error" })]);
});

test("writeAsyncJson treats undefined as an internal failure instead of an empty 200", async () => {
  const res = responseRecorder();
  await writeAsyncJson(res, async () => undefined, { log: () => {} });
  assert.deepEqual(res.calls, [
    ["writeHead", 500],
    ["end", JSON.stringify({ error: "Internal server error" })],
  ]);
});

test("writeAsyncJson contains response write failures and does not attempt a second response", async () => {
  const calls = [];
  const res = {
    writeHead(status) { calls.push(["writeHead", status]); throw new Error("socket closed"); },
    end(body) { calls.push(["end", body]); },
  };
  const logs = [];
  const written = await writeAsyncJson(res, async () => ({ ok: true }), { log: (...args) => logs.push(args) });
  assert.equal(written, false);
  assert.deepEqual(calls, [["writeHead", 200]]);
  assert.match(String(logs[0][1]), /socket closed/);
});

test("writeAsyncJson skips a socket that is already destroyed", async () => {
  const res = { ...responseRecorder(), destroyed: true };
  const written = await writeAsyncJson(res, async () => ({ ok: true }), { log: () => {} });
  assert.equal(written, false);
  assert.deepEqual(res.calls, []);
});
