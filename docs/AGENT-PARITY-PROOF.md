# Agent Parity Proof and Cohort Telemetry

Status: versioned contract foundation; production wiring is owned by the parity
release integrator.

## Purpose

These contracts let a scheduled research run prove two different facts without
confusing them:

1. **Mechanical workflow parity:** Agents 1, 2, and 3 are wired through the same
   candidate bus, selection machinery, research packet, proposal queue,
   independent evaluator, downgrade-only risk engine, human approval boundary,
   ownership attribution, signed approval, ledger path, and holding-coverage
   contract.
2. **Mandate-data completeness:** each agent's different mandate has complete,
   sourced inputs for its catalog screen, evidence adapter, scoring, entry
   policy, holding monitoring, re-underwriting, and add accounting.

The first can pass while the second fails. That distinction is intentional: a
shared pipeline does not make missing Agent 2 trend history or Agent 3 valuation
history complete.

Neither result determines whether a Phase 0 day counts. Only the signed Phase 0
observer owns that decision. These artifacts contain no observation-eligibility
field and do not promote authority.

## Runtime integration

For each scheduled run, the live research scan should:

1. Build one `agent-parity-workflow-receipt-v1` per required stage and agent from
   the implementation/config identities actually loaded by that run. Organic
   runtime receipts must carry the content hash of the persisted terminal job
   receipt for that exact run.
2. Build one `agent-parity-data-receipt-v1` per mandate-data area and agent from
   the point-in-time evidence snapshot actually used. Organic data receipts link
   the same terminal job receipt. `partial`, `unavailable`, and
   `policy_unresolved` remain blockers with stable reason codes.
3. Resolve Agent 1, Agent 2, and Agent 3 discovery independently through
   `resolveDiscoveryActivation()`. A missing catalog/candidate-bus proof or an
   emergency switch produces an explicit fixed-watchlist rollback receipt. It
   cannot alter approval, risk, ownership, signature, or ledger controls.
4. Build one `agent-parity-cohort-packet-v1` per agent after the run. Its funnel
   must conserve catalog, selection, selection buckets, attempted reviews, and
   terminal outcomes.
5. Convert packets to deterministic telemetry events for append-only
   persistence, then create one aggregate-safe daily report. Organic and
   synthetic/test evidence are always separate sections.

The integration must use actual run IDs, code revisions, content-derived config
identities, cohort versions, usage records, and holding receipts. The assessor
must receive `verifiedRuntimeRunReceiptHashes` from an independent read-back of
the retained terminal job evidence. Merely supplying a plausible hash in a
workflow receipt does not pass mechanical parity. Do not create receipts merely
because a module exists on disk.

## Telemetry contents

Per-agent packets include:

- versioned catalog, eligibility, attention, mandate, prompt, evaluator,
  classifier, and code cohort identity;
- catalog/selection/review funnel with exact conservation;
- generator/evaluator call counts, success/failure/denial counts, tokens,
  cache hits, priced cost completeness, protected-capacity use, and p50/p90
  latency;
- explicit generator/infrastructure degradation reason counts;
- holding monitoring coverage with silent-skip and reason conservation;
- aggregate near-miss counts by deterministic blocker, stage, and strength
  band;
- hashes of the workflow, mandate-data, and rollback receipts used.

The daily report contains counts, versions, hashes, and bounded reason codes
only. It rejects ticker, company, rationale, thesis, prompt, evidence, account,
investor, email, cookie, or secret fields.

## Fail-closed properties

- Missing, duplicate, modified, cross-run, cross-revision, or mismatched
  receipts cannot assemble a complete proof.
- The same shared stage must use the same implementation, interface contract,
  code revision, and common configuration identity for all three agents. It
  must also match the reviewed canonical implementation registry; three agents
  consistently reporting the wrong module still fail.
- Mandate adapters may differ, but each data area must use the same interface
  contract and point-in-time evidence-snapshot version.
- Synthetic common-path tests can prove the shared contract but can never
  masquerade as organic runtime wiring.
- Organic and synthetic receipts may coexist for the same agent/stage, but are
  keyed and assessed independently.
- Organic mechanical parity remains false until the linked terminal job receipt
  hash is independently supplied as verified runtime evidence.
- Unknown latency, cost, token, cache, holding, or cohort evidence remains
  explicit; it is not rendered as a healthy zero.
- A near miss is observation only. It cannot create, improve, or queue a
  proposal.

## Files

- `lib/agent-parity-proof.js` — receipts, assessor, and rollback contract.
- `lib/agent-parity-telemetry.js` — funnel/capacity/near-miss/holding packets,
  deterministic events, and daily aggregate report.
- `tests/agent-parity-proof.test.js` — receipt adversaries, runtime-link
  enforcement, and a supplemental source/functional common-path test across all
  three agent IDs. Source matching is not live-wiring proof.
- `tests/agent-parity-telemetry.test.js` — conservation, privacy, cost/latency,
  organic-vs-synthetic, and deterministic event/report coverage.
