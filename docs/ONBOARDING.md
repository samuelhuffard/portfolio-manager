# Portfolio Manager — Agent Onboarding

For a shared, Git-tracked orientation and the collaboration/documentation rules, start with [`AGENT-CONTEXT.md`](AGENT-CONTEXT.md). This onboarding guide then provides the system mental models.

You are a fresh agent about to work on this system. This doc exists because the codebase's complexity is not in any single file — it's in how three runtimes, two hand-mirrored schema copies, and one irreversible action (placing a real-money order) interact. Read this before anything else; it tells you what to load next and which mental models prevent the bugs that have actually happened here.

## What this system is, in one paragraph

An AI portfolio research + execution system managing real (small, friends-and-family) money in a Robinhood "Agentic" account. Three research agents scan markets nightly and queue BUY/SELL **proposals** into a Redis approval queue. Sam approves them in a Clerk-gated Next.js dashboard; approval attaches an HMAC signature. A PM2 process on Sam's Mac (the "companion") executes signed approvals through the Robinhood MCP, records fills into a Google-Sheet ledger with FIFO tax lots, and reconciles anything ambiguous against the broker. Outside investors own NAV-denominated units of the pool via an append-only, HMAC-signed investor ledger.

## Reading order

1. This file.
2. `docs/INVARIANTS.md` — the 11 rules you must not break. Non-negotiable.
3. `docs/ARCHITECTURE.md` — the full data-flow map.
4. `docs/CHANGE_MAP.md` — before you edit anything, find your change type here; it lists exact files and the gotchas that already bit us.
5. `docs/RISK_REGISTER.md` + `docs/TEST_PLAN.md` — what's still fragile and where coverage is thin.
6. If touching execution: `EXECUTION-GUIDE.md` and `scripts/mac-companion.mjs` + `scripts/companion-core.mjs` (dashboard repo).

## The seven mental models that prevent real bugs

**1. There are THREE runtimes and they don't share code — they share stores.**
Jetson backend (this repo), Vercel dashboard (`../portfolio-dashboard`), Mac companion (`../portfolio-dashboard/scripts/mac-companion.mjs`, but it shells into THIS repo's scripts via a `../../portfolio-manager` sibling path). A change that "works" in one runtime can silently break the contract another runtime relies on. The proposal schema exists in three hand-written copies; the Sheets schemas in two. **Every schema change ships to all copies in one commit** — checklist at the bottom of CHANGE_MAP.

**2. A proposal's life is a one-way street with a signed toll gate.**

```
research scan ──┐
exit monitor ───┼─► Pending ──48h──► Expired
dashboard form ─┘      │
                 (FundManager decides — one-way, signed)
                       ├─► Rejected
                       └─► ApprovedForBrokerReview  + decisionHmac
                                  │ companion verifies signature
                                  ▼
                            executionState: "Executing"   ← set BEFORE the order
                                  │ place_equity_order(ref_id = proposal.id)
                                  │ record ledger row ← BEFORE fulfillment
                                  ▼
                            fulfilledAt + fulfilledOrderId
        (crash anywhere → next poll RECONCILES against the broker, never re-executes)
```

If you change anything in this flow, the ordering IS the safety mechanism: Executing-before-order, ledger-before-fulfill, ref_id idempotency, signature-before-broker. Each ordering exists because its inverse double-traded or ghost-filled in testing.

**3. Money math lives in pure functions; jobs are just plumbing.**
`lib/tax-lots.js`, `lib/proposal-sizing.js`, `lib/mcp-accounting.js`, `lib/risk-engine.js`, `lib/investor-ledger.js`, `lib/reconcile.js`, `lib/ledger-verify.js` are pure and tested (~100 tests). The jobs (`jobs/*.js`) do I/O and call them. Put new logic in a pure lib WITH a test, then wire it in. Never inline money math into a job.

**4. The AI is an untrusted reasoner sandwiched between deterministic layers.**
data gates → quant score → AI → risk engine → sizing caps → human approval. The AI's output can only ever be *downgraded*. Corollaries: a missing field in model output must FAIL the check that reads it (a missing `confidence` once bypassed the confidence floor); model-reported execution results are sanity-checked (UUID orderIds) and reconciled against the broker; news/scan/memory text entering prompts is untrusted input.

**5. Google Sheets is the database AND a human-visible artifact — treat every read/write as racy.**
Holdings is clear+rewritten by two writers; ledger tabs are append-only; lot updates write by row index captured at read time (a human sorting the Sheet would corrupt lots); parsing relies on sentinel strings ("Cash", "Last synced"). Never hand investors edit access. Long-term plan is Postgres with Sheets as an export — until then, respect the append-only discipline and never "fix" a ledger row in place (append a correction).

**6. Failure must be loud, in proportion to how money-adjacent it is.**
The historic bug class here is the silent no-op: missing env → quiet null → "scan ran, zero proposals, nobody noticed for 3 days." Rules: pipeline OUTPUT paths log errors and Telegram (`lib/telegram.js`); security checks fail CLOSED (`server.js` auth, signature verification); `/health` reports dependency truth (503 when broken). When adding a failure path ask: "if this fires at 5 PM and nobody is watching, does anyone find out?"

**7. Check runtime reality before reasoning from code or memory.**
`git status -sb` both repos (deploy drift has happened — origin once ahead of local from an archive deploy). Check PM2 log **mtimes** before treating errors as current. Check env presence per machine (`grep -c "^VAR=" .env`) — local ≠ Jetson ≠ Vercel ≠ companion cascade. `curl localhost:3200/health` on the Jetson tells you dependency truth directly.

## Vocabulary (terms that mean something specific here)

- **Agent One / agent-1** — the only real-money mandate (aggressive tech growth, v5 memo). agent-2/3 are research-only.
- **Proposal** — a sized BUY/SELL *request* in Redis. Not an order. Never an order.
- **Companion / executor** — the Mac PM2 process (`portfolio-executor`) that turns signed approvals into MCP orders.
- **decisionHmac** — the approval signature. Its payload is frozen across three implementations; `tests/companion-core.test.ts` cross-checks them.
- **Unattributed** — a ledger fill that matched no proposal (e.g. manual trade). Legitimate but should be rare.
- **NAV/unit** — pooled-fund accounting: investor value = units held × (totalValue ÷ unitsOutstanding).
- **Starter sizing** — below $500 account value, concentrated slots replace percentage sizing.
- **Red-lines** — dashboard wording/route filter. Advisory only; the real control is architectural (no execution route exists).

## Things that look wrong but are deliberate

- `store_session=True` inside `robinhood-sync.py` — works around a robin_stocks return-value bug; the pickle is deleted afterward unless env opts in (tested).
- Holdings sync only 5×/day — each run is a full Robinhood login; more trips the anti-automation device challenge.
- The Sheet tabs Agent-1/2/3 are unstyled — investor-facing presentation lives in the dashboard, per Sam's call.
- The dashboard keeps working when the Jetson is down — it reads Sheets/Redis directly; only /api/scan + alerts proxy to :3200. Preserve this.
- SELL fills may undershoot the proposal amount — the executor sells the whole remaining position when it's worth less than proposed.
- `quant-ai` repo is dormant on purpose; `First-Repository` was deleted (superseded).

## Before you commit — the five checks

1. Both test suites (`npm test` here; `npm test && npm run lint && npm run build` in the dashboard).
2. If you touched a shared contract: the CHANGE_MAP cross-repo checklist.
3. If you added a config key: grep that code consumes it.
4. `git status` + diff scan for secrets/env files.
5. If you changed behavior described in `docs/` — update the doc in the same commit. Stale docs are worse than none.
