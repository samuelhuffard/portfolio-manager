// CANONICAL — edit here only. Mirrored to portfolio-dashboard/lib/contracts/.
// Durable request/receipt shape for Jetson-scheduled, Mac-executed Robinhood
// MCP reads. These jobs may read broker state and write the existing accounting
// projection, but they never carry or authorize a trade instruction.

import { z } from "zod";

export const MCP_READ_JOB_KINDS = ["holdings-sync", "order-reconciliation"];
export const MCP_ACCOUNT_POLICY_VERSION = "agentic-account-binding-v1";
export const McpReadJobKindSchema = z.enum(MCP_READ_JOB_KINDS);

export const McpReadRequestSchema = z.object({
  id: z.string().uuid(),
  kind: McpReadJobKindSchema,
  requestedAt: z.string().datetime(),
  requestedForET: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  invocationId: z.string().regex(/^\d{4}-\d{2}-\d{2}\/\d{2}:\d{2}$/).nullable().default(null),
});

export const McpReadReceiptSchema = z.object({
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
});
