# Handoff

_Last updated by a Claude Code session covering mandate architecture and
research-pipeline data-quality work. Supersedes the prior entry below, which
was the now-completed MCP holdings-sync migration handoff._

## What this session did, in order

1. **Reorganized docs.** Moved `portfolio-master-plan.md`, `AUTONOMY-ROADMAP.md`,
   `ROADMAP-FORMIDABLE-FUND.md`, `RESEARCH-ROADMAP-EXECUTION-GUIDE.md` into
   `docs/roadmaps/`. Moved a new personal `TODO.md` into `todo/`. Every
   cross-reference across the repo was updated — verified none point at a
   stale path.
2. **Split all three agents' mandates** from one flat `personality.md` into
   `master.md` (identity/philosophy/universe, task-agnostic) +
   `buy-playbook.md` (entry search/sizing, fed to the AI) + `sell-playbook.md`
   (human-readable exit-rule narrative, documentation only — never loaded by
   any job). Also extracted each agent's hardcoded exit thresholds out of
   `lib/mandate-policy.js` into `config/agents/mandate-policy.js`'s `exit`
   blocks. Full method and rationale: `config/agents/MANDATE-SPLIT-PILOT.md`.
3. **Fixed a systemic data gap**: the 200-day/50-day/52-week-high averages
   were structurally unavailable for every research candidate, every run —
   the daily-bars lookback window (8 calendar months) could never accumulate
   the 200+ trading days required, and Yahoo's own pre-computed
   `summaryDetail.twoHundredDayAverage`/`fiftyDayAverage`/`fiftyTwoWeekHigh`
   (free, already fetched) were sitting unused. This was very likely the
   cause of proposals stalling at the evaluator with missing/fabricated
   technical data. Fixed in `lib/evidence-quality-policy.js` +
   `jobs/research-scan.js`.
4. **Fixed an unenforced hard rule**: every agent's mandate says "SPY below
   its 200-day average AND 10-year rate pressure = NO_TRADE," but nothing in
   code actually computed or enforced it — the AI was trusted to self-certify
   it from raw prose numbers, contradicting this codebase's own stated
   principle. New `lib/macro-regime.js` computes it deterministically;
   `jobs/research-scan.js` now force-downgrades a BUY to HOLD when both
   conditions are red, for agent-1/agent-2 (agent-3's mandate treats macro as
   informational only, so it's exempt).

All of the above is committed and pushed to `main` (fast-forward merges, no
conflicts). `npm test`: 875/875 passing as of the last change. Caveat on both
data-pipeline fixes: verified at the code/type-definition level, not observed
against a live Yahoo/FRED call — this sandbox has no live network access to
either. First live scan after deploy is the real proof.

## Open items (full detail in `todo/TODO.md`)

1. Revisit holdings reassessment cadence as the portfolio grows.
2. Agent 4's trust cold-start is a fixed 60-trading-day calendar window with
   zero return-weight — explore a beta-adjusted, evidence-driven trigger
   instead.
3. The macro gate's single-red condition is flagged with a mandatory
   override note but not actually capped at Tier 2 — Agent 1 has a live
   conviction/tier clamp (`lib/conviction.js`) that could enforce this;
   Agent 2 doesn't have an equivalent live mechanism yet.

## Architectural discussion this session (not in any commit — preserved here)

- **Evaluator vs. Agent 4 are not redundant, and won't become redundant as
  the agents improve.** The evaluator checks per-instance honesty (real
  citations, accurate numbers); Agent 4 allocates capital across proposals
  based on trust/track record. A great track record doesn't insulate any
  single output from a bad day, a data error, or prompt injection — same
  reason a skilled surgeon still uses a checklist every time.
- **Rejected idea, on the record:** an unbounded generator↔evaluator revision
  loop ("keep iterating until confirmed good or bad"). Analysis: this would
  likely *increase* confirmation bias, not reduce it — unbounded patching
  rewards persistence over correctness (same shape as p-hacking), costs
  multiples of today's AI budget, and erodes the evaluator's one real asset
  (having no stake in the outcome). The current one-revision-max cap stays.
- **Real, still-open risk:** citation-checking catches fabrication, not
  selective emphasis — a thesis can be fully and honestly cited while still
  cherry-picking which real evidence to foreground. Discussed but not built:
  an independent "steelman the bear case" adversarial pass using the same
  evidence ledger, as a stronger countermeasure than more revision rounds.
- **Next flagged issue, not yet started:** `lib/quant-scorer.js` normalizes
  every metric (debt/equity, P/E, margins...) across the whole day's
  candidate slate regardless of industry — a bank ends up ranked against a
  biotech on the same 0-100 scale. A complete peer-relative scoring system
  already exists (`lib/peer-resolve.js`, `lib/peer-source.js`, tested) but is
  explicitly commented "NOT wired into the live pipeline." Recommended
  approach: shadow-run it alongside the current scorer and compare before
  switching live, since this changes core scoring for every candidate rather
  than just supplying better evidence.
- **Other data gaps identified, genuinely hard rather than buggy:** free
  peer/industry classification is coarser than the mandate wants (the
  codebase's own comments say the real fix is a paid GICS-style vendor);
  analyst-estimate freshness is hard to pin down precisely because Yahoo's
  free consensus data uses relative buckets, not absolute dates; 13F
  institutional-ownership data is free but inherently up to 45 days stale by
  regulation and not yet implemented at all; balance-sheet "quality" gates
  are blocked not by data availability but by **Q-001 in
  `docs/human-inputs/RESEARCH-POLICY-QUESTIONNAIRE.md` still being
  unanswered** — that one needs you and your research partner, not code.

## Next step

Pick one: wire the peer-relative scorer (shadow-compare first), tackle one of
the three TODO items above, or answer the outstanding research-policy
questionnaire so the balance-sheet gates can finally be built.
