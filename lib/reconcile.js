/**
 * Broker-vs-ledger reconciliation (RISK_REGISTER #1). Pure diff logic —
 * scripts/reconcile-orders.js supplies the I/O.
 *
 * Every residual execution/recording failure mode (executor dies mid-recovery,
 * a manual trade outside the approval flow, a partial-fill oddity) shows up as
 * a broker order with no Trade Ledger row. This makes those visible instead of
 * waiting for the Sheet numbers to "look weird."
 */

const FILLED_STATES = new Set(["filled", "partially_filled"]);

function normalizeOrder(order) {
  return {
    orderId: String(order.orderId ?? order.id ?? "").trim(),
    ticker: String(order.ticker ?? order.symbol ?? "").trim().toUpperCase(),
    side: String(order.side ?? "").trim().toUpperCase(),
    state: String(order.state ?? "").trim().toLowerCase(),
    shares: order.shares != null ? Number(order.shares) : null,
    price: order.price != null ? Number(order.price) : null,
    filledAt: order.filledAt ?? order.updatedAt ?? null,
  };
}

/**
 * brokerOrders: raw order objects from the Robinhood MCP (any casing/aliases).
 * ledger: rows from readTradeLedger (each has .orderId).
 * Returns { checked, matched, missingFromLedger, malformed }.
 * Only filled/partially_filled broker orders are expected in the ledger —
 * working or cancelled orders never produce ledger rows.
 */
export function reconcileOrders({ brokerOrders = [], ledger = [] }) {
  const ledgerOrderIds = new Set(ledger.map((t) => t.orderId).filter(Boolean));
  const missingFromLedger = [];
  const malformed = [];
  let matched = 0;
  let checked = 0;

  for (const raw of brokerOrders) {
    const order = normalizeOrder(raw);
    if (!FILLED_STATES.has(order.state)) continue;
    checked += 1;
    if (!order.orderId) {
      malformed.push(raw);
      continue;
    }
    if (ledgerOrderIds.has(order.orderId)) matched += 1;
    else missingFromLedger.push(order);
  }

  return { checked, matched, missingFromLedger, malformed };
}

export function formatReconcileReport({ checked, matched, missingFromLedger, malformed }) {
  if (checked === 0) return "Reconcile: no filled broker orders in the window — nothing to check.";
  const lines = [`Reconcile: ${matched}/${checked} filled broker order(s) present in the Trade Ledger.`];
  for (const miss of missingFromLedger) {
    lines.push(
      `MISSING from ledger: ${miss.side} ${miss.shares ?? "?"} ${miss.ticker} @ $${miss.price ?? "?"} (order ${miss.orderId}, ${miss.filledAt ?? "time unknown"})`
    );
  }
  if (malformed.length) lines.push(`${malformed.length} filled order(s) had no parseable orderId — inspect manually.`);
  return lines.join("\n");
}
