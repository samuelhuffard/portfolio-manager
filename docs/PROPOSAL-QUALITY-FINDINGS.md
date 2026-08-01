# Proposal Quality Findings

**Assessment date:** 2026-07-15  
**Scope:** The current supervised research-to-proposal path, independent of whether
today's market offers an attractive setup.  
**Classification:** Primarily **SKILL**. Fail-closed admission and execution controls
also support **TRUST**.  
**Authority:** This is an assessment and improvement backlog. It does not approve a
code change, alter a Phase 0 gate, or supersede `portfolio-master-plan.md`.

## Bottom line

Code inspection indicates that the current system is capable of producing a real
proposal that survives its evaluator and enters Sam's approval queue. The July 15
review saved three subjective engineering priors:

- **78% prior** that a genuinely qualifying setup will become a valid,
  evaluator-approved proposal.
- **90% prior** that weak, incomplete, stale, malformed, or operationally
  unsafe recommendations will be refused.
- **60% prior** that the first evaluator-approved proposal will already be
  genuinely investment-grade and well calibrated. That last question requires live
  samples and matured outcomes; code inspection cannot prove it.

These dated priors are not measured precision, pass rates, production performance,
statistical confidence intervals, targets, or a claim of investment edge. Prospective
measurement is preregistered in `PROPOSAL-QUALITY-MEASUREMENT-SPEC.md`; future evidence
must not be backfit to these values.

## Evidence considered

- The live production scan dated 2026-07-14 reconciled all **36 attempted reviews**:
  35 explicit investment HOLDs, one stale-data block, zero scan errors, zero budget
  exhaustion, zero evaluator errors, and zero queue failures.
- The live proposal store contained 14 historical records: eight expired and six
  rejected by the human workflow. Sam confirmed these were forced/test-era artifacts,
  not organic output from the current guarded pipeline. None carried the current
  evaluator-approval marker, and none counts as positive-path evidence.
- The full backend test suite was green during readiness verification.
- Code inspection covered candidate selection, data gates, quantitative scoring, the
  generator prompt and parser, deterministic risk checks, evaluator and revision
  handling, sizing, queue creation, approval signatures, and execution boundaries.

## Strong findings

### 1. The system abstains instead of manufacturing activity

The most encouraging live result is not proposal volume; it is the clean 35-HOLD run.
The system accounted for every attempted review without disguising failures as
investment decisions. This is the right behavior for a supervised fund whose cash is
allowed to wait for evidence.

**Value:** SKILL and TRUST. It protects decision quality and makes the observation
period truthful.

### 2. Proposal creation is a layered pipeline

The live path is not an unconstrained model call. It narrows candidates, verifies
required data, computes quantitative context, asks for a structured thesis, applies
deterministic risk rules, sends actionable output to a separate skeptical evaluator,
sizes the surviving action, and only then creates an approval-queue record.

**Value:** SKILL. A proposal must survive multiple independent kinds of scrutiny.

### 3. Automatic controls are downgrade-only and fail closed

Stale or missing data, malformed model output, missing confidence, inadequate risk or
kill-criteria disclosure, fabricated figures, liquidity and concentration failures,
circuit-breaker restrictions, evaluator errors, and unavailable budget capacity all
block or downgrade action. None of these controls may upgrade a recommendation.

**Value:** TRUST. Failure tends toward HOLD rather than unauthorized risk.

### 4. The proposal format encourages falsifiable thinking

The generator must provide a structured action, target weight, thesis, risks, kill
criteria, confidence, and suspect-evidence disclosure. The evaluator separately checks
evidence support, quoted numbers, bear-case seriousness, kill-criteria testability,
mandate fit, and prompt-injection concerns.

**Value:** SKILL. Sam receives a decision that can be challenged rather than a vague
stock pitch.

### 5. The evaluator can demand repair without inventing a better trade

An evaluator may approve, reject, or allow one revision. The generator must address
the critique or concede to HOLD; a second failed revision becomes a rejection. The
evaluator cannot increase confidence, change the action, or add bullish evidence.

**Value:** SKILL and TRUST. This gives a promising thesis one bounded repair attempt
without allowing an endless self-persuasion loop.

### 6. Human authority and execution separation remain intact

An evaluator-approved research proposal is still non-executable. Sam must approve the
exact proposal, approval is signed, the companion validates that signed record, and
fill/accounting logic checks the proposal identity and terms.

**Value:** TRUST. Research quality cannot bypass the human or money controls.

## Confidence limits and unresolved findings

### A. The current positive path is not yet proven in production

The latest scan was operationally healthy but generated no actionable recommendation,
so the evaluator never ran. Historical queue records were forced/test-era artifacts,
not organic proposals. The first genuine generator → evaluator → queue result is still
an observation target.

### B. Evidence breadth is useful but not yet institutional-depth

The generator and evaluator receive Yahoo fundamentals, quantitative history, macro
context, short news excerpts, filing metadata, strategy notes, and durable memory.
They do not yet receive a consistently deep, primary-source packet such as relevant
filing passages, earnings-call evidence, detailed industry economics, or a complete
valuation/re-underwrite model.

### C. Generator and evaluator errors may be correlated

They are separate calls with different instructions, but normally use the same Claude
model family. Prompt separation creates useful skepticism, but not full model diversity.

### D. Two evaluator fields are not hard mechanical vetoes

