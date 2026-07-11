# Archived: 2026-07-07 Anthropic spend-cap error cluster (82 findings)

These 82 `new-error-cluster` findings (F-2026-024 through the mid-090s span that
matched this fingerprint) are all one root cause: on 2026-07-07 the Anthropic
spend cap was hit mid-run, and `jobs/research-scan.js` logged a per-ticker
non-fatal failure for each of ~2 dozen tickers, which sysloop then filed as
separate P2 findings. This was amplified by the pre-fix sysloop bugs (self-reading
its own console output, no ticker-fingerprint normalization, no occurrence floor).

Resolution landed in the Phase 0A deploy (backend `8de7b5f`):
- degraded-run classification separates `budget_exhausted` from genuine `HOLD`
- per-run AI budget controls with an 80% Telegram warning
- sysloop self-read exclusion, fingerprint normalization, and count floor

Kept here as a point-in-time record rather than deleted. The live review surface
(`ops/findings/`) should only carry actionable, current findings.
