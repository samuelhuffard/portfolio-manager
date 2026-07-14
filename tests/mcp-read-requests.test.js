import { test } from "node:test";
import assert from "node:assert/strict";
import { McpReadRequestSchema } from "../contracts/mcp-read-job.js";
import { enqueueMcpReadRequest, mcpReadRequestKey } from "../jobs/mcp-read-requests.js";

test("MCP read requests are typed, scoped, and deduplicated by kind", async () => {
  const calls = [];
  const redis = { set: async (...args) => { calls.push(args); return "OK"; } };
  const { queued, request } = await enqueueMcpReadRequest("holdings-sync", {
    redis,
    now: new Date("2026-07-13T13:30:00.000Z"),
  });
  assert.equal(queued, true);
  assert.equal(request.kind, "holdings-sync");
  assert.deepEqual(McpReadRequestSchema.parse(request), request);
  assert.equal(calls[0][0], mcpReadRequestKey("holdings-sync"));
  assert.equal(calls[0][2].nx, true);
  assert.equal(calls[0][2].ex, 36 * 60 * 60);
});

test("MCP read requests reject unknown or mutation-shaped job kinds", async () => {
  await assert.rejects(() => enqueueMcpReadRequest("place-order", { redis: {} }));
  assert.throws(() => mcpReadRequestKey("cancel-order"));
});

test("MCP read requests return the actual pending request when NX deduplicates", async () => {
  const existing = {
    id: "00000000-0000-4000-8000-000000000001",
    kind: "holdings-sync",
    requestedAt: "2026-07-13T13:00:00.000Z",
    requestedForET: "2026-07-13",
    invocationId: "2026-07-13/09:30",
  };
  const redis = {
    set: async () => null,
    get: async () => JSON.stringify(existing),
  };
  const result = await enqueueMcpReadRequest("holdings-sync", {
    redis,
    invocationId: "2026-07-13/11:00",
  });
  assert.equal(result.queued, false);
  assert.deepEqual(result.request, existing);
  assert.equal(result.request.invocationId, "2026-07-13/09:30");
});
