import "dotenv/config";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const REQUIRED_ENV = [
  // Signs and verifies the approval decision. Without it
  // assertApprovedProposalSignature cannot verify anything, so a preflight that
  // does not demand it can pass while the execution-authority boundary is off.
  "AUDIT_HMAC_SECRET",
  "INVESTOR_LEDGER_HMAC_SECRET",
  "MCP_RECEIPT_HMAC_SECRET",
  "OPERATIONAL_LEDGER_HMAC_SECRET",
  "SYSLOOP_DEPLOY_HMAC_SECRET",
  "PORTFOLIO_WEBHOOK_SECRET",
  "ANTHROPIC_MONTHLY_MAX_USD",
];

// Opt-outs that disable a signature check. They exist for local development and
// must never be set where real money executes — a preflight that ignores them
// would certify an environment with the approval boundary switched off.
const FORBIDDEN_TRUE_ENV = ["ALLOW_UNSIGNED_PROPOSALS", "ALLOW_UNSIGNED_INVESTOR_LEDGER", "ROBINHOOD_STORE_SESSION"];

export function evaluateObservationPreflight({ status, head, remoteHead, env = process.env }) {
  const failures = [];
  if (String(status ?? "").trim()) failures.push("git worktree is not clean");
  if (!String(head ?? "").trim() || !String(remoteHead ?? "").trim()) {
    failures.push("local or remote release revision is unavailable");
  } else if (head !== remoteHead) {
    failures.push(`checked-out revision ${head} does not equal reviewed remote revision ${remoteHead}`);
  }
  for (const name of REQUIRED_ENV) {
    if (!String(env[name] ?? "").trim()) failures.push(`${name} is missing`);
  }
  for (const name of FORBIDDEN_TRUE_ENV) {
    if (String(env[name] ?? "").trim() === "true") failures.push(`${name}=true disables a signature check and must not be set in production`);
  }
  if (String(env.ANTHROPIC_BUDGET_REQUIRED ?? "").trim() !== "true") {
    failures.push("ANTHROPIC_BUDGET_REQUIRED must be true for observation");
  }
  return { ok: failures.length === 0, failures };
}

async function git(args) {
  return (await execFileAsync("git", args)).stdout.trim();
}

export async function runObservationPreflight({ branch = process.env.OBSERVATION_RELEASE_BRANCH?.trim() || "mandate-v3", env = process.env } = {}) {
  const [status, head, remoteHead] = await Promise.all([
    git(["status", "--porcelain"]),
    git(["rev-parse", "HEAD"]),
    git(["rev-parse", `origin/${branch}`]),
  ]);
  const result = evaluateObservationPreflight({ status, head, remoteHead, env });
  if (!result.ok) throw new Error(`Observation preflight failed: ${result.failures.join("; ")}`);
  return { branch, head, remoteHead };
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  runObservationPreflight()
    .then((result) => console.log(`[ObservationPreflight] PASS ${result.branch}@${result.head}`))
    .catch((error) => {
      console.error(`[ObservationPreflight] FAIL ${error.message}`);
      process.exit(1);
    });
}
