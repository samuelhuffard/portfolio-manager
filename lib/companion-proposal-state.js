const STRING_FIELDS = new Set([
  "executionStartedAt",
  "executionOrderId",
  "executionFailedAt",
  "executionFailureReason",
]);

const ALLOWED_FIELDS = new Set([
  "status",
  "executionState",
  "executionStartedAt",
  "executionOrderId",
  "executionShares",
  "executionPrice",
  "executionFailedAt",
  "executionFailureReason",
]);

/**
 * The Mac may report executor state, but it may not mutate financial or approval
 * fields directly. The Jetson applies this narrow patch and mirrors it to Neon.
 */
export function validateCompanionProposalStatePatch(patch, proposal = null) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw new Error("companion proposal patch must be an object");
  }
  const fields = Object.keys(patch);
  if (fields.length === 0 || fields.some((field) => !ALLOWED_FIELDS.has(field))) {
    throw new Error("companion proposal patch contains a forbidden field");
  }
  if (patch.status != null && patch.status !== "ExecutionFailed") {
    throw new Error("companion may only transition a proposal to ExecutionFailed");
  }
  if (patch.executionState != null && !["Executing", "BrokerRejected"].includes(patch.executionState)) {
    throw new Error("companion executionState is invalid");
  }
  for (const field of STRING_FIELDS) {
    if (patch[field] != null && (typeof patch[field] !== "string" || !patch[field].trim())) {
      throw new Error(`companion ${field} must be a non-empty string or null`);
    }
  }
  for (const field of ["executionShares", "executionPrice"]) {
    if (patch[field] != null && (!Number.isFinite(Number(patch[field])) || Number(patch[field]) <= 0)) {
      throw new Error(`companion ${field} must be a positive number or null`);
    }
  }
  if (proposal && (proposal.status !== "ApprovedForBrokerReview" || proposal.fulfilledAt)) {
    throw new Error("companion may report execution state only for an unfulfilled approved proposal");
  }
  return patch;
}
