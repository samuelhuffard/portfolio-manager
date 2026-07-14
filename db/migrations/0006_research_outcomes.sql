-- Migration 0006: additive, advisory-only outcome snapshots. These records are immutable
-- research evidence and are deliberately isolated from money, proposals,
-- orders, accounting, and execution.

CREATE TABLE IF NOT EXISTS research_outcomes (
  id TEXT PRIMARY KEY CHECK (id ~ '^outcome-[0-9a-f]{64}$'),
  observation_id TEXT REFERENCES mandate_score_observations(id),
  selection_item_id TEXT REFERENCES research_selection_items(id),
  comparison_pair_id TEXT,
  security_id TEXT NOT NULL,
  ticker TEXT NOT NULL,
  agent_id agent_id NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('immature', 'matured', 'unavailable', 'excluded')),
  reason TEXT,
  as_of TIMESTAMPTZ NOT NULL,
  entry_at TIMESTAMPTZ,
  target_at TIMESTAMPTZ,
  exit_at TIMESTAMPTZ,
  horizon_policy_version TEXT NOT NULL CHECK (btrim(horizon_policy_version) <> ''),
  benchmark_policy_version TEXT NOT NULL CHECK (btrim(benchmark_policy_version) <> ''),
  hit_policy_version TEXT,
  cost_policy_version TEXT,
  mandate_version TEXT,
  scoring_version TEXT,
  score_completeness TEXT,
  delta_cause TEXT,
  selection_category TEXT,
  evidence_class TEXT NOT NULL CHECK (evidence_class IN ('backtest', 'shadow', 'paper', 'realized_live')),
  metrics JSONB,
  hit BOOLEAN,
  canonical_payload JSONB NOT NULL,
  content_hash TEXT NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  created_at TIMESTAMPTZ NOT NULL,
  CHECK (observation_id IS NOT NULL OR selection_item_id IS NOT NULL),
  CHECK (security_id = ticker),
  CHECK (jsonb_typeof(canonical_payload) = 'object'),
  CHECK (canonical_payload ?& ARRAY['evidenceClass', 'status', 'reason', 'asOf', 'entryAt', 'targetAt', 'exitAt', 'metrics', 'hit', 'identity', 'strata', 'policyVersions', 'timingRules']),
  CHECK (jsonb_typeof(canonical_payload->'identity') = 'object' AND canonical_payload->'identity' ?& ARRAY['ticker', 'agentId']),
  CHECK (jsonb_typeof(canonical_payload->'strata') = 'object'),
  CHECK (jsonb_typeof(canonical_payload->'policyVersions') = 'object' AND canonical_payload->'policyVersions' ?& ARRAY['horizon', 'benchmark']),
  CHECK (jsonb_typeof(canonical_payload->'timingRules') = 'object' AND canonical_payload->'timingRules' ?& ARRAY['horizonDays', 'observationToleranceMs', 'benchmarkAlignmentToleranceMs']),
  CHECK (metrics IS NULL OR jsonb_typeof(metrics) = 'object'),
  CHECK (canonical_payload->>'evidenceClass' = evidence_class),
  CHECK (canonical_payload->>'status' = status),
  CHECK (canonical_payload->>'reason' IS NOT DISTINCT FROM reason),
  CHECK (canonical_payload->'metrics' = COALESCE(metrics, 'null'::jsonb)),
  CHECK (canonical_payload->'hit' = COALESCE(to_jsonb(hit), 'null'::jsonb)),
  CHECK (canonical_payload#>>'{identity,ticker}' = ticker),
  CHECK (canonical_payload#>>'{identity,securityId}' = security_id),
  CHECK (canonical_payload#>>'{identity,agentId}' = agent_id::text),
  CHECK (canonical_payload#>>'{identity,observationId}' IS NOT DISTINCT FROM observation_id),
  CHECK (canonical_payload#>>'{identity,selectionItemId}' IS NOT DISTINCT FROM selection_item_id),
  CHECK (canonical_payload#>>'{identity,comparisonPairId}' IS NOT DISTINCT FROM comparison_pair_id),
  CHECK (canonical_payload#>>'{policyVersions,horizon}' = horizon_policy_version),
  CHECK (canonical_payload#>>'{policyVersions,benchmark}' = benchmark_policy_version),
  CHECK (canonical_payload#>>'{policyVersions,hit}' IS NOT DISTINCT FROM hit_policy_version),
  CHECK (canonical_payload#>>'{policyVersions,cost}' IS NOT DISTINCT FROM cost_policy_version),
  CHECK (canonical_payload#>>'{strata,mandateVersion}' IS NOT DISTINCT FROM mandate_version),
  CHECK (canonical_payload#>>'{strata,scoringVersion}' IS NOT DISTINCT FROM scoring_version),
  CHECK (canonical_payload#>>'{strata,scoreCompleteness}' IS NOT DISTINCT FROM score_completeness),
  CHECK (canonical_payload#>>'{strata,deltaCause}' IS NOT DISTINCT FROM delta_cause),
  CHECK (canonical_payload#>>'{strata,selectionCategory}' IS NOT DISTINCT FROM selection_category),
  CHECK ((canonical_payload->>'asOf')::timestamptz = as_of),
  CHECK ((canonical_payload->>'entryAt')::timestamptz IS NOT DISTINCT FROM entry_at),
  CHECK ((canonical_payload->>'targetAt')::timestamptz IS NOT DISTINCT FROM target_at),
  CHECK ((canonical_payload->>'exitAt')::timestamptz IS NOT DISTINCT FROM exit_at),
  CHECK (entry_at IS NULL OR entry_at <= as_of),
  CHECK (target_at IS NULL OR entry_at IS NULL OR target_at >= entry_at),
  CHECK (exit_at IS NULL OR entry_at IS NULL OR exit_at >= entry_at),
  CHECK (
    (status = 'matured' AND metrics IS NOT NULL AND reason IS NULL AND exit_at IS NOT NULL)
    OR (status IN ('immature', 'unavailable', 'excluded') AND metrics IS NULL AND hit IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS research_outcomes_observation_as_of_idx
  ON research_outcomes(observation_id, as_of DESC, id DESC);
CREATE INDEX IF NOT EXISTS research_outcomes_selection_as_of_idx
  ON research_outcomes(selection_item_id, as_of DESC, id DESC);
CREATE INDEX IF NOT EXISTS research_outcomes_comparison_as_of_idx
  ON research_outcomes(comparison_pair_id, as_of DESC, id DESC);
CREATE INDEX IF NOT EXISTS research_outcomes_status_as_of_idx
  ON research_outcomes(status, as_of DESC, id DESC);
CREATE INDEX IF NOT EXISTS research_outcomes_agent_mandate_idx
  ON research_outcomes(agent_id, mandate_version, as_of DESC, id DESC);
CREATE INDEX IF NOT EXISTS research_outcomes_policy_versions_idx
  ON research_outcomes(horizon_policy_version, benchmark_policy_version, hit_policy_version, cost_policy_version, as_of DESC, id DESC);
