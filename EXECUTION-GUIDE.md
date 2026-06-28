# Agent One — Execution Guide

This file is the playbook for a Claude agent session started from this directory.
The `robinhood-trading` MCP loads automatically when Claude starts here.

---

## When Sam says "execute approved proposals"

Run these steps in order. Stop and surface any issue rather than guessing through it.

### Step 1 — List what's approved and unfulfilled

```bash
node scripts/list-approved-proposals.js
```

If the output is an empty array (`[]`), nothing is pending — tell Sam and stop.

### Step 2 — Check buying power

Call the Robinhood MCP to get current buying power / cash available in the Agentic account.
Use whatever tool returns account balance or buying power (e.g. `get_account`, `get_portfolio`,
`get_buying_power`). Surface the amount to Sam before proceeding.

### Step 3 — For each approved proposal

Work through them one at a time. For each:

**a. Get the current price**
Call the MCP (or Yahoo Finance if the MCP has a quote tool) to get the live ask/last price
for the proposal's ticker. If you can't get a live price, stop and ask Sam.

**b. Calculate share count**
```
shares = floor(proposal.amountDollars / currentPrice)
```
If the proposal has a `maxPrice` and `currentPrice > maxPrice`, **do not execute** — tell Sam
the price has moved past the limit and ask if they want to revise.

**c. Confirm with Sam**
Print a one-line summary and wait for Sam to say "go" or "skip":
```
BUY 12 shares CRWD @ ~$218.50 = ~$2,622  (proposal: $2,500, agent-1)
```

**d. Place the order**
Call the Robinhood MCP order tool (e.g. `place_order`, `buy_stock`, `create_order`) with:
- ticker / symbol
- side: BUY or SELL
- quantity: shares (or dollar amount if the MCP supports fractional dollar orders)
- order type: market (unless Sam specifies limit)

Capture the order ID / execution ID returned by the MCP.

**e. Record the trade and mark fulfilled**
Run both commands — order matters (record first so the ledger is written even if mark-fulfilled
has a transient error):

```bash
node scripts/record-trade.js \
  --proposalId  <proposal.id> \
  --orderId     <mcp-order-id> \
  --ticker      <ticker> \
  --side        BUY \
  --shares      <shares> \
  --price       <executionPrice> \
  --agentId     agent-1
```

```bash
node scripts/mark-fulfilled.js <proposal.id> <mcp-order-id>
```

Repeat for each proposal. Never batch-execute without Sam's per-trade confirmation.

---

## When Sam says "sync holdings"

Call the MCP tool that returns current positions (e.g. `get_positions`, `get_portfolio`,
`list_holdings`). Map the output to this JSON shape and pipe it to the sync script:

```json
{
  "positions": [
    {
      "ticker":       "CRWD",
      "name":         "CrowdStrike Holdings",
      "shares":       12,
      "avgCost":      218.50,
      "currentPrice": 225.00,
      "marketValue":  2700.00,
      "costBasis":    2622.00
    }
  ],
  "cash": 1500.00
}
```

```bash
echo '<json above>' | node scripts/sync-holdings-from-mcp.js
```

Or write to a temp file:
```bash
cat > /tmp/positions.json << 'EOF'
{ ... }
EOF
node scripts/sync-holdings-from-mcp.js < /tmp/positions.json
```

---

## Hard rules (never override these)

- Never place a trade without Sam's explicit per-trade confirmation in that session.
- Never execute a proposal with `status !== "ApprovedForBrokerReview"`.
- Never execute a proposal that already has `fulfilledAt` set — it's already done.
- If `currentPrice > proposal.maxPrice` (when maxPrice is set), stop and surface it.
- If buying power is insufficient for any trade, surface that and let Sam decide order.
- This is the Robinhood **Agentic sub-account** — separate from Sam's main account.
- If the MCP returns an error at any step, stop, surface the full error, and wait.
