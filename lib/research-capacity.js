function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Split the existing run ceiling into equal agent-owned partitions. This does
 * not raise the run ceiling; it prevents an earlier sequential agent from
 * reserving capacity that belongs to a later agent.
 */
export function allocateFairAgentRunCaps(agentIds, totalMaxUsd) {
  const ids = [...new Set((agentIds ?? []).map(String))].sort();
  if (!ids.length) return {};
  const total = positiveNumber(totalMaxUsd, 3);
  const perAgent = Number((total / ids.length).toFixed(12));
  return Object.fromEntries(ids.map((agentId) => [agentId, perAgent]));
}
