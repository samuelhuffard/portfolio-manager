# Task E1.4 — Mandate Metadata and Deterministic Research Version IDs

Use a small coding model. This is pure/versioning work with no I/O beyond reading local configuration.

## Repo

`/Users/samhuffard/All Claude Projects/portfolio-manager`

Read `CLAUDE.md`, `.claude/napkin.md`, `docs/adr/0003-point-in-time-research-record.md`, D-001/D-002 in `docs/RESEARCH-DECISION-REGISTER.md`, current scoring configs, and E1.4 in the execution guide.

## Implement

1. Add `config/agents/agent-1/mandate.json`, `agent-2/mandate.json`, and `agent-3/mandate.json` with the exact six-field objects and exact values in E1.4. Do not choose alternate policy-version strings.
2. Add `lib/research-version.js` implementing the exact canonical-JSON rejection behavior, SHA-256 representation, config-version inputs, peer-set normalization, and observation identity rules in E1.4.
3. Wire `mandateMetadataFor`/`mandateVersionFor` to the three explicit JSON files. Unknown agent IDs must throw.
4. Use `mandate-v3-scoring-1` as the initial semantic label and hash the named executable table exports—not source text. File mtime, branch, Git commit, comments, and timestamps are excluded from this semantic version. `codeRevision` remains separate provenance supplied by callers later.
5. Add `tests/research-version.test.js` covering every E1.4 identity rule, including fail-closed unsupported canonical-JSON values and the intentional distinction between excluded config timestamps and included peer-set `asOf`.

Do not modify scoring values, mandate Markdown, agent eligibility, universe source, Redis, Postgres, scheduler, or proposals.

## Verify

```bash
cd "/Users/samhuffard/All Claude Projects/portfolio-manager"
npm test
```

Return the required completion report. Do not deploy, commit unrelated files, or push.
