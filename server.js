import "dotenv/config";
import http from "node:http";
import { runResearchScan } from "./jobs/research-scan.js";
import { runIntradayMonitor } from "./jobs/intraday-monitor.js";
import { listPriceAlerts, addPriceAlert, removePriceAlert } from "./lib/price-alerts.js";
import { syncHoldings } from "./jobs/holdings-sync.js";

const PORT = process.env.PORTFOLIO_SERVER_PORT ?? 3200;
const SECRET = process.env.PORTFOLIO_WEBHOOK_SECRET;

let scanRunning = false;
let syncRunning = false;

function auth(req) {
  if (!SECRET) return true;
  return req.headers["authorization"] === `Bearer ${SECRET}`;
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
    res.writeHead(200);
    res.end(JSON.stringify({ ok: true, scanRunning }));
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

  res.writeHead(404);
  res.end(JSON.stringify({ error: "Not found" }));
});

export function startServer() {
  server.listen(PORT, () => {
    console.log(`[Portfolio Manager] HTTP server listening on port ${PORT}`);
  });
}
