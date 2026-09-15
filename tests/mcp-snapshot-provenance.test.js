import test from "node:test";
import assert from "node:assert/strict";
import { parseMcpSnapshotProvenanceArgs } from "../lib/mcp-snapshot-provenance.js";

const requestId = "00000000-0000-4000-8000-000000000001";
const invocationId = "2026-09-14/16:30";

test("scheduled snapshot provenance accepts only a complete typed request/invocation pair", () => {
  assert.deepEqual(
    parseMcpSnapshotProvenanceArgs(["--scan", "--request-id", requestId, "--invocation-id", invocationId]),
    { sourceRequestId: requestId, sourceInvocationId: invocationId },
  );
  assert.deepEqual(parseMcpSnapshotProvenanceArgs(["--scan"]), {
    sourceRequestId: null, sourceInvocationId: null,
  });
});

test("scheduled snapshot provenance rejects incomplete, malformed, and duplicate flags before any write", () => {
  assert.throws(() => parseMcpSnapshotProvenanceArgs(["--request-id", requestId]), /supplied together/);
  assert.throws(() => parseMcpSnapshotProvenanceArgs(["--invocation-id", invocationId]), /supplied together/);
  assert.throws(() => parseMcpSnapshotProvenanceArgs(["--request-id", requestId, "--request-id", requestId, "--invocation-id", invocationId]), /only once/);
  assert.throws(() => parseMcpSnapshotProvenanceArgs(["--request-id", "not-a-uuid", "--invocation-id", invocationId]));
  assert.throws(() => parseMcpSnapshotProvenanceArgs(["--request-id", requestId, "--invocation-id", "tomorrow"]));
});
