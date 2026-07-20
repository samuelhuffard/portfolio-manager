import { test } from "node:test";
import assert from "node:assert/strict";
import { allocateFairAgentRunCaps } from "../lib/research-capacity.js";

test("equal run-cap partitions prevent an earlier agent from consuming later-agent opportunity", () => {
  assert.deepEqual(
    allocateFairAgentRunCaps(["agent-3", "agent-1", "agent-2"], 3),
    { "agent-1": 1, "agent-2": 1, "agent-3": 1 }
  );
});

test("targeted diagnostic scan receives the full existing cap without raising it", () => {
  assert.deepEqual(allocateFairAgentRunCaps(["agent-2"], 3), { "agent-2": 3 });
});

test("uneven ceilings still give every active agent an exactly equal cap", () => {
  const caps = allocateFairAgentRunCaps(["agent-3", "agent-1", "agent-2"], 4);
  assert.equal(caps["agent-1"], caps["agent-2"]);
  assert.equal(caps["agent-2"], caps["agent-3"]);
  assert.ok(Object.values(caps).reduce((sum, value) => sum + value, 0) <= 4);
});
