// CANONICAL — edit here only. Mirrored to portfolio-dashboard/lib/contracts/.
// Durable request/receipt shape for Jetson-scheduled, Mac-executed Robinhood
// MCP reads. These jobs may read broker state and write the existing accounting
// projection, but they never carry or authorize a trade instruction.

import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const MCP_READ_JOB_KINDS = ["holdings-sync", "order-reconciliation"];
export const MCP_ACCOUNT_POLICY_VERSION = "agentic-account-binding-v1";
export const MCP_RECEIPT_SCHEMA_VERSION = "mcp-read-receipt-v2";
export const MCP_READ_RECEIPT_SOURCES = ["jetson-robinhood-mcp", "mac-robinhood-mcp"];
export const McpReadJobKindSchema = z.enum(MCP_READ_JOB_KINDS);
export const McpReadReceiptSourceSchema = z.enum(MCP_READ_RECEIPT_SOURCES);

export const McpReadRequestSchema = z.object({
  id: z.string().uuid(),
  kind: McpReadJobKindSchema,
  requestedAt: z.string().datetime(),
  requestedForET: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  invocationId: z.string().regex(/^\d{4}-\d{2}-\d{2}\/\d{2}:\d{2}$/).nullable().default(null),
});

export const McpReadReceiptSchema = z.object({
  schemaVersion: z.literal(MCP_RECEIPT_SCHEMA_VERSION),
  requestId: z.string().uuid(),
  kind: McpReadJobKindSchema,
  requestedAt: z.string().datetime(),
  completedAt: z.string().datetime(),
  ok: z.boolean(),
  outcome: z.enum(["ok", "mismatch", "failed"]),
  error: z.string().max(500).nullable(),
  invocationId: z.string().regex(/^\d{4}-\d{2}-\d{2}\/\d{2}:\d{2}$/).nullable(),
  accountVerified: z.boolean(),
  accountPolicyVersion: z.literal(MCP_ACCOUNT_POLICY_VERSION),
  source: McpReadReceiptSourceSchema,
  receiptHmac: z.string().regex(/^[a-f0-9]{64}$/i),
});

function receiptPayload(receipt) {
  const { receiptHmac: _receiptHmac, ...unsigned } = receipt ?? {};
  return JSON.stringify({ kind: "mcp-read-receipt", receipt: unsigned });
}

/** Sign one completed broker-read receipt with the dedicated cross-runtime key. */
export function signMcpReadReceipt(receipt, secret) {
  const parsed = McpReadReceiptSchema.omit({ receiptHmac: true }).parse(receipt);
  const key = String(secret ?? "").trim();
  if (!key) throw new Error("MCP_RECEIPT_HMAC_SECRET is required to sign broker-read receipts.");
  return {
    ...parsed,
    receiptHmac: createHmac("sha256", key).update(receiptPayload(parsed)).digest("hex"),
  };
}

/** Verify a reader-produced receipt before it can count toward a safety day. */
export function assertMcpReadReceipt(receipt, secret) {
  const parsed = McpReadReceiptSchema.parse(receipt);
  const key = String(secret ?? "").trim();
  if (!key) throw new Error("MCP_RECEIPT_HMAC_SECRET is required to verify broker-read receipts.");
  const expected = Buffer.from(createHmac("sha256", key).update(receiptPayload(parsed)).digest("hex"), "hex");
  const provided = Buffer.from(parsed.receiptHmac, "hex");
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    throw new Error("MCP broker-read receipt HMAC mismatch.");
  }
  return parsed;
}
