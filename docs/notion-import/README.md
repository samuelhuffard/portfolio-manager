# Portfolio Manager — Notion Import Package

Generated 2026-07-12 from the repository and project vault. This is a **read-only planning and visibility workspace**. It must never hold secrets, broker credentials, account numbers, raw investor PII, or trade-execution authority.

## Import order

1. Create a Notion parent page named **Portfolio Manager — Brain**.
2. Import `Home.md`, `Architecture.md`, `Knowledge Graph.md`, and the four pages in `mandates/` beneath it.
3. Import each CSV as a Notion database, using the filename as its title: `Roadmap.csv`, `Decisions ADR Log.csv`, `Journey Timeline.csv`, and `Open Items.csv`.
4. Convert the `Phase`, `Owner`, `Status`, and `Priority` fields to Select/Multi-select as useful; convert `Source` fields to URL or Text. Keep the full exit gate on each roadmap row.
5. Add linked views to Home: Current Phase, Open P0/P1 Items, Open Decisions, and the latest Journey entries.

## Ongoing maintenance

- Repo `docs/` and the Obsidian vault remain canonical. Update this workspace only as a readable projection of verified reality.
- Never mark a roadmap phase done without its stated exit gate.
- When a decision, mandate, deployment, or observation result changes, update the relevant database row and add a dated Journey entry.
- Do not use Notion as a trade approval, broker, ledger, or investor-record system.

## Sources

- `docs/roadmaps/AUTONOMY-ROADMAP.md`
- `docs/ARCHITECTURE.md`, `docs/INVARIANTS.md`, `docs/ONBOARDING.md`
- `docs/adr/0001-postgres-canonical-store.md`, `docs/adr/0002-service-identity.md`
- `agent_mandates/Agent_{One,Two,Three,Four}_Mandate_v3.md`
- `ops/FIXLIST.md` (summarized only; its 2026-07-10 findings are stale/noisy until fresh evidence regenerates it)
- `~/Claude Memory/Projects/portfolio-manager*.md` and `~/Claude Memory/Dev Logs/2026-06-29 onward`
