import { randomUUID } from "node:crypto";
import { getRedis } from "./redis.js";

const RELEASE_IF_OWNER = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
end
return 0
`;

export class WorkflowAlreadyRunningError extends Error {
  constructor(name) {
    super(`Workflow ${name} is already running.`);
    this.name = "WorkflowAlreadyRunningError";
    this.code = "WORKFLOW_LOCKED";
  }
}

export async function acquireWorkflowLock(name, { redis = getRedis(), ttlSeconds = 900 } = {}) {
  if (!redis) throw new Error(`Redis is required to lock workflow ${name}.`);
  const key = `pm:workflow-lock:${name}`;
  const token = randomUUID();
  const acquired = await redis.set(key, token, { nx: true, ex: ttlSeconds });
  if (acquired !== "OK") throw new WorkflowAlreadyRunningError(name);

  let released = false;
  return async () => {
    if (released) return false;
    released = true;
    return (await redis.eval(RELEASE_IF_OWNER, [key], [token])) === 1;
  };
}

export async function withWorkflowLock(name, fn, options) {
  const release = await acquireWorkflowLock(name, options);
  try {
    return await fn();
  } finally {
    try {
      await release();
    } catch (error) {
      // The TTL is the final backstop. Never hide the workflow's real result or
      // failure behind a transient Redis error during cleanup.
      console.error(`[WorkflowLock] Failed to release ${name}:`, error.message);
    }
  }
}
