# Proposal Quality Measurement Specification

**Specification version:** `proposal-quality-measurement-v1`  
**Preregistered:** 2026-07-16  
**Status:** prospective measurement design; no production result or promotion authority  
**Scope:** supervised research from candidate admission through matured proposal outcome

## 1. Purpose and non-claims

This specification defines how future current-version proposal-quality evidence is
counted. It does not change a mandate, scoring rule, evaluator rule, candidate policy,
freshness limit, cost assumption, or promotion gate.

The July 15 values of **78%**, **90%**, and **60%** are dated subjective engineering
**priors**. They are not measured precision, pass rates, production performance,
confidence intervals, targets, or evidence of investment edge. Future observations
must not be backfit to these priors.

The specification preserves three distinctions:

1. a model's investment abstention is different from unavailable or degraded research;
2. a coherent evaluator-approved proposal is different from a profitable investment;
3. safety evidence on the TRUST clock is different from proposal-quality evidence on
   the SKILL clock.

## 2. Unit of observation and qualifying setup

The base observation is one candidate-agent review attempt at one decision time. A
review is a **qualifying setup** only when all of the following are true before the
generator decides:

- `origin` is `organic`: the normal scheduled or explicitly declared shadow pipeline
  selected the candidate under the active candidate policy, without an operator
  choosing the security to exercise a path or bypassing an admission rule;
- it is not forced, manual, smoke, test, replay, seeded, backfilled, or a legacy record;
- agent identity and every required version identity in section 3 are present;
- the evidence snapshot is point-in-time, traceable, within the accepted freshness
  policy, and complete enough to be actionable under the active mandate;
- no provider, budget, parser, queue, duplicate, ownership, or stale-data degradation
  has already prevented the normal investment decision; and
- the observation/run identity is durable and unique.

An organic review can be non-qualifying. Its exclusion or degradation still counts in
the appropriate operational denominator; it cannot disappear and cannot be relabeled
as an investment `HOLD`.

Forced, manual, and legacy proposals are always ineligible for organic throughput,
approval-rate, and investment-outcome claims. They may appear in a separately labeled
test or historical inventory, never in a current organic cohort.

Holdings and mandatory re-underwrites are retained as separately labeled strata. They
cannot support a claim about non-holding discovery-policy quality.

## 3. Required record and version identity

Each observation must retain these fields or an immutable reference to them. A missing
required field makes the setup `excluded_version_or_lineage_missing` for comparable
proposal-quality rates.

| Group | Required fields |
| --- | --- |
| Identity | observation ID, research run ID, decision timestamp, security ID, agent ID |
| Origin | organic/forced/manual/legacy/test classification, selection reason, holding or mandatory-review status |
| Policy versions | mandate, evaluator policy, evaluator model, generator policy/model, scoring, candidate policy, universe policy |
| Evidence | evidence snapshot ID/hash, evidence-schema version, source timestamps, freshness status, completeness/actionability status |
| Degradation | provider, budget, parsing, queue, duplicate, ownership, stale-data, and other operational status with explicit reason code |
| Decisions | generator action, first evaluator disposition, revision count, final evaluator disposition, contradiction and suspect-evidence flags |
| Queue and human | proposal creation status/ID, Sam's decision and timestamp, expiry or rejection reason code |
| Outcome | horizon and benchmark policy versions, maturity status, gross and benchmark-relative result, cost-policy version and net-result availability |

The exact cohort identity is the complete version tuple, not merely a date or commit.
A material change to mandate, scoring, evaluator, candidate selection, freshness,
benchmark, outcome, or cost semantics opens a separate cohort. Evidence from distinct
cohorts must not be pooled unless a comparability rule was written before results were
examined. Agent 1, Agent 2, and Agent 3 are always reported as separate mandate
cohorts, even when an additional explicitly declared aggregate is shown.

## 4. Admission, outcome, and exclusion taxonomy

Admission eligibility and terminal outcome are separate fields. Each attempted review
receives one eligibility verdict (`eligible` or `excluded`) with zero or more explicit
reason codes, and exactly one terminal research outcome. The existing durable outcome
allowlist remains authoritative. This specification adds one forward-only canonical
outcome name: `generator_degraded`, covering explicit generator parse, truncation,
schema, or missing-required-field degradation. It must not be inferred from rationale
text or applied retroactively to legacy rows.

