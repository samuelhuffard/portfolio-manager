import { McpReadRequestSchema } from "../contracts/mcp-read-job.js";

/**
 * Parse the two flags that bind a scheduled holdings write to one durable MCP
 * request. This is deliberately separate from the CLI so the same exact
 * fail-closed contract can be tested without reaching Sheets, Redis, or a
 * broker.
 */
export function parseMcpSnapshotProvenanceArgs(argv = []) {
  if (!Array.isArray(argv)) throw new TypeError("CLI arguments must be an array.");
  const requestPositions = argv.reduce((all, value, index) => value === "--request-id" ? [...all, index] : all, []);
  const invocationPositions = argv.reduce((all, value, index) => value === "--invocation-id" ? [...all, index] : all, []);
  if (requestPositions.length > 1 || invocationPositions.length > 1) {
    throw new Error("Scheduled snapshot provenance flags may be supplied only once.");
  }

  const requestId = requestPositions.length ? argv[requestPositions[0] + 1] : null;
  const invocationId = invocationPositions.length ? argv[invocationPositions[0] + 1] : null;
  if (requestPositions.length && !requestId) throw new Error("--request-id requires a request UUID.");
  if (invocationPositions.length && !invocationId) throw new Error("--invocation-id requires YYYY-MM-DD/HH:mm.");
  if (Boolean(requestId) !== Boolean(invocationId)) {
    throw new Error("--request-id and --invocation-id must be supplied together for a scheduled provenance-bound snapshot.");
  }
  if (!requestId) return { sourceRequestId: null, sourceInvocationId: null };

  return {
    sourceRequestId: McpReadRequestSchema.shape.id.parse(requestId),
    sourceInvocationId: McpReadRequestSchema.shape.invocationId.parse(invocationId),
  };
}
