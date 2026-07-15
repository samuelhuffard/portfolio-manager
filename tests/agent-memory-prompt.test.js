import { test } from "node:test";
import assert from "node:assert/strict";
import { formatAgentMemoriesForPrompt, isResearchPromptMemory } from "../lib/agent-memory.js";

test("dashboard workflow preferences stay out of investment research prompts", () => {
  const operational = [
    { text: "All proposals should be pushed directly to the Approvals tab with a one-click Accept button." },
    { text: "Remind Sam to revoke accepted trades when needed." },
  ];
  assert.equal(isResearchPromptMemory(operational[0]), false);
  assert.equal(isResearchPromptMemory(operational[1]), false);
  assert.equal(formatAgentMemoriesForPrompt(operational), "");
});

test("typed memory categories override natural-language phrasing", () => {
  const workflowVariants = [
    { category: "workflow", text: "Send buys straight to the review queue." },
    { category: "workflow", text: "Notify me before accepting anything under fifty dollars." },
    { category: "workflow", text: "Clear my pending items every Friday." },
  ];
  assert.ok(workflowVariants.every((memory) => isResearchPromptMemory(memory) === false));
  assert.equal(formatAgentMemoriesForPrompt(workflowVariants), "");

  const investment = { category: "investment", text: "Prefer durable margins even if the workflow mentions an approvals tab." };
  assert.equal(isResearchPromptMemory(investment), true);
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
