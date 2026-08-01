# Local Proposal-Quality Harness

**Status:** substantive Packet A evidence; local/offline only  
**Version:** proposal-quality-local-v1  
**Master-plan alignment:** Phase 0 SKILL diagnosis / H2; does not advance Phase 0

## Boundary

The harness is deliberately a pure module:
[lib/proposal-quality-local.js](../lib/proposal-quality-local.js). It has no
module imports, so it cannot reach an SDK, environment, network client, scheduler,
store, broker, approval path, signature path, or proposal writer through its import
closure. It accepts only a supplied fixture record and returns diagnostics; it does
not emit an actionable proposal or mutate a record.

[tests/proposal-quality-local.test.js](../tests/proposal-quality-local.test.js)
parses the module's actual ES-module import specifiers and requires an empty set.
This replaces the held fbe96f9 adapter, whose AI-overlay import constructed an
Anthropic client.

## What it checks

- business-family classification against the supplied sector/industry;
- rank labels being described as raw performance or valuation metrics;
- citation IDs resolving to the locally supplied enriched evidence;
- a deterministic, conserved aggregate across fixture cases.

The included fixture corpus is synthetic and explicitly non-promotional. Its output
is a diagnosis of evidence handling, not a benchmark, backtest, investment claim,
policy threshold, or observation sample.

## Reproduction

Run node --test tests/proposal-quality-local.test.js, then npm run
proposal-quality:local.

The current fixture result audits three cases: two are blocked for false
classification/rank-as-fact claims, and one filing-backed case is review-ready. This
means only that its supplied evidence is internally consistent; it is never an
approval, order intent, or promotion result.
