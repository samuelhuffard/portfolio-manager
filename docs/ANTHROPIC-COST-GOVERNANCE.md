# Anthropic Cost Governance

Portfolio Manager prices every backend Anthropic response, retains the priced
usage record for 45 days, and can enforce a fail-closed UTC monthly ceiling.
The ceiling is deliberately not chosen in source control.

## Pricing policy

`lib/anthropic-pricing.js` is the central, versioned rate table. It covers the
active first-party production model families supported by this backend under
standard-speed global inference: Fable 5, Opus 4.8/4.7/4.6/4.5, Sonnet 5/4.6/4.5,
and Haiku 4.5. Dated 4.5 model IDs are normalized to their published aliases.
Unknown models and unknown pricing versions fail before the paid API call; they
are never treated as free.

The rates include base input, output, five-minute cache writes, one-hour cache
writes, and cache reads. Source: Anthropic's official [prompt-caching pricing
table](https://platform.claude.com/docs/en/build-with-claude/prompt-caching#pricing),
checked 2026-07-14. The table is scoped to non-Batch, standard-speed, global
Claude API calls. Fast mode, Batch, or US-only inference would require a new
explicit pricing version before use. Anthropic's already-announced Sonnet 5
price change on 2026-09-01 is stored as a separate version.

## Configuration

- `ANTHROPIC_MONTHLY_MAX_USD`: optional positive dollar ceiling. Blank means
  `NOT_CONFIGURED`: current calls continue, but readiness remains unresolved.
- `ANTHROPIC_MONTHLY_WARN_PCT`: warning threshold as a fraction of the ceiling,
  default `0.8`. It reports reduced headroom but does not expand the ceiling.
- `ANTHROPIC_PRICING_VERSION`: optional explicit pin to a known version. Leave
  blank for the version selected from the UTC usage date.
- `ANTHROPIC_GENERATOR_CALL_RESERVE_USD`,
  `ANTHROPIC_EVALUATOR_CALL_RESERVE_USD`, and
  `ANTHROPIC_WEEKLY_REVIEW_CALL_RESERVE_USD`: conservative pre-call reservation
  floors. They do not set or replace the monthly ceiling.
- `ANTHROPIC_MONTHLY_PROTECTED_RESERVE_USD`: optional dollar pool inside the
  ceiling reserved for held-position reviews and evaluator calls. It defaults
  to zero because the owner must choose the policy. When nonzero, discovery and
  weekly-review calls cannot consume it; protected calls may use the full cap.
- `ANTHROPIC_CALL_LEASE_SECONDS`: lifetime of one atomic pre-call reservation,
  default 1,800 seconds. Increase only if a supported call can legitimately run
  longer than 30 minutes.
- `ANTHROPIC_MAX_REQUEST_BYTES`: maximum serialized request size accepted by
  the cost authorizer, default 1,000,000 bytes. This is a bounding control, not
  a provider-context-window setting.

Do not configure a ceiling until the Portfolio Manager Anthropic credential or
project boundary has been created and Sam has chosen the actual dollar policy.
Credential/project creation remains a human-gated provider-console action.

## Enforcement behavior

Before research generators, evaluator calls (including revisions), Lab research,
or the scheduled weekly-review model run, the budget guard validates pricing and,
when configured, reserves capacity against the UTC month-to-date total. Each
reservation is the greater of the configured role floor and a conservative
request-specific upper bound: serialized UTF-8 request bytes plus fixed framing
headroom are charged at the model's most expensive input/cache class, and
`max_tokens` is charged at the full output rate. Missing `max_tokens`, a model
mismatch, an unserializable request, or a request over the configured byte limit
is rejected before the API call. The same upper bound is added to the per-run
ledger, so `RESEARCH_RUN_MAX_USD` is also a hard pre-call cap even when the
monthly ceiling is `NOT_CONFIGURED`. Per-run upper bounds are active
reservations, not permanent spend: a successful call replaces its bound with
priced actual usage, an explicit provider rejection releases it, and an
ambiguous failure commits the full bound. Reservation IDs are single-settlement;
missing or duplicate settlement fails closed.

The authorization and reservation are one Redis `EVAL` operation shared by cron,
Lab, and manual processes, so concurrent callers cannot each spend the same
remaining capacity. Each authorization is a per-call lease. Successful calls
atomically replace the lease with actual priced spend; a provider error
atomically settles it. All three Anthropic SDK clients set `maxRetries: 0`, so
one authorization maps to at most one SDK attempt. A provider error carrying an
explicit HTTP status is treated as a non-billable rejection and releases the
lease; connection resets, timeouts, and other failures without a provider
response are ambiguous and conservatively charge the full reservation. A
process crash leaves its lease reserved until its bounded
expiry, when the full reservation is conservatively charged as spend. That
recovers the ledger without pretending an in-flight call was unbilled. An exact
cap boundary is allowed; a call that would exceed it fails with
`monthly_budget_exhausted` before reaching Anthropic.

The protected pool is a capacity partition, not extra money. A discovery call
that would enter that pool is denied even if total cap space remains. Held-name
generator calls and evaluator calls are marked protected; discovery and weekly
review are not.

Research records this as an explicit ERROR/capacity outcome. It never fabricates
an investment HOLD. Weekly review records the affected agent as failed and saves
no model-generated lesson. Per-run research reservations and the quality-first
evaluator fallback policy remain independent; the per-run ledger now reserves
the same request upper bound before allowing the call.

This control is **TRUST** evidence: it bounds and explains model spend. It is not
**SKILL** evidence and cannot improve an investment result, convert a failed
research attempt into a HOLD, or count toward a research-quality sample.

Usage persistence is one Redis `EVAL` containing `LPUSH`, `LTRIM`, and `EXPIRE`;
there is no partially written/trimmed/expired success state. Every v2 row is
repriced from its stored token classes and immutable pricing version during
aggregation. Its stored total and every cost-breakdown field must exactly match
the recomputation or telemetry becomes incomplete. Authorization time binds the
usage timestamp and pricing version, so a call spanning a UTC month or pricing
boundary settles against the lease that authorized it.

An enabled ceiling requires complete readable Redis telemetry. Pre-v2 rows from
the old token-only recorder are deterministically repriced at the model's dated
rate. Because that schema did not distinguish five-minute from one-hour cache
writes, every legacy cache write is conservatively charged at the more expensive
one-hour rate. The report counts these rows separately. A malformed legacy row,
unknown model, unreadable day, daily-list truncation, or failed post-call usage
write still makes remaining budget unknowable and blocks later calls. A lost
post-call write poisons the shared monthly state so a fresh process cannot evade
the fail-closed result. With no ceiling configured, telemetry problems remain
visible without changing current call behavior.

## Read-only report

Run `npm run anthropic:spend`. It reports the UTC billing month, month-to-date
estimated spend, ceiling/remaining status, and model/role/pricing-version totals.
It never prints tickers, rationales, agent memory, prompts, or credentials, and
it does not mutate Redis. Expired crash leases are reconciled by the next atomic
authorization; until then the report may conservatively show them as reserved.

Phase 0 and other read-only observers should call
`getAnthropicBudgetReadiness()` from `lib/anthropic-monthly-budget.js`. Its stable
`anthropic-budget-readiness-v2` object includes cap/telemetry state, spent,
active lease reservations, remaining, the configured protected pool, aggregate
denial counts, legacy-repricing coverage, and whether a protected holding review
or evaluator was denied. Usage rows remain under
`pm:anthropic-usage:<YYYY-MM-DD>`; privacy-safe state and denial counters use
`pm:anthropic-budget-status:<YYYY-MM>`, with sibling lease keys that contain only
opaque UUIDs, expiry times, and micro-dollar reservations.