Eligibility reason groups include non-organic origin, stale/blocked data,
provider/budget/generator degradation, unknown classification, missing version or
lineage identity, and other explicitly declared non-comparability. Forced, manual,
legacy, seeded, replay, and test origins are distinct reasons rather than one inferred
category.

Unknown, contradictory, and legacy-insufficient records remain visible and excluded
from comparable rates. Existing terminal outcomes such as `investment_hold`,
`data_gate`, `stale_data`, `budget_exhausted`, `review_error`, `evaluator_error`,
`risk_downgrade`, `duplicate`, `proposal_blocked`, `queue_error`, `paper_only`, and
`proposal_created` retain their current meanings.

Infrastructure failures, stale inputs, budget exhaustion, and `generator_degraded`
outcomes are not generator abstentions. They are reported against attempted reviews
and are never added to the denominator or numerator for investment `HOLD` quality.

## 5. Preregistered funnel measurements

Each rate must display its numerator, denominator, exclusions, cohort identity, and
uncertainty interval. A zero denominator is `unavailable`, never 0%.

| Measurement | Numerator | Denominator |
| --- | --- | --- |
| Generator action rate | qualifying setups with generator `BUY` or `SELL` | all qualifying setups reaching a valid generator decision |
| Investment abstention rate | qualifying setups with generator `HOLD` | all qualifying setups reaching a valid generator decision |
| Evaluator disposition | each of first-pass `approve`, `revise`, `reject`, or `error` | valid generator non-HOLDs admitted to evaluation |
| First-pass approval | first evaluator response is `approve` | valid generator non-HOLDs admitted to evaluation |
| Post-revision approval | final `approve` after exactly one permitted revision | first-pass `revise` responses that receive the permitted revision |
| Final evaluator result | final `approve`, `reject`, or `error` | all valid generator non-HOLDs admitted to evaluation |
| Evaluator contradiction | parsed evaluator response with internally contradictory action/verdict or failed numeric check | all successfully parsed evaluator responses |
| Suspect evidence | parsed evaluator response flags suspect evidence | all successfully parsed evaluator responses |
| Proposal creation | one durable proposal created | final evaluator approvals eligible for queue creation |
| Sam disposition | each of approved, rejected, or expired | organic evaluator-approved proposals successfully created and presented to Sam |
| Matured gross result | matured gross result present | organic proposals whose predeclared horizon has elapsed and required price data is available |
| Matured relative result | matured benchmark-relative result present | same as above with the predeclared benchmark available |
| Matured net result | matured net result under the exact accepted cost policy | matured comparable proposals whose cost-policy version matches accepted Q-007 policy |

Evaluator `approve`, `revise`, `reject`, and `error` counts must conserve the admitted
evaluator denominator. Proposal creation failures remain queue/control outcomes, not
evaluator rejects. Sam's rejection and expiry remain genuine human-workflow outcomes,
not evaluator failures.

## 6. Operational and exclusion denominators

For every run and agent, first report all attempted reviews. Then report separate
counts and rates, each over attempted reviews, for stale data, data-gate blocks,
provider degradation, budget exhaustion, generator degradation, review errors, evaluator
errors, duplicate blocks, ownership blocks, proposal/queue failures, unknown outcomes,
and explicit exclusions.

These categories are also reported as raw counts when the rate is not decision-eligible.
Outcome conservation must hold before any funnel rate is published. Failure to conserve
the attempted-review total makes the run non-classifiable rather than partially usable.

Outcome maturity is reported separately as `matured`, `immature`, `unavailable`, or
`excluded`. Missing future prices or benchmark data are unavailable, not zero returns.
Repeated snapshots of one proposal/outcome remain one sample; snapshot coverage is
reported separately.

## 7. Hypotheses

The following are directional hypotheses, not observed findings:

- **H1:** a future R1 change increases the generator non-HOLD rate among qualifying
  setups without increasing stale, degraded, unknown, or operational-failure rates.
- **H2:** a future R1 change increases final evaluator approval among generator
  non-HOLDs without increasing contradictions or suspect-evidence frequency.
- **H3:** bounded revision converts some first-pass `revise` decisions to approval
  without increasing contradiction or suspect-evidence frequency.
- **H4:** evaluator-approved organic proposals are approved by Sam more often than
  evaluator-rejected or non-admitted candidates would be under a predeclared,
  point-in-time comparison design.
- **H5:** matured organic proposals have favorable gross and benchmark-relative
  outcomes under predeclared horizons. This remains unproven until mature samples
  exist.
- **H6:** any net-result or alpha claim is unavailable until Q-007 is accepted, exact
  cost-policy versions match, and the applicable samples mature.

