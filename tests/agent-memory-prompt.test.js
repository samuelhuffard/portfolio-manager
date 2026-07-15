import { test } from "node:test";
import assert from "node:assert/strict";
import { formatAgentMemoriesForPrompt, isResearchPromptMemory } from "../lib/agent-memory.js";

test("dashboard workflow preferences stay out of investment research prompts", () => {
  const operational = [
    { text: "Push proposals directly to the approval tab with one-click accept." },
    { text: "Remind Sam to revoke accepted trades when needed." },
  ];
  assert.equal(isResearchPromptMemory(operational[0]), false);
  assert.equal(isResearchPromptMemory(operational[1]), false);
  assert.equal(formatAgentMemoriesForPrompt(operational), "");
});

test("genuine investment lessons remain in the research prompt", () => {
  const memories = [
    { text: "Avoid averaging down when the original thesis has weakened." },
    { text: "Prefer companies with improving free-cash-flow margins." },
  ];
  assert.equal(isResearchPromptMemory(memories[0]), true);
  assert.equal(formatAgentMemoriesForPrompt(memories), [
    "- Avoid averaging down when the original thesis has weakened.",
    "- Prefer companies with improving free-cash-flow margins.",
  ].join("\n"));
});
