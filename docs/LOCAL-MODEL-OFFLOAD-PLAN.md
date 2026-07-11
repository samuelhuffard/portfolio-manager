# Local Model Offload Plan — Portfolio Manager

**Status: PLAN ONLY — nothing implemented yet.** Written 2026-07-05, before the new server hardware exists. A future session picks this up starting at Phase 0.

## Context

Sam is acquiring server hardware significantly larger than the Jetson (8GB), sized to run a ~40–80B-parameter model well. Goal: offload the majority of Portfolio Manager's LLM work to the local model, reserving frontier (Anthropic) models for only the highest-stakes calls. Decisions Sam already made (2026-07-05):

1. **Local inference gets exposed via Cloudflare Tunnel** (same pattern as jordan.samputer.xyz), bearer-token protected, so the Vercel dashboard can use it too.
2. **The evaluator stays frontier permanently.** It is the last skeptical gate before money-adjacent proposals and costs ~0–5 calls/day.
3. **Generator cutover is shadow-first**: local runs alongside Sonnet for ~2 weeks with logged comparisons before it takes over.

## Complete LLM call-site inventory (verified 2026-07-05)

| # | Call site | Model today | Volume | Pays API $? | Tier |
|---|-----------|-------------|--------|-------------|------|
| 1 | `portfolio-manager/lib/ai-overlay.js` — generator, per-ticker BUY/SELL/HOLD JSON | Sonnet 4.6 | ~26 tickers/day (3 agents), Mon–Fri 5:15pm | Yes (largest spend) | **B — offload after shadow** |
| 2 | `portfolio-manager/lib/evaluator.js` — skeptical APPROVE/REVISE/REJECT on actionable proposals | Opus 4.8 (`EVALUATOR_MODEL` env) | 0–5/day | Yes (tiny) | **N — never offload** |
| 3 | `portfolio-manager/jobs/weekly-review.js` — ≤3 lessons from deterministic scorecard | Sonnet 4.6 | 1/week | Yes (tiny) | **A — offload first** |
| 4 | `portfolio-dashboard/app/api/agents/[agentId]/chat/route.ts` — agent chat | Sonnet 4.6 | interactive | Yes | **B — offload via tunnel** |
| 5 | `portfolio-dashboard/lib/research/analyze.ts` — /research analyst note | Opus 4.8 | interactive, per click | Yes | **C — tiered (see below)** |
| 6 | Sysloop (`scripts/sysloop-triage.mjs`, `sysloop-weekly.mjs` via `claude -p`) | Sonnet (subscription) | daily triage + weekly | No (subscription) | **A — offload (saves rate limits, not $)** |
| 7 | Mac companion (`portfolio-dashboard/scripts/mac-companion.mjs` via `claude -p` + Robinhood MCP) — executes signed approvals, reconciles, syncs holdings, market scans | claude.ai login | market hours polling | No (subscription) | **N — never offload** |

Everything else in the pipeline (data gates, quant scorer, risk engine, circuit breaker, sizing, evidence sanitizer, HMAC ledger checks) is deterministic code — no LLM, nothing to offload.

## Tier definitions and rationale

