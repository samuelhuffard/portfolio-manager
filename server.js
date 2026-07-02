import "dotenv/config";
import http from "node:http";
import { timingSafeEqual } from "node:crypto";
import { runResearchScan } from "./jobs/research-scan.js";
import { runIntradayMonitor } from "./jobs/intraday-monitor.js";
import { listPriceAlerts, addPriceAlert, removePriceAlert } from "./lib/price-alerts.js";
import { syncHoldings } from "./jobs/holdings-sync.js";
import { getProposalById, markProposalFulfilled, getRedis } from "./lib/redis.js";
import { recordMcpFill } from "./lib/mcp-accounting.js";
import { getServiceAccountClients, getSheetIds, resolveSharedSpreadsheetId } from "./lib/sheets.js";

const PORT = process.env.PORTFOLIO_SERVER_PORT ?? 3200;
const SECRET = process.env.PORTFOLIO_WEBHOOK_SECRET?.trim();

let scanRunning = false;
let syncRunning = false;

// FAIL CLOSED: without a configured secret, every route except /health is
// refused. The old fail-open behavior meant an unset env var silently exposed
// /record-trade, /scan, and /alerts to anyone who could reach this port.
function auth(req) {
  if (!SECRET) return false;
  const header = req.headers["authorization"] ?? "";
  const expected = Buffer.from(`Bearer ${SECRET}`);
  const provided = Buffer.from(String(header));
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  const url = new URL(req.url, `http://localhost`);

  if (req.method === "GET" && url.pathname === "/health") {
    // "ok" used to mean only "the process is up" — it said ok with Redis,
    // Sheets auth, and the Anthropic key all broken (the silent-no-op family
    // of bugs). Report dependency reality instead. Booleans only; safe unauthenticated.
    const deps = {
      redis: false,
      sheetsAuth: Boolean(process.env.GOOGLE_SERVICE_ACCOUNT || process.env.GOOGLE_CREDENTIALS_PATH),
      anthropicKey: Boolean(process.env.ANTHROPIC_API_KEY?.trim()),
      webhookSecret: Boolean(SECRET),
      telegram: Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim() && process.env.TELEGRAM_CHAT_ID?.trim()),
    };
    try {
      const redis = getRedis();
      if (redis) deps.redis = (await redis.ping()) === "PONG";
    } catch {
      deps.redis = false;
    }
    const ok = deps.redis && deps.sheetsAuth && deps.anthropicKey && deps.webhookSecret;
    res.writeHead(ok ? 200 : 503);
    res.end(JSON.stringify({ ok, scanRunning, deps }));
    return;
  }

  if (!auth(req)) {
    res.writeHead(401);
    res.end(JSON.stringify({ error: "Unauthorized" }));
    return;
  }

  // POST /sync-holdings — trigger an on-demand holdings sync (called by PostToolUse hook
  // after Robinhood MCP trade actions so cash/NAV refresh without waiting for the schedule)
  if (req.method === "POST" && url.pathname === "/sync-holdings") {
    if (syncRunning) {
      res.writeHead(409);
      res.end(JSON.stringify({ error: "Sync already running" }));
      return;
    }
    res.writeHead(202);
    res.end(JSON.stringify({ ok: true, message: "Holdings sync started" }));
    syncRunning = true;
    syncHoldings()
      .catch((e) => console.error("[Server] Holdings sync error:", e.message))
      .finally(() => { syncRunning = false; });
    return;
  }

  // POST /scan — trigger full research scan
  if (req.method === "POST" && url.pathname === "/scan") {
    if (scanRunning) {
      res.writeHead(409);
      res.end(JSON.stringify({ error: "Scan already running" }));
      return;
    }
    res.writeHead(202);
    res.end(JSON.stringify({ ok: true, message: "All-agent scan started" }));
    scanRunning = true;
    runResearchScan()
      .catch((e) => console.error("[Server] Scan error:", e.message))
      .finally(() => { scanRunning = false; });
    return;
  }

  // POST /intraday — trigger an on-demand intraday check
  if (req.method === "POST" && url.pathname === "/intraday") {
    res.writeHead(202);
    res.end(JSON.stringify({ ok: true, message: "Intraday check started" }));
    runIntradayMonitor({ context: "manual" }).catch((e) => console.error("[Server] Intraday error:", e.message));
    return;
  }

  // GET /alerts — list all price alerts
  if (req.method === "GET" && url.pathname === "/alerts") {
    const alerts = await listPriceAlerts();
    res.writeHead(200);
    res.end(JSON.stringify({ alerts }));
    return;
  }

  // POST /alerts — add a new price alert
  if (req.method === "POST" && url.pathname === "/alerts") {
    try {
      const body = await readBody(req);
      const { agentId, ticker, direction, targetPrice, note } = body;
      const validAgentId = ["agent-1", "agent-2", "agent-3"].includes(agentId) ? agentId : "agent-1";
      if (!ticker || !direction || targetPrice == null) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "ticker, direction, and targetPrice are required" }));
        return;
      }
      if (direction !== "below" && direction !== "above") {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "direction must be 'below' or 'above'" }));
        return;
      }
      const alert = await addPriceAlert({ agentId: validAgentId, ticker, direction, targetPrice, note });
      res.writeHead(201);
      res.end(JSON.stringify({ alert }));
    } catch (e) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // DELETE /alerts/:id — remove a price alert
  const deleteMatch = url.pathname.match(/^\/alerts\/([^/]+)$/);
  if (req.method === "DELETE" && deleteMatch) {
    await removePriceAlert(deleteMatch[1]);
    res.writeHead(200);
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // POST /record-trade — called by the portfolio dashboard after a Robinhood MCP order is placed
  if (req.method === "POST" && url.pathname === "/record-trade") {
    try {
      const body = await readBody(req);
      const { proposalId, orderId, ticker, side, shares, price, agentId } = body;
      if (!proposalId || !orderId || !ticker || !side || shares == null || price == null) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "proposalId, orderId, ticker, side, shares, and price are required" }));
        return;
      }
      const proposal = await getProposalById(proposalId);
      const { sheets, drive } = getServiceAccountClients();
      const spreadsheetId = await resolveSharedSpreadsheetId(sheets, drive);
      const sheetIds = await getSheetIds(sheets, spreadsheetId);
      const { trade, alreadyRecorded } = await recordMcpFill({
        sheets, spreadsheetId, sheetIds, proposal, orderId, ticker,
        side, shares, price, agentId: agentId ?? "agent-1",
      });
      await markProposalFulfilled(proposalId, orderId);
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, alreadyRecorded, trade }));
      // Kick off a holdings sync so the dashboard reflects the new position immediately
      syncHoldings().catch((e) => console.error("[Server] Post-trade sync error:", e.message));
    } catch (e) {
      console.error("[Server] record-trade error:", e.message);
      res.writeHead(500);
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: "Not found" }));
});

export function startServer() {
  if (!SECRET) {
    console.error("[Portfolio Manager] WARNING: PORTFOLIO_WEBHOOK_SECRET is not set — all routes except /health will return 401 until it is configured.");
  }
  server.listen(PORT, () => {
    console.log(`[Portfolio Manager] HTTP server listening on port ${PORT}`);
  });
}
