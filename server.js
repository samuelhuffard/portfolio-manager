import "dotenv/config";
import http from "node:http";
import { runResearchScan } from "./jobs/research-scan.js";

const PORT = process.env.PORTFOLIO_SERVER_PORT ?? 3200;
const SECRET = process.env.PORTFOLIO_WEBHOOK_SECRET;

let scanRunning = false;

const server = http.createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json");

  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200);
    res.end(JSON.stringify({ ok: true, scanRunning }));
    return;
  }

  if (req.method === "POST" && req.url === "/scan") {
    if (SECRET) {
      const auth = req.headers["authorization"] ?? "";
      if (auth !== `Bearer ${SECRET}`) {
        res.writeHead(401);
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }
    }

    if (scanRunning) {
      res.writeHead(409);
      res.end(JSON.stringify({ error: "Scan already running" }));
      return;
    }

    res.writeHead(202);
    res.end(JSON.stringify({ ok: true, message: "Scan started" }));

    scanRunning = true;
    runResearchScan()
      .catch((e) => console.error("[Server] Scan error:", e.message))
      .finally(() => { scanRunning = false; });
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
