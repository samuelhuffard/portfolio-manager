import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { readBody } from "../server.js";

function request(chunks, headers = {}) {
  const stream = Readable.from(chunks);
  stream.headers = headers;
  return stream;
}

test("HTTP JSON reader accepts a bounded valid body", async () => {
  await assert.doesNotReject(async () => {
    assert.deepEqual(await readBody(request(["{\"ticker\":\"NVDA\"}"])), { ticker: "NVDA" });
  });
});

test("HTTP JSON reader refuses declared and streamed oversized bodies", async () => {
  await assert.rejects(
    readBody(request([], { "content-length": String(128 * 1024 + 1) })),
    /128 KiB limit/,
  );
  await assert.rejects(readBody(request(["x".repeat(128 * 1024 + 1)])), /128 KiB limit/);
});
