import { test } from "node:test";
import assert from "node:assert/strict";
import { McpReadRequestSchema } from "../contracts/mcp-read-job.js";
import { enqueueMcpReadRequest, mcpReadInvocationKey, mcpReadQueueKey, mcpReadRequestKey } from "../jobs/mcp-read-requests.js";

test("MCP read requests are typed, scoped, and queued once per invocation", async () => {
  const calls = [];
  const redis = { eval: async (...args) => { calls.push(args); return [1, args[2][0]]; } };
  const { queued, request } = await enqueueMcpReadRequest("holdings-sync", {
    redis,
    now: new Date("2026-07-13T13:30:00.000Z"),
    invocationId: "2026-07-13/09:30",
  });
  assert.equal(queued, true);
  assert.equal(request.kind, "holdings-sync");
  assert.deepEqual(McpReadRequestSchema.parse(request), request);
  assert.deepEqual(calls[0][1], [
    mcpReadQueueKey("holdings-sync"),
    mcpReadInvocationKey("holdings-sync", "2026-07-13/09:30"),
  ]);
  assert.equal(calls[0][2][1], String(36 * 60 * 60));
});

test("MCP read requests reject unknown or mutation-shaped job kinds", async () => {
  await assert.rejects(() => enqueueMcpReadRequest("place-order", { redis: {} }));
  assert.throws(() => mcpReadRequestKey("cancel-order"));
  await assert.rejects(() => enqueueMcpReadRequest("holdings-sync", { redis: {} }), /invocationId is required/);
});

test("MCP read requests return the actual invocation request when delivery is duplicated", async () => {
  const existing = {
    id: "00000000-0000-4000-8000-000000000001",
    kind: "holdings-sync",
    requestedAt: "2026-07-13T13:00:00.000Z",
    requestedForET: "2026-07-13",
    invocationId: "2026-07-13/09:30",
  };
  const redis = {
    eval: async () => [0, JSON.stringify(existing)],
  };
  const result = await enqueueMcpReadRequest("holdings-sync", {
    redis,
    invocationId: "2026-07-13/11:00",
  });
  assert.equal(result.queued, false);
  assert.deepEqual(result.request, existing);
  assert.equal(result.request.invocationId, "2026-07-13/09:30");
});

test("different holdings slots remain distinct while an earlier request is pending", async () => {
  const retained = [];
  const redis = {
    async eval(_script, _keys, [payload]) { retained.push(JSON.parse(payload)); return [1, payload]; },
  };
  await enqueueMcpReadRequest("holdings-sync", { redis, now: new Date("2026-07-13T13:30:00Z"), invocationId: "2026-07-13/09:30" });
  await enqueueMcpReadRequest("holdings-sync", { redis, now: new Date("2026-07-13T15:00:00Z"), invocationId: "2026-07-13/11:00" });
  assert.deepEqual(retained.map((request) => request.invocationId), ["2026-07-13/09:30", "2026-07-13/11:00"]);
  assert.notEqual(retained[0].id, retained[1].id);
});
