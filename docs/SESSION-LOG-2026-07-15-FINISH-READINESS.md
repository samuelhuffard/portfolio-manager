# Session Log — Portfolio Manager Finish Readiness

**Date:** 2026-07-15 ET  
**Scope:** Phase 0 gate closing, credential rotation, dashboard recovery,
production cash correctness, readiness assessment, and the next analytical-depth
roadmap  
**Production authority:** Human-supervised throughout. No proposal was approved,
signed, or executed by an agent during this work.

## Outcome

Portfolio Manager reached a stable production checkpoint suitable for attempting a
fresh Phase 0 observation window. The backend and dashboard defects discovered
during final readiness work were repaired and deployed before a countable day.
July 15 does not count because credential-rotation Redis failures occurred earlier
in the day and the cash-reader repair was an S2 deployment. July 16 is the first
candidate Day 1 if all scheduled evidence and the signed observer pass.

The production release is now frozen for Phase 0. New analytical-depth work may be
built on an isolated branch or worktree, but it must not be merged or deployed
during the observation window unless a validity-breaking TRUST defect requires an
emergency repair and declared reset.

## Changes completed

### Backend and observation controls

| Change | Label | What changed and why it matters |
| --- | --- | --- |
| Phase 0 observer branch correction | TRUST | Due-but-missing Mon–Thu research now fails instead of being misclassified as no sample due; valid no-due days can still pass; unreadable history is insufficient evidence. This makes the clock fail closed. |
| Fail-closed Anthropic budget | TRUST | `ANTHROPIC_BUDGET_REQUIRED=true` makes missing or invalid monthly ceilings refuse calls. Responses without complete token usage settle at the full reservation rather than appearing free. This protects the approved budget. |
| Dedicated operational-ledger signing path | TRUST | New rows use the dedicated operational secret, while explicit legacy verification preserves retained historical records during rotation. The unattested hard-delete reconciliation path was removed. |
| Athena explicit opt-in | TRUST | Athena remains disabled unless `ATHENA_ENABLED=true`; merely having credentials cannot activate it. Athena degradation therefore cannot unexpectedly alter the Phase 0 baseline. |
| Portfolio-breaker capital-event repair | TRUST | Daily high-water NAV/unit is derived from the final valid signed performance row for the date, preventing a contribution timing transition from creating a false drawdown halt. |
| Research-memory filtering | SKILL/TRUST | Dashboard/workflow preferences remain stored but are excluded from investment prompts. Genuine investment lessons remain eligible. This prevents irrelevant directives from contaminating analysis. |
| HTTP and provider-error hardening | TRUST | The shadow endpoint resolves before writing headers, preventing double responses. Yahoo failures are reduced to bounded summaries instead of leaking large internal error pages into logs or clients. |
| Formatted-cash reader repair | BOTH | Holdings money readers request unformatted numeric values. The live research path now sees `$85` available cash rather than converting `"$85.00"` to `NaN` and then zero. Market-value and return readers use the same correct numeric handling. |

The formatted-cash release is backend commit `9517be1`. Its full suite passed
750/750, it was pushed to aligned `main` and `mandate-v3`, and deployed through the
signed `52→53` restart edge. Sanitized production verification showed health 200,
all required dependencies true, `$85` cash, `$0` approved-BUY reservation, and
`$85` available cash.

### Dashboard and companion recovery

| Change | Label | What changed and why it matters |
| --- | --- | --- |
| Cash-flow-adjusted performance charts | SKILL/TRUST | Portfolio charts again separate investment performance from deposits and withdrawals. Contributions no longer appear as investment gains or extreme jumps. |
| Operational-ledger legacy verification | TRUST | Command and Positions can verify the retained operational record using the dedicated current secret plus the explicit legacy chain, resolving the one-row mismatch without weakening the other ledgers. |
| Companion MCP evidence preservation | TRUST | The companion records sanitized read evidence through its stream instead of losing it, allowing the Agents page and observer to prove the execution companion is online. |
| Sanitized companion diagnostics | TRUST | Companion diagnostics retain useful status and receipt evidence without recording secrets or private payloads. |

The current dashboard repository head at this checkpoint is `2af23c4`. The working
tree was clean when checked.

## Credential and security work

The session worked through a staged rotation worksheet without copying secret
values into repository documentation. The affected classes included Robinhood
credentials/TOTP, Upstash, the shared webhook, Anthropic, Telegram, remaining
application/database credentials, and HMAC secrets through the legacy-verification
migration path. The operational current and legacy verification variables were
added to Vercel Production without replacing the separate audit or investor-ledger
keys.

Sam reported that replacement credentials were installed and exposed keys were
revoked. Anthropic was retried, the Telegram token was replaced, Upstash was
corrected, and the dashboard secret chain was verified through the repaired UI.

**Evidence caveat:** repository finding
`ops/findings/F-2026-095-rotate-exposed-portfolio-credentials-before-phase-0-day-1.md`
still says `open`. This is now a sanitized proof/record-closure item rather than an
instruction to expose or re-copy secrets. Before a Phase 0 day is counted, the
sentinel/observer evidence must show the finding is no longer an active P1, or the
repository record must be closed through its normal attested workflow.

