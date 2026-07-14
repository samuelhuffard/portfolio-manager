-- Additive, advisory-only research events and selection history. These tables
-- are deliberately isolated from money, proposal, order, and accounting paths.

CREATE TABLE IF NOT EXISTS research_events (
  id TEXT PRIMARY KEY,
  comparison_key TEXT NOT NULL UNIQUE CHECK (comparison_key ~ '^[0-9a-f]{64}$'),
  previous_observation_id TEXT REFERENCES mandate_score_observations(id),
  current_observation_id TEXT NOT NULL REFERENCES mandate_score_observations(id),
  ticker TEXT NOT NULL,
  agent_id agent_id NOT NULL,
  primary_cause TEXT NOT NULL CHECK (primary_cause IN (
    'initial', 'filing', 'market', 'estimate', 'ownership', 'coverage',
    'peer_set', 'restatement', 'version', 'retry'
  )),
  all_causes JSONB NOT NULL CHECK (
    jsonb_typeof(all_causes) = 'array'
    AND jsonb_array_length(all_causes) > 0
    AND all_causes <@ '["initial", "filing", "market", "estimate", "ownership", "coverage", "peer_set", "restatement", "version", "retry"]'::jsonb
    AND all_causes ? primary_cause
  ),
  delta NUMERIC(10,4),
  material BOOLEAN,
  materiality_policy_version TEXT,
  research_eligible BOOLEAN NOT NULL,
  reason_codes JSONB NOT NULL CHECK (jsonb_typeof(reason_codes) = 'array'),
  changed_metrics JSONB NOT NULL CHECK (jsonb_typeof(changed_metrics) = 'array'),
  coverage_changed BOOLEAN NOT NULL,
  peer_set_changed BOOLEAN NOT NULL,
  version_changed BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL,
  content_hash TEXT NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  UNIQUE (previous_observation_id, current_observation_id, materiality_policy_version),
  CHECK (
    (previous_observation_id IS NOT NULL)
    OR (primary_cause = 'initial' AND all_causes = '["initial"]'::jsonb AND research_eligible = false)
  ),
  CHECK (previous_observation_id IS NULL OR previous_observation_id <> current_observation_id),
  CHECK ((primary_cause <> 'initial') OR previous_observation_id IS NULL),
  CHECK (
    (primary_cause = 'initial' AND material IS NULL AND materiality_policy_version IS NULL)
    OR
    (primary_cause <> 'initial' AND all_causes <@ '["filing", "market", "estimate", "ownership"]'::jsonb
      AND ((material IS NULL AND materiality_policy_version IS NULL)
        OR (material IS NOT NULL AND materiality_policy_version IS NOT NULL AND btrim(materiality_policy_version) <> '')))
    OR
    (primary_cause <> 'initial' AND NOT (all_causes <@ '["filing", "market", "estimate", "ownership"]'::jsonb)
      AND material = false AND materiality_policy_version IS NULL)
  ),
  CHECK ((primary_cause <> 'initial') OR delta IS NULL),
  CHECK ((primary_cause <> 'retry') OR delta = 0),
  CHECK (
    NOT research_eligible OR (
      previous_observation_id IS NOT NULL
      AND material = true
      AND materiality_policy_version IS NOT NULL
      AND btrim(materiality_policy_version) <> ''
      AND all_causes <@ '["filing", "market", "estimate", "ownership"]'::jsonb
    )
  )
);
CREATE INDEX IF NOT EXISTS research_events_agent_ticker_created_idx
  ON research_events(agent_id, ticker, created_at DESC);
CREATE INDEX IF NOT EXISTS research_events_eligible_created_idx
  ON research_events(research_eligible, created_at DESC);
CREATE INDEX IF NOT EXISTS research_events_current_observation_idx
  ON research_events(current_observation_id, created_at DESC);

CREATE TABLE IF NOT EXISTS research_selection_runs (
  id TEXT PRIMARY KEY,
  source_run_id TEXT NOT NULL REFERENCES research_job_runs(run_id),
  policy_version TEXT NOT NULL CHECK (btrim(policy_version) <> ''),
  mode TEXT NOT NULL CHECK (mode IN ('shadow', 'canary', 'live')),
  candidate_count INTEGER NOT NULL CHECK (candidate_count >= 0),
  selected_count INTEGER NOT NULL CHECK (selected_count >= 0),
  displaced_count INTEGER NOT NULL CHECK (displaced_count >= 0),
  created_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL CHECK (completed_at >= created_at),
  payload JSONB NOT NULL,
  content_hash TEXT NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$')
);
CREATE INDEX IF NOT EXISTS research_selection_runs_source_created_idx
  ON research_selection_runs(source_run_id, created_at DESC);
CREATE INDEX IF NOT EXISTS research_selection_runs_policy_created_idx
  ON research_selection_runs(policy_version, created_at DESC);
CREATE INDEX IF NOT EXISTS research_selection_runs_mode_created_idx
  ON research_selection_runs(mode, created_at DESC);

CREATE TABLE IF NOT EXISTS research_selection_items (
  id TEXT PRIMARY KEY,
  selection_run_id TEXT NOT NULL REFERENCES research_selection_runs(id),
  ticker TEXT NOT NULL,
  agent_id agent_id NOT NULL,
  selected BOOLEAN NOT NULL,
  rank INTEGER NOT NULL CHECK (rank >= 0),
  bucket TEXT NOT NULL CHECK (btrim(bucket) <> ''),
  budget_exempt BOOLEAN NOT NULL,
  protected_reason TEXT,
  reason_codes JSONB NOT NULL CHECK (jsonb_typeof(reason_codes) = 'array'),
  triggering_observation_id TEXT REFERENCES mandate_score_observations(id),
  triggering_event_id TEXT REFERENCES research_events(id),
  compared_ticker TEXT,
  displaced_ticker TEXT,
  payload JSONB NOT NULL,
  content_hash TEXT NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  UNIQUE (selection_run_id, ticker, agent_id),
  UNIQUE (selection_run_id, rank),
  CHECK ((NOT budget_exempt AND protected_reason IS NULL) OR (budget_exempt AND protected_reason IS NOT NULL AND btrim(protected_reason) <> '')),
  CHECK (NOT budget_exempt OR (selected AND bucket IN ('holding', 'mandatory_reunderwrite') AND reason_codes ? protected_reason)),
  CHECK (
    NOT selected OR budget_exempt
    OR triggering_observation_id IS NOT NULL
    OR triggering_event_id IS NOT NULL
  )
);
CREATE INDEX IF NOT EXISTS research_selection_items_run_rank_idx
  ON research_selection_items(selection_run_id, rank);
CREATE INDEX IF NOT EXISTS research_selection_items_agent_ticker_idx
  ON research_selection_items(agent_id, ticker);