H1–H3 are process-quality hypotheses. H4 is a supervised-decision hypothesis. H5–H6
are investment-outcome hypotheses. Passing an earlier hypothesis does not imply a
later one.

## 8. Sample and uncertainty rules

- Collection and conservation reporting begin with the first observation. No minimum
  sample is required to disclose a failure, exclusion, negative result, or null result.
- The canonical Phase 6 minimum remains exactly the master plan's requirement: a
  meaningful current-version sample of at least 30 evaluator-graded actionable
  proposals, plus mature outcomes appropriate to each mandate. This specification does
  not reinterpret that requirement as 30 proposals per agent or as a universal minimum
  for every funnel denominator.
- Each future R1 comparison addendum must preregister the minimum sample for its primary
  measurement before results are examined. Until that declared minimum is reached, the
  comparison is descriptive and labeled `insufficient_sample`; the addendum cannot use
  a smaller post-hoc minimum because early results look favorable.
- Binary rates report a two-sided 95% Wilson interval alongside numerator and
  denominator. Comparisons report the absolute rate difference and its predeclared
  uncertainty method; point estimates alone are insufficient.
- Matured continuous outcomes report sample count, missing/excluded count, median,
  dispersion, and a two-sided 95% interval produced by a method declared before the
  cohort is examined. Small or dependent samples must not be presented as independent.
- Negative and null results receive the same prominence as positive results. All tested
  versions and all three agent cohorts remain visible; no best-version-only reporting.
- Agent 1, Agent 2, and Agent 3 counts and results are always reported separately beside
  any pooled current-version aggregate. A pooled result cannot support an agent-specific
  conclusion or a claim that the effect generalizes across all mandates when one or more
  agent strata are sparse. This specification sets no binding per-agent minimum; any
  such threshold is an unresolved future preregistration decision.
- The master plan's 30-proposal minimum is not proof of investment edge.
  Horizon-appropriate mature outcomes and the remaining Phase 6 gates still apply.

## 9. Version breaks and comparison decisions

Before a future R1 comparison begins, its addendum must name the changed version,
baseline version, affected agent cohorts, primary funnel measurement, diagnostic
measurements, minimum sample, observation period, and any non-inferiority tolerance.
Those choices cannot be made after viewing results.

At the declared minimum sample:

- **Keep** is justified only when the primary process measurement improves with the
  preregistered uncertainty criterion, conservation holds, and no safety/integrity or
  preregistered degradation guardrail fails.
- **Revise** is the result when evidence is mixed, intervals remain inconclusive,
  implementation degradation obscures investment behavior, or one mandate cohort
  materially disagrees with the aggregate.
- **Reject/roll back** is justified when the primary process result materially worsens,
  contradictions or suspect evidence violate the preregistered guardrail, outcome
  conservation fails, or the change weakens a safety/control boundary.

This base specification intentionally supplies no effect-size target or degradation
tolerance. Those are change-specific measurement choices, not Q-001–Q-007 investment
policy answers, and must be preregistered in the future comparison addendum.

## 10. Q-007 and claim limits

Q-007 remains open. Gross and benchmark-relative outcomes may be recorded under their
exact horizon and benchmark versions. Base-cost or stressed-cost net fields remain
`unavailable` unless Q-007 has an accepted policy and the sample carries the identical
cost-policy version.

No proposal count, evaluator approval, Sam approval, backtest, shadow comparison, or
satisfaction of the master plan's 30-proposal minimum establishes investment edge.
Net return, alpha, calibration, or promotion claims require mature current-version
samples, accepted policies, point-in-time integrity, appropriate benchmarks, and the
master plan's independent promotion review.

## 11. Report checklist

Every report must include:

- specification version, code revision, cohort tuple, dates, and evidence class;
- attempted-review conservation and explicit unknown/excluded counts;
- numerator, denominator, interval, and minimum-sample state for every rate;
- Agent 1, Agent 2, and Agent 3 results separately;
- first-pass and post-revision evaluator outcomes separately;
- maturity, missingness, benchmark, and Q-007/net availability;
- all version breaks and any predeclared comparability rules; and
- the exact conclusion vocabulary: `descriptive`, `insufficient_sample`, `keep`,
  `revise`, `reject`, or `not_assessed`.

Local, synthetic, forced, manual, and legacy fixtures prove mechanics only. They never
count as organic production evidence or as observation-period TRUST/SKILL evidence.
