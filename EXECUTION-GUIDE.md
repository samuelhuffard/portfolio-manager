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

Call `mcp__robinhood-trading__get_portfolio` with the Agentic account number to get current
buying power / cash available. Surface the amount to Sam before proceeding.

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
Call `mcp__robinhood-trading__place_equity_order` with:
- `account_number`: Agentic sub-account number
- `symbol`: ticker
- `side`: `"buy"` or `"sell"`
- `quantity`: shares (decimals allowed for market orders)
- `type`: `"market"` (unless Sam specifies `"limit"`, in which case also pass `limit_price`)
- `ref_id`: fresh UUID per order (re-send same UUID on retry)

Always call `mcp__robinhood-trading__review_equity_order` first with the same params,
present the estimated cost and any alerts, wait for Sam's "go", then place.

Capture the order ID returned by the MCP.

**e. Record the trade**
Run the recording command. It validates the fill against the approved proposal, writes the
Trade Ledger, opens/consumes FIFO Lots, and marks the proposal fulfilled only after the
spreadsheet writes succeed:

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

Repeat for each proposal. Never batch-execute without Sam's per-trade confirmation.

---

## When Sam says "sync holdings"

Call `mcp__robinhood-trading__get_equity_positions` with the Agentic account number.
Also call `mcp__robinhood-trading__get_portfolio` for cash/buying power.
Map the output to this JSON shape and pipe it to the sync script:

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
