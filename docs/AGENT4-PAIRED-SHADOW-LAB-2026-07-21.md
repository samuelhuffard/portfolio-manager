# Agent 4 Paired-Shadow Lab — 2026-07-21

**Status:** Packet D substantive offline laboratory; no runtime activation  
**Reproduction:** node --test tests/agent4-paired-shadow-lab.test.js

The lab replays twelve immutable fixture pairs through the existing pure shadow
engine. It covers all three specialists; accepted-within-bound BUY and owned SELL;
duplicate thesis; cash, gross, concentration, and budget breaches; stale and
mismatched snapshots; unowned SELL; a different horizon; and Sam disagreement.

Every record has a proposal and full-request fingerprint, a version, policy version,
Agent 4 result, virtual effect, and Sam label. Two cases deliberately abstain because
the fixture policy does not own duplicate-thesis or disagreement treatment. Every
numeric fixture policy field is marked fixture_only_policy_unresolved, so no test
number is represented as a policy decision.

The test reruns the catalog deterministically and asserts the 12-case count, all
three specialist IDs, ACCEPT/REJECT/ABSTAIN coverage, and null approval HMAC, order
intent, queue mutation, and cash reservation for every record.
