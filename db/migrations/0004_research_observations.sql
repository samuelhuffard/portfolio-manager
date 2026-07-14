-- Additive, advisory-only research history. These tables are deliberately
-- isolated from the money, proposal, order, and accounting paths.

CREATE TABLE IF NOT EXISTS research_job_runs (
  run_id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'not_configured')),
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  source_revision TEXT NOT NULL,
  cohort_count INTEGER NOT NULL DEFAULT 0 CHECK (cohort_count >= 0),
  scored_count INTEGER NOT NULL DEFAULT 0 CHECK (scored_count >= 0),
  complete_count INTEGER NOT NULL DEFAULT 0 CHECK (complete_count >= 0),
  skipped_count INTEGER NOT NULL DEFAULT 0 CHECK (skipped_count >= 0),
  error_count INTEGER NOT NULL DEFAULT 0 CHECK (error_count >= 0),
  coverage_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  summary JSONB,
  error_summary JSONB
);
CREATE INDEX IF NOT EXISTS research_job_runs_status_started_idx
  ON research_job_runs(status, started_at DESC);

CREATE TABLE IF NOT EXISTS universe_snapshots (
  id TEXT PRIMARY KEY,
  observed_at TIMESTAMPTZ NOT NULL,
  source_revision TEXT NOT NULL,
  catalog_count INTEGER NOT NULL CHECK (catalog_count >= 0),
  eligible_count INTEGER NOT NULL CHECK (eligible_count >= 0 AND eligible_count <= catalog_count),
  membership JSONB NOT NULL,
  content_hash TEXT NOT NULL UNIQUE CHECK (content_hash ~ '^[0-9a-f]{64}$')
);
CREATE INDEX IF NOT EXISTS universe_snapshots_observed_at_idx
  ON universe_snapshots(observed_at DESC);

CREATE TABLE IF NOT EXISTS evidence_snapshots (
  id TEXT PRIMARY KEY,
  ticker TEXT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL,
  source_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  freshness_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  content_hash TEXT NOT NULL UNIQUE CHECK (content_hash ~ '^[0-9a-f]{64}$')
);
CREATE INDEX IF NOT EXISTS evidence_snapshots_ticker_observed_at_idx
  ON evidence_snapshots(ticker, observed_at DESC);

CREATE TABLE IF NOT EXISTS mandate_score_observations (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES research_job_runs(run_id),
  observed_at TIMESTAMPTZ NOT NULL,
  agent_id agent_id NOT NULL,
  mandate_id TEXT NOT NULL,
  mandate_version TEXT NOT NULL,
  mandate_universe_version TEXT NOT NULL,
  production_universe_policy_version TEXT NOT NULL,
  scoring_config_version TEXT NOT NULL,
  code_revision TEXT NOT NULL,
  ticker TEXT NOT NULL,
  universe_snapshot_id TEXT NOT NULL REFERENCES universe_snapshots(id),
  eligible BOOLEAN NOT NULL,
  eligibility_reason_codes JSONB NOT NULL,
  score NUMERIC(8,4) NOT NULL CHECK (score >= 0 AND score <= 100),
  uncapped_score NUMERIC(8,4) NOT NULL CHECK (uncapped_score >= 0 AND uncapped_score <= 100),
  raw_points NUMERIC(10,4) NOT NULL CHECK (raw_points >= 0),
  max_available_points NUMERIC(10,4) NOT NULL CHECK (max_available_points >= 0 AND max_available_points <= 100),
  complete BOOLEAN NOT NULL,
  actionable BOOLEAN NOT NULL,
  coverage_mask JSONB NOT NULL,
  missing_metrics JSONB NOT NULL,
  critical_missing_metrics JSONB NOT NULL,
  fallback_method TEXT NOT NULL,
  thin_peer_set BOOLEAN NOT NULL,
  peer_set_id TEXT NOT NULL,
  peer_set_level TEXT NOT NULL,
  peer_count INTEGER NOT NULL CHECK (peer_count >= 0),
  special_sector_key TEXT,
  score_cause TEXT NOT NULL,
  input_snapshot_id TEXT NOT NULL REFERENCES evidence_snapshots(id),
  metrics JSONB NOT NULL,
  payload JSONB NOT NULL,
  content_hash TEXT NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  UNIQUE (run_id, agent_id, ticker)
);
CREATE INDEX IF NOT EXISTS mandate_score_observations_agent_score_idx
  ON mandate_score_observations(agent_id, score DESC);
CREATE INDEX IF NOT EXISTS mandate_score_observations_ticker_observed_at_idx
  ON mandate_score_observations(ticker, observed_at DESC);
CREATE INDEX IF NOT EXISTS mandate_score_observations_agent_ticker_observed_at_idx
  ON mandate_score_observations(agent_id, ticker, observed_at DESC);
CREATE INDEX IF NOT EXISTS mandate_score_observations_score_cause_idx
  ON mandate_score_observations(score_cause);