## Phase 0 observation status

- **Jul 13:** invalid; 0/10.
- **Jul 14:** immutable signed `FAIL_BOTH`; 0/10. The research sample was retained,
  but the safety day did not count.
- **Jul 15:** invalid; 0/10. Earlier Upstash failures and the late S2 cash repair
  prevent it from counting.
- **Jul 16:** first candidate Day 1, subject to the complete scheduled evidence set.

At the latest sanitized runtime checkpoint around 5:18 PM ET:

- Jetson health was green and all required dependency booleans were true.
- The 5:15 PM post-repair research scan was still completing its three agents.
- No genuine actionable proposal had appeared, so no personal review or signature
  was required.
- The market-scan refresh had degraded to watchlist fallback and FRED/Yahoo evidence
  warnings remained visible; these are evidence-quality observations, not permission
  to hide or normalize the degradation.
- Post-close ledger verification, parity, sentinel, and the 8:15 PM signed observer
  were still pending.

The `portfolio-readiness-watch` heartbeat remains responsible for sanitized checks.
After the 8:15 PM observer produces its immutable record, it should provide the final
evidence-backed readiness report and then delete itself. If a genuine proposal
appears at any point, Sam must personally review and sign it.

## Proposal-quality assessment

The system appears strong at refusing weak or unsupported ideas, enforcing cash and
risk constraints, preserving evidence, and requiring independent evaluation. The
main remaining confidence limitation is analytical depth, not basic safety.

The saved working estimates were:

- roughly **78%** that a genuinely qualifying setup becomes evaluator-approved;
- roughly **90%** that a weak idea is refused; and
- roughly **60%** that the first approved proposal is genuinely investment-grade.

These are engineering judgments, not measured investment-performance statistics.
The supporting findings and improvement ideas are saved in
`docs/PROPOSAL-QUALITY-FINDINGS.md`.

## Athena and equal-agent direction

Review of `Cubanso24/stock-llm@483a68b` showed that Athena is a broad public-equity
research and accountability system, not merely the compact valuation dossier
currently consumed by Portfolio Manager. Portfolio Manager should not build a
duplicate Athena or copy its repository. The preferred boundary is:

- Athena supplies read-only, versioned, point-in-time company research packages.
- Portfolio Manager retains mandate, portfolio, risk, evaluator, proposal,
  approval, execution, accounting, and reconciliation authority.
- Agents 1–3 receive the same discovery machinery, evidence classes, research
  workflow, evaluator, protected capacity, lineage, and accountability.
- The agents differ only in mandate: investment style, horizon, economics,
  valuation emphasis, catalyst window, kill criteria, constraints, and
  re-underwriting cadence.
- Static watchlists may remain priority inputs, but must not remain capability
  boundaries once the later catalog and canary gates pass.

The next two-to-three-week target program is saved in
`docs/ATHENA-INTEGRATION-AND-AGENT-PARITY-PLAN.md`:

1. Athena permission, ownership, and sanitized runtime truth.
2. Q-001–Q-004 mandate decisions and the equal-agent invariant.
3. `AthenaEvidencePackage-v1` contract and failure fixtures.
4. A predeclared 30-company golden set and measured vendor bakeoff.
5. One common candidate-bus design with mandate-specific ranking.
6. A three-way offline comparison of current Portfolio Manager, compact Athena,
   and full Athena packages.
7. A reviewed shadow-only intake candidate after Phase 0, with no live proposal or
   authority change.

Paid sources should be selected only after the golden set proves a specific gap.
FMP and Fiscal.ai trials are the first comparison candidates; more expensive market,
transcript, or institutional products remain conditional.

## Repository state at this checkpoint

### Backend

- Branch: `mandate-v3`.
- Production/code head: `9517be1`.
- `origin/main` and `origin/mandate-v3` are aligned at that commit.
- The working tree contains documentation-only work in progress, including the
  master-plan crosswalk, observation record, formidable-fund roadmap, proposal
  quality findings, Athena/parity plan, this session log, and the project napkin.
- Those documentation changes are saved locally but are not yet committed or
  pushed. They must not be swept into a production behavior release accidentally.

### Dashboard

- Branch: `main`.
- Head: `2af23c4`.
- Working tree clean at the checkpoint.

## Next actions

1. Allow the July 15 scheduled post-close checks and signed observer to finish.
2. Close the remaining credential-rotation finding through sanitized evidence if it
   still appears as an active P1.
3. Begin the Phase 0 count only from a full observer pass; do not infer Day 1 from
   health or uptime alone.
4. Freeze production during the count.
5. Develop the Athena/parity roadmap only in an isolated branch or worktree.
6. Do not approve, sign, or force a proposal to satisfy a sample requirement.

## Canonical references

- `docs/portfolio-master-plan.md`
- `docs/PHASE-0-OBSERVATION.md`
- `docs/PROPOSAL-QUALITY-FINDINGS.md`
- `docs/ATHENA-INTEGRATION-AND-AGENT-PARITY-PLAN.md`
- `ops/findings/F-2026-095-rotate-exposed-portfolio-credentials-before-phase-0-day-1.md`

