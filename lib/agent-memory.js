import { getRedis } from "./redis.js";

const MAX_MEMORIES = 20;

function globalKey(agentId) {
  return `pm:agent-memory:${agentId}:global`;
}

async function readMemoryList(key) {
  const redis = getRedis();
  if (!redis) return [];
  const raw = await redis.get(key);
  if (!raw) return [];
  const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  return Array.isArray(parsed) ? parsed : [];
}

export async function listAgentMemories(agentId, limit = MAX_MEMORIES) {
  try {
    return (await readMemoryList(globalKey(agentId)))
      .sort((a, b) => b.importance - a.importance || Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .slice(0, limit);
  } catch (err) {
    console.warn(`[AgentMemory] failed to read memories for ${agentId}:`, err.message);
    return [];
  }
}

export function formatAgentMemoriesForPrompt(memories) {
  if (!memories.length) return "";
  return memories.map((memory) => `- ${memory.text}`).join("\n");
}
