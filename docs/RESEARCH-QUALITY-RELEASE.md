# Research Quality Release Candidate

**Status:** offline release candidate; not deployed or activated  
**Base:** `7aba558`  
**Change class:** R1 — aggregate research reporting only

## Purpose

The current research scan already records conserved, structured outcome categories.
This packet makes the resulting report useful to an operator without treating every
non-proposal as an investment HOLD.

It adds one aggregate-only quality summary with six mutually exclusive buckets:

1. investment judgments (`investment_hold`);
2. unavailable data (`data_gate`, `stale_data`);
3. operational degradation (budget, review, evaluator, or queue failure);
4. decision blocks (evaluator rejection, risk downgrade, duplicate, blocked, or paper-only);
5. created proposals; and
6. unknown outcomes.

The bucket total must equal the number of attempted reviews. The report contains no
ticker, rationale, prompt, evidence text, or proposal payload.

## Explicit non-effects

- Does not alter candidate selection, research prompts, thresholds, evaluator policy,
  proposal creation, approval, signatures, execution, accounting, or broker access.
- Does not write Redis, Sheets, Postgres, a ledger, or a local artifact.
- Does not change the Phase 0 observer or safety-window pass/fail meaning.

## Verification

```sh
node --test tests/research-run-report.test.js
npm test
```

## Post-observation release decision

This packet is suitable for review with other R1 research-quality work after the
five-day safety observation. Any later API or dashboard presentation must consume
only this aggregate-safe projection and retain the same conservation invariant.
