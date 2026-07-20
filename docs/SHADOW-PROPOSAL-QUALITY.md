# Local proposal-quality shadow harness

This is a local, read-only research-quality tool. It is deliberately outside the
scheduler and has no network, model, Redis, Sheets, approval, signature, or
execution access. Running it cannot create a proposal, alter a scheduled run,
or affect the Phase 0 observation clock.

Run the bundled regression cases:

```bash
npm run proposal-quality:shadow
```

Or pass a local JSON file containing `{ "cases": [...] }`:

```bash
node scripts/proposal-quality-shadow.mjs /absolute/path/to/cases.json
```

Each case supplies a draft proposal, its candidate classification, a baseline
packet, and an enriched packet. The report says only whether deterministic
evidence checks make an actionable draft `review_ready` or `blocked`; it is not
an investment opinion and never promotes, approves, signs, or queues a trade.

The bundled cases are distilled regressions for the observed failure classes:
false business classification/rank-as-raw valuation (DAVE), rank-versus-raw
momentum confusion (SNDK), and an adequately sourced filing claim (MU).

Use the report during observation to distinguish a genuine investment HOLD from
an evidence-limited candidate. Any future packet change remains local until its
separate review and deployment decision; it must not be slipped into Phase 0.

## One-off fresh-data MU test

`npm run proposal:shadow:mu` fetches current MU market data and recent SEC
filing metadata, then makes at most one generator and one independent evaluator
model call. It prints the result locally and has no Redis, Sheets, proposal
queue, approval, signature, or execution import. It is not a scheduled job and
does not count as Phase 0 evidence.