`numericSpotCheck` and `suspectEvidence` are parsed and recorded, but the final code
path gates primarily on the evaluator's overall verdict. A logically inconsistent
response such as `APPROVE` plus a failed numeric spot-check is not independently
forced to REJECT by deterministic code.

### E. Agent One is more completely encoded than Agents Two and Three

Agent One has catalog discovery and more mature deterministic controls. Agents Two and
Three have strong written v3 mandates, but currently use static watchlists and the same
generic quantitative weight structure. Important mandate-specific concepts—such as
Agent Two's exact macro/peer rules and Agent Three's controlled re-underwrite and
valuation rules—are not all deterministic proposal gates yet.

### F. Unit tests emphasize components more than the complete positive path

Evaluator parsing, risk checks, data gates, candidate slates, budgets, signatures, and
accounting have strong focused tests. There is less direct test coverage of one fully
stubbed candidate traveling through generator → evaluator/revision → sizing → durable
proposal creation as a single flow.

### G. Passing an evaluator is not proof of investment edge

The system can be safe, coherent, and persuasive while still making an investment that
underperforms. Only current-version, point-in-time proposals followed through their
declared horizons can establish calibration or edge.

## Improvement ideas

These are candidates to evaluate from Phase 0 evidence. **Do not implement them merely
to increase proposal volume, and do not lower thresholds to satisfy the sample gate.**

### 1. Make evaluator contradictions fail closed

Deterministically reject an `APPROVE` result when `numericSpotCheck` is `fail` or when
the evaluator reports suspect evidence. Add fixtures for contradictory evaluator JSON.

- **Type:** TRUST
- **Likely value:** High
- **Timing:** Consider after the first live evaluator sample, or immediately only if a
  live contradictory verdict appears.

### 2. Add one complete positive-path contract test

Use stubbed market data, model responses, budget, Redis, and proposal storage to prove:
a qualifying candidate reaches evaluation; REVISE gets exactly one retry; APPROVE
creates one correctly sized proposal; REJECT/error creates none; and duplicate or stale
inputs remain blocked.

- **Type:** TRUST and SKILL
- **Likely value:** High
- **Timing:** Post-observation engineering release unless a positive-path defect is
  observed first.

### 3. Preserve explicit evaluator lineage on each proposal

Store a versioned, immutable evaluator reference with model/policy version, verdict,
revision count, numeric result, suspect-evidence disposition, and evidence-snapshot
identity. Bind that lineage into the later proposal-signature design rather than relying
only on a human-readable risk summary.

- **Type:** TRUST and SKILL
- **Likely value:** High, but schema-sensitive
- **Timing:** The planned Phase 5 proposal-lineage work; not a Phase 0 patch.

### 4. Deepen primary-source evidence selectively

For the small number of candidates that clear cheap screening, provide relevant filing
sections, earnings-call excerpts, source dates, and claim-level citations. Keep strict
freshness and provenance rules; more text without better provenance would reduce rather
than improve quality.

- **Type:** SKILL
- **Likely value:** High
- **Timing:** After evidence-policy questions and cost limits are settled.

### 5. Finish mandate-specific deterministic adapters

Give each specialist its own appropriate universe, evidence requirements, score logic,
and hard gates. Resolve Q-001–Q-004 first so implementation encodes a real investment
policy rather than an engineer's guess.

- **Type:** SKILL
- **Likely value:** High
- **Timing:** Phase 1 and later research packets, under the master plan.

### 6. Measure evaluator calibration instead of assuming it

For every actionable candidate, retain the generator decision, evaluator disposition,
Sam's decision, reason for rejection/approval, and matured outcome under the exact
policy versions. Compare first-pass approvals, revision approvals, evaluator rejects,
and Sam overrides across at least the master plan's required sample.

- **Type:** SKILL
- **Likely value:** Essential for claiming quality
- **Timing:** Begin collecting during Phase 0; draw conclusions only after enough
  current-version samples mature.

### 7. Consider evaluator diversity only if evidence justifies the cost

Possible approaches include a different model family, deterministic citation/number
validators before the model judge, or a second judge only for high-conviction cases.
Measure disagreement and added signal before making this a recurring expense.

- **Type:** SKILL, with TRUST benefits
- **Likely value:** Unknown until measured
- **Timing:** After initial evaluator-calibration data exists.

## Observation decision

This assessment does **not** add a new pre-observation engineering blocker. The correct
next action remains ordinary Phase 0 observation. The first three genuine actionable
proposals should be treated as diagnostic evidence:

1. Did the candidate have complete, current, traceable evidence?
2. Did the proposal state a falsifiable thesis, serious bear case, and testable exits?
3. Did the evaluator approve, request a useful revision, or reject for a defensible
   reason?
4. Did deterministic sizing and risk controls preserve the exact approved idea?
5. Did Sam find the final proposal persuasive without needing facts the system should
   already have supplied?

If those answers are strong, confidence should rise based on evidence. If they are not,
the failures should select the smallest relevant improvement above rather than restart
an open-ended hardening cycle.

Any resulting rate or conclusion must follow
`PROPOSAL-QUALITY-MEASUREMENT-SPEC.md`: forced/manual/legacy proposals are ineligible
for organic throughput, infrastructure outcomes cannot become investment HOLDs, and a
material version change opens a separate cohort.
