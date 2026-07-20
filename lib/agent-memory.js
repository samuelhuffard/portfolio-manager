import { randomUUID } from "node:crypto";
import { getRedis } from "./redis.js";

const MAX_MEMORIES = 20;
const MAX_MEMORIES_PER_KEY = 100; // mirrors portfolio-dashboard lib/agentMemory.ts
const MAX_WEEKLY_LESSONS = 6; // weekly-review lessons evict only each other, never Sam's memories
const WEEKLY_SOURCE = "weekly_review";

// Chat memories can also capture dashboard/workflow preferences. Those remain
// available to the UI, but they are not investment evidence and must not be
// inserted into a research model's prompt as if they were trading guidance.
const OPERATIONAL_MEMORY_PATTERNS = [
  /\bpush proposals? (?:directly )?to (?:the )?approval tab\b/i,
  /\bproposals?\b[\s\S]{0,120}\bapprovals?\s+tab\b/i,
  /\bone[- ]click\b[\s\S]{0,40}\b(?:accept|approv)/i,
  /\brevoke (?:accepted )?trades?\b/i,
  /\bremind (?:sam|me) to (?:cancel|revoke) (?:accepted )?trades?\b/i,
];

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
  return memories
    .filter(isResearchPromptMemory)
    .map((memory) => `- ${memory.text}`)
    .join("\n");
}

export function isResearchPromptMemory(memory) {
  const text = String(memory?.text ?? "").trim();
  if (!text) return false;
  if (memory?.category === "workflow") return false;
  // Proposal decisions are point-in-time, ticker-specific records, not durable
  // cross-ticker research guidance. Their history belongs in the per-ticker
  // research ledger; injecting one globally can make stale BUY/SELL language
  // appear in unrelated prompts.
  if (memory?.source === "proposal_decision") return false;
  if (memory?.category === "investment") return true;
  // Legacy rows predate typed categories. Keep the narrow quarantine as a
  // compatibility fallback until those retained memories are rewritten.
  return !OPERATIONAL_MEMORY_PATTERNS.some((pattern) => pattern.test(text));
}

function normalizeText(text) {
  return (text ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Pure merge of weekly-review lessons into an existing memory list
 * (jobs/weekly-review.js wraps this with the Redis read/write).
 * - `retire` entries remove ONLY weekly_review-sourced memories whose text matches.
 * - New lessons are added as weekly_review memories (importance 4).
 * - Weekly lessons are capped at MAX_WEEKLY_LESSONS by evicting the oldest
 *   weekly lessons; memories from chat/manual/proposal decisions are never touched.
 */
export function mergeWeeklyLessons(existing, { lessons = [], retire = [] }, now = new Date().toISOString()) {
  const retireSet = new Set(retire.map(normalizeText).filter(Boolean));
  const kept = (existing ?? []).filter(
    (m) => !(m.source === WEEKLY_SOURCE && retireSet.has(normalizeText(m.text)))
  );

  const existingTexts = new Set(kept.map((m) => normalizeText(m.text)));
  const additions = lessons
    .map((text) => text.replace(/\s+/g, " ").trim().slice(0, 500))
    .filter((text) => text && !existingTexts.has(normalizeText(text)))
    .map((text) => ({
      id: randomUUID(),
      scope: "agent",
      userId: null,
      text,
      source: WEEKLY_SOURCE,
      category: "investment",
      importance: 4,
      createdAt: now,
      updatedAt: now,
    }));

  let merged = [...kept, ...additions];
  const weekly = merged
    .filter((m) => m.source === WEEKLY_SOURCE)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  if (weekly.length > MAX_WEEKLY_LESSONS) {
    const evict = new Set(weekly.slice(MAX_WEEKLY_LESSONS).map((m) => m.id));
    merged = merged.filter((m) => !evict.has(m.id));
  }
  return merged;
}

/** Read-merge-write of weekly lessons for one agent. Returns the merged list (or null if Redis is unconfigured). */
export async function applyWeeklyLessons(agentId, { lessons, retire }, now = new Date().toISOString()) {
  const redis = getRedis();
  if (!redis) {
    console.error(`[AgentMemory] Redis NOT CONFIGURED — weekly lessons for ${agentId} DROPPED.`);
    return null;
  }
  const key = globalKey(agentId);
  const existing = await readMemoryList(key);
  const merged = mergeWeeklyLessons(existing, { lessons, retire }, now)
    .sort((a, b) => b.importance - a.importance || Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, MAX_MEMORIES_PER_KEY);
  await redis.set(key, JSON.stringify(merged));
  return merged;
}
