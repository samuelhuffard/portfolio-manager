import "dotenv/config";
import { listOpenApprovedProposals } from "../lib/redis.js";

// Read-only: prints proposals approved in the dashboard's /approvals queue that
// haven't been matched to a Robinhood fill yet. Used to find what's ready for
// on-demand execution via the robinhood-trading MCP.
const proposals = await listOpenApprovedProposals();
console.log(JSON.stringify(proposals, null, 2));