**Tier N — never leaves frontier:**
- **Evaluator (#2).** The architecture's whole safety story is "generator output is untrusted; downstream gates only downgrade." That only holds if the evaluator is at least as capable as the generator. Keep `claude-opus-4-8` (or the current-best frontier model). It already has an env override (`EVALUATOR_MODEL`) — never point that at the local endpoint.
- **Mac companion execution (#7).** Multi-turn agentic tool use against the live Robinhood MCP with real money. A local model failure mode here isn't a bad thesis, it's a wrong order. Also runs on the Claude subscription, so there's no dollar saving. Do not touch.
- **Anything new that writes to money paths, modifies system code (sysloop skeptic's proposed patches should still get frontier or human review before apply), or makes security judgments.**

**Tier A — offload first (low blast radius, output is advisory or human-reviewed):**
- Weekly review lessons (#3): output is ≤3 memory strings, capped at 6, evict-only-each-other. Worst case is a mediocre lesson in a prompt.
- Sysloop triage (#6): classifies findings into FIXLIST annotations that Sam reviews. Note: saves subscription rate-limit headroom, not dollars. The sysloop weekly *skeptic* pass can go local; keep any auto-applied patch generation frontier or human-gated.
- Any future news summarization / evidence pre-triage step (currently deterministic — if an LLM triage step is ever added, it's local-first by default).

**Tier B — offload after proving (the real wins):**
- Generator (#1) — the volume driver. Safe to offload *specifically because* the risk engine, conviction clamp, breaker, evaluator, and Sam's approval all sit downstream and can only downgrade. Shadow-first per Sam's decision (Phase 3).
- Agent chat (#4) — interactive quality matters but it's grounded chat over the agent's own Sheets data; a good 40–80B model handles this fine. Route via tunnel after Phase 5.

**Tier C — tiered by request:**
- /research analyst notes (#5) — Sam-facing long-form quality is the product here. Recommendation: default to local, add a "deep" toggle in the UI (or auto-escalate on request) that uses Opus. Revisit after seeing local output quality; if notes read noticeably worse, flip the default back.

## Target architecture

### Serving stack (leave open until hardware is known)

- **First choice: vLLM** with the OpenAI-compatible server. Reasons: `guided_json` / structured-output support (grammar-constrained decoding eliminates the JSON-parse-fallback-to-HOLD failure class entirely), prefix caching (replaces Anthropic prompt caching for the static system block), best throughput.
- **Fallback: llama.cpp server or Ollama** if the hardware/OS ends up awkward for vLLM (e.g., unusual GPU, Mac-class unified memory). Both speak OpenAI-compatible APIs; the router below doesn't care.
- **Model: decide on hardware day.** Candidates in the 40–80B class as of mid-2026: Qwen3 dense ~32–72B or Qwen3 MoE, Llama family ~70B, GLM, gpt-oss-class open-weight releases. Selection criteria, in order: (1) JSON/instruction reliability, (2) financial-reasoning quality on a small eval set (below), (3) tokens/sec at the chosen quantization. **Quantization floor: Q5/FP8-class.** Aggressive quants (Q3/Q4) measurably degrade structured-output reliability — if the hardware can't run the chosen model at Q5+, pick a smaller model instead.
- Context needs are modest: generator prompts are a few K tokens; 16–32K context is plenty. Don't trade quality for giant context.

### Router abstraction — `lib/llm.js` (new, both repos get one)

Replace direct `anthropic.messages.create` calls with a thin router:

```
callModel({ role, system, messages, maxTokens, jsonSchema? })
```

- `role` is the call-site name (`generator`, `evaluator`, `weekly_review`, `agent_chat`, `research_note`). Per-role routing is **env-driven**: `LLM_ROLE_GENERATOR=local:qwen3-72b`, `LLM_ROLE_EVALUATOR=anthropic:claude-opus-4-8`, etc. Rollback of any phase is one env flip + restart.
- Providers: `anthropic` (existing SDK, keeps `cache_control` on the system block) and `local` (OpenAI-compatible `/v1/chat/completions`, bearer token, `response_format`/`guided_json` when a schema is passed).
- **Fallback policy (fail-closed, per INVARIANTS):** local endpoint error/timeout → one retry against the Anthropic model configured as `LLM_FALLBACK_<ROLE>` → if that also fails, the *existing* fail-closed behavior fires (generator→HOLD, evaluator→REJECT — but evaluator never routes local anyway). Log + Telegram on every fallback so silent degradation is impossible (mistake class 1: dropped outputs must scream).
- Map `finish_reason: "length"` to the existing `stop_reason === "max_tokens"` truncation warning.
- `.trim()` every env read. No secrets printed.

### Network topology

- Local server joins the Tailnet (backend jobs on the Jetson and the Mac reach it at its Tailscale IP).
- Cloudflare Tunnel exposes it as e.g. `llm.samputer.xyz` for Vercel. **Hard requirements:** bearer-token auth enforced at the inference server or a thin proxy in front (vLLM `--api-key`), token stored in Vercel env (`LOCAL_LLM_API_KEY`), rate limiting at the tunnel/proxy, no unauthenticated routes, `/health` endpoint for the router's liveness check. The token is a real secret — same handling rules as every other key.
- Jetson keeps running the scheduler; it calls the new server over Tailscale. Nothing about job scheduling moves.

## Phases

### Phase 0 — Hardware bring-up + model selection (blocked on hardware)
1. OS + GPU drivers + Tailscale join + PM2 (or systemd) for the inference server.
2. Install vLLM (or fallback stack), download 2–3 candidate models at Q5+/FP8.
3. **Build the eval set first:** ~20 real generator prompts captured from recent scans (the system prompt + user message pairs — add a debug flag or pull from logs), plus 5 agent-chat and 3 research-note prompts. Score each candidate on: valid-JSON rate (should be 100% with guided decoding), action agreement with Sonnet on the same inputs, thesis quality (eyeball), tokens/sec.
4. Pick the model; record the decision + benchmarks in this doc.
5. Stand up Cloudflare Tunnel + auth token. Verify `/health` from Jetson (Tailscale), Mac, and public tunnel.

### Phase 1 — Router abstraction, zero behavior change
1. Add `lib/llm.js` to `portfolio-manager`; port `ai-overlay.js`, `evaluator.js`, `weekly-review.js` onto it with every role still pointing at its current Anthropic model. Tests for the router (fallback, truncation mapping, schema pass-through).
2. Same for `portfolio-dashboard` (chat route + `analyze.ts`).
3. Deploy both; confirm scans and dashboard behave identically. This phase is safe to build **before the hardware arrives**.

### Phase 2 — Tier A cutover (first real offload)
1. `LLM_ROLE_WEEKLY_REVIEW=local:*`. Watch one Friday run; lessons should still be ≤3, checkable, sane.
2. Sysloop triage: point `runClaudeJson` at the local endpoint (it's already model-parameterized via `SYSLOOP_MODEL`; add an endpoint override) for the triage role. Weekly skeptic can follow; patch generation stays frontier/human-gated.

### Phase 3 — Generator shadow mode (~2 weeks)
1. In `research-scan.js`, after the real (Sonnet) generator call, fire the same prompt at the local model. **Local output goes nowhere near the pipeline** — log both to Redis `pm:shadow:generator:<date>` (30d TTL) with: ticker, both actions, both confidences, both target weights, whether theses cite the same catalysts.
2. Shadow calls sit inside the per-ticker try/catch and must never fail the scan (a shadow error is a warn, not a Telegram).
3. **Graduation gate (evaluate after 10 trading days):** action agreement ≥80% on actionable calls; local valid-JSON rate 100%; spot-read 15 local theses — no hallucinated data (numbers must trace to the prompt's fundamentals/news); local confidence distribution not wildly miscalibrated vs Sonnet's.
4. Write a small `scripts/shadow-report.mjs` that prints the comparison table from Redis.

### Phase 4 — Generator cutover
1. `LLM_ROLE_GENERATOR=local:*`, fallback `anthropic:claude-sonnet-4-6`. Keep shadow logging one more week (now Sonnet is the shadow) — cheap insurance.
2. **Watch for 2 weeks:** evaluator REJECT/REVISE rate (a spike = local generator quality problem — this is the single best canary, and it's already built); risk-engine downgrade rate; Sam's own accept rate on proposals. Revert = one env flip.
3. Prompt-cache note: the per-RUN boundary token rule still applies; vLLM prefix caching gives the same win as `cache_control` with zero code change as long as the static system block stays byte-identical across a run.

### Phase 5 — Dashboard via tunnel
1. Agent chat → local (`LLM_ROLE_AGENT_CHAT=local:*`), fallback Anthropic on tunnel error so chat never hard-fails.
2. /research → local by default with a frontier "deep analysis" escalation (UI toggle or auto-retry keyword). If local notes read clearly worse, flip the default back and keep local only for chat.
3. Latency check: interactive use needs ~20+ tokens/sec sustained through the tunnel; measure before cutover.

### Phase 6 — Stretch (only after 1–5 are boring)
- Agents 2/3 mandates + Stage-2 deep dossier loop (LOOP-DESIGN.md §7) built local-first from day one — the deep dossier loop is exactly the kind of token-hungry work that's only affordable local.
- Local embeddings for any future retrieval layer (the Jetson already runs nomic-embed-text for Jordan; the new box can take over/upgrade).
- Consider offloading Jordan's triage/summarization next — out of scope for this plan, but the router pattern is reusable.

## What this saves

Real API dollars today come from: generator (~26 Sonnet calls/day = the bulk), /research + agent chat (per use), evaluator + weekly review (negligible). After Phase 4–5, recurring Anthropic spend drops to evaluator (0–5 Opus calls/day) + optional deep-research escalations — likely >90% of PM API spend. Sysloop/companion offloads save subscription rate-limit headroom, not dollars.

## Rules for the implementing session

- Read `docs/CHANGE_MAP.md` and `docs/INVARIANTS.md` first; the code-lessons memory (`Feedback/portfolio-manager-code-lessons.md`) applies in full — especially: outputs fail loudly, `.trim()` env reads, schema lives in three places, new steps stay inside the per-ticker try/catch.
- Never point `EVALUATOR_MODEL` or the mac-companion at the local endpoint.
- Every phase has a one-env-flip rollback; verify it actually works before calling the phase done.
- The tunnel token is a secret: `printf` piping, `grep -c` verification, never in git or the vault.

## Open items (resolve on hardware day)

- Actual hardware specs → serving stack + model + quantization choice (Phase 0).
- Whether vLLM prefix caching needs `--enable-prefix-caching` tuning for the multi-agent scan pattern (three agents share macro/market blocks but differ in personality/memory).
- Whether the local box should also take over the Jetson's Ollama embedding duties for Jordan.
- Name for the endpoint (`llm.samputer.xyz` suggested).
