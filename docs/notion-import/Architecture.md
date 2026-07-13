# Architecture — Portfolio Manager

## Control model

```text
Agent 1 / Agent 2 / Agent 3
  mandate + evidence -> exact BUY / SELL / HOLD proposal
                              |
                              v
                         Agent 4 (shadow)
  performance + holdings + macro + portfolio risk -> accept / reject only
                              |
                              v
            Sam approval -> signed immutable OrderIntent
                              |
                              v
 deterministic Mac executor -> Robinhood MCP -> append-only ledger
                              |
                              v
                 reconciliation + dashboard + monitoring
```

## Runtime and data map

| Component | Responsibility | Authority |
| --- | --- | --- |
| Jetson backend (`portfolio-manager`) | Scheduler, research, jobs, contracts, ledgers | Research/proposal generation; no autonomous broker orders |
| Dashboard (`portfolio-dashboard`) | Review, visibility, manager UI | Human decision surface; fail-closed access control |
| Mac companion | Structured MCP broker reads and signed execution | Executes only a valid, unused, unexpired human-approved order |
| Google Sheets + Redis | Current operating path during migration; Sheets is the future reporting projection | Authoritative during the gated dual-write/shadow-read period |
| Neon Postgres | Active financial dual-write, shadow reads, migrations, and daily parity evidence | Destination for canonical accounting; no money-decision reads until the explicit cutover gate |
| Robinhood MCP | Broker read and supervised execution boundary | Broker truth for reconciliation |

## Binding invariants

1. Specialists can propose but never execute or approve their own proposal.
2. A BUY creates strategy-owned lots; only the owning specialist may propose a SELL or reduction.
3. Agent 4 cannot originate a trade, alter ticker/side/size, or force a sale. It may only accept/reject the exact specialist proposal under policy.
4. Deterministic global controls may block, shrink, expire, or demote an order; they cannot invent one.
5. Risk controls are downgrade-only; untrusted evidence is fenced; missing model data fails closed.
6. Money math is pure, tested, and separated from I/O jobs.
7. Ledgers are append-only and signed; corrections are new events.
8. Execution ordering is immutable: `Executing` marker → broker order → ledger record → proposal fulfillment, with proposal ID as broker reference.
9. Reconciliation, signature, contract, heartbeat, stale-state, or risk anomalies demote operation to human-supervised mode.

## What is deliberately not true yet

- Postgres is not canonical.
- Agent 4 has no runtime approval key, decision-write endpoint, scheduler, or order authority.
- Agents 2/3 are not permitted to produce actionable proposals.
- The system is not a fund and does not manage outside capital autonomously.

Source: `docs/ARCHITECTURE.md`, `docs/INVARIANTS.md`, `docs/AUTONOMY-ROADMAP.md`.
