#!/usr/bin/env node
import "dotenv/config";
import { closePool } from "../lib/pg/client.js";
import { runParityCheck } from "../lib/pg/parity-runner.js";

try {
  const result = await runParityCheck();
  console.log("Authoritative:", JSON.stringify(result.authoritative));
  console.log("Postgres shadow:", JSON.stringify(result.postgres));
  console.log("");
  console.log(result.report);
  if (!result.ok) process.exitCode = 2;
} finally {
  await closePool();
}
