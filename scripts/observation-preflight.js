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

// Opt-outs that disable a safety check. They exist for local development and
// must never be set where real money executes — a preflight that ignores them
// would certify an environment with the approval boundary switched off.
const FORBIDDEN_TRUE_ENV = ["ALLOW_UNSIGNED_PROPOSALS", "ALLOW_UNSIGNED_INVESTOR_LEDGER", "ROBINHOOD_STORE_SESSION"];

// Match the LOOSEST truthiness any consumer applies, not the strictest. The
// Python broker readers enable session persistence for "1"/"true"/"yes"
// (lib/robinhood-sync.py, lib/robinhood-scan.py), so a preflight that rejected
// only the literal "true" would pass ROBINHOOD_STORE_SESSION=yes while a
// reusable brokerage session pickle sat on disk. A value a consumer never reads
// as true still fails here on purpose: it means the operator believed they set
// something, and that confusion is worth surfacing before an observation day.
const TRUTHY = new Set(["1", "true", "yes", "on", "y"]);
const isTruthy = (value) => TRUTHY.has(String(value ?? "").trim().toLowerCase());

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
    if (isTruthy(env[name])) failures.push(`${name}=${String(env[name]).trim()} disables a safety check and must not be set in production`);
  }
  // Inverted sense: ownership enforcement is ON unless explicitly "false".
  // Pulling that kill switch reverts to legacy account-wide FIFO, which lets a
  // signed SELL consume another strategy's or unattributed lots and misattribute
  // realized gains. It exists for a fast rollback — never for an observation day.
  if (String(env.ENFORCE_OWNERSHIP ?? "").trim().toLowerCase() === "false") {
    failures.push("ENFORCE_OWNERSHIP=false reverts to legacy account-wide FIFO and must not be set for observation");
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
