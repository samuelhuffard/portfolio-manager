import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const server = readFileSync(new URL("../server.js", import.meta.url), "utf8");

test("/health exposes aggregate slate evidence for every agent and retains Agent One compatibility", () => {
  for (const agentId of ["agent-1", "agent-2", "agent-3"]) {
    assert.match(server, new RegExp(`getSlateSnapshot\\(agentId\\)`));
    assert.match(server, new RegExp(`\"${agentId}\"`));
  }
  assert.match(server, /slate = slates\["agent-1"\]/);
  assert.match(server, /JSON\.stringify\(\{ ok, scanRunning, deps, universe, slate, slates,/);
  assert.match(server, /toPublicSlateSnapshot\(await getSlateSnapshot\(agentId\)\)/);
  assert.doesNotMatch(server, /getPrivateResearchSlate|pm:research-slate:private/);
});
