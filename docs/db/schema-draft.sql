-- Portfolio Manager — Postgres schema DESIGN NOTES (Neon). See docs/adr/0001.
-- STATUS: the APPLIED schema now lives in db/migrations/0001_init.sql (run via
-- `npm run db:migrate`; already applied to Neon `neondb`). This file is the
-- annotated design reference. The structure exists, but the dual-write that
-- POPULATES it is OFF by default (PG_DUAL_WRITE) and gated on Phase 1. Generated
-- by hand from the contracts
-- package today; once the contracts cover accounting/investor shapes, the goal
-- is to generate this mechanically so the DB, app, and wire types share one
-- source (no hand-maintained drift — the exact bug class the contracts package
-- exists to kill).
--
-- Design rules baked in here:
--   * Every money mutation is transactional; broker identity is UNIQUE so a
--     retried fill cannot double-book (mirrors the crash-injection tests).
--   * Ledgers are append-only; corrections are new rows, never UPDATEs.
--   * Strategy-lot ownership is first-class (agent_id on lots), enforcing
--     invariant #3 at the data layer.

-- ── Enums (mirror contracts/proposal.js + contracts/lot.js + contracts/pipeline.js)
CREATE TYPE agent_id      AS ENUM ('agent-1', 'agent-2', 'agent-3');
CREATE TYPE proposal_side AS ENUM ('BUY', 'SELL');
CREATE TYPE proposal_status AS ENUM ('Pending', 'ApprovedForBrokerReview', 'Rejected', 'Expired');
CREATE TYPE lot_status    AS ENUM ('OPEN', 'CLOSED');
CREATE TYPE intent_source AS ENUM ('scheduled-discovery', 'lab', 'alert', 'exit-signal', 'manual');
CREATE TYPE order_state   AS ENUM (
  'Approved','Reserved','Submitted','BrokerAccepted','Partial',
  'Filled','Cancelled','Rejected','Accounted','Reconciled'
);

-- ── Research intents (contracts/pipeline.js ResearchIntentSchema) ────────────
CREATE TABLE research_intents (
  id            TEXT PRIMARY KEY,
  source        intent_source NOT NULL,
  agent_id      agent_id NOT NULL,
  ticker        TEXT,                 -- null = undirected discovery
  side          proposal_side,        -- null = undirected
  reason        TEXT NOT NULL,
  evidence_refs TEXT[] NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Proposals (contracts/proposal.js ProposalSchema) ─────────────────────────
CREATE TABLE proposals (
  id                 TEXT PRIMARY KEY,
  intent_id          TEXT REFERENCES research_intents(id),
  agent_id           agent_id NOT NULL,
  ticker             TEXT NOT NULL,
  side               proposal_side NOT NULL,
  amount_dollars     NUMERIC(14,2) NOT NULL CHECK (amount_dollars > 0),
  max_price          NUMERIC(14,4) CHECK (max_price IS NULL OR max_price > 0),
  rationale          TEXT NOT NULL,
  risk_summary       TEXT NOT NULL,
  status             proposal_status NOT NULL DEFAULT 'Pending',
  -- thesis/kill-criteria (StrategyProposalSchema) — required once agents 2/3/4 land
  thesis             TEXT,
  kill_criteria      TEXT[],
  horizon_days       INTEGER,
  created_by_user_id TEXT NOT NULL,
  created_by_email   TEXT,
  decided_at         TIMESTAMPTZ,
  decided_by_user_id TEXT,
  decision_note      TEXT,
  -- HMAC over the trade-defining fields (contracts/signature.js). Signed only on approval.
  decision_hmac      TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at         TIMESTAMPTZ NOT NULL
);
CREATE INDEX proposals_status_idx ON proposals(status) WHERE status = 'Pending';

-- ── Strategy lots (contracts/lot.js StrategyLotSchema) ───────────────────────
-- agent_id is the OWNER. 'unattributed' legacy/manual lots are represented with
-- a NULL owner (an attributed strategy never owns them; invariant #3).
CREATE TABLE lots (
  lot_id          TEXT PRIMARY KEY,
  ticker          TEXT NOT NULL,
  owner_agent_id  agent_id,               -- NULL = unattributed
  open_date       DATE NOT NULL,
  cost_per_share  NUMERIC(14,4) NOT NULL CHECK (cost_per_share >= 0),
  shares_original NUMERIC(18,4) NOT NULL CHECK (shares_original > 0),
  shares_open     NUMERIC(18,4) NOT NULL CHECK (shares_open >= 0),
  status          lot_status NOT NULL DEFAULT 'OPEN',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX lots_ticker_owner_open_idx ON lots(ticker, owner_agent_id) WHERE status = 'OPEN';

-- ── Orders + fills — the double-book guard lives here ────────────────────────
CREATE TABLE orders (
  id             TEXT PRIMARY KEY,        -- = proposal id (ref_id idempotency)
  proposal_id    TEXT NOT NULL REFERENCES proposals(id),
  state          order_state NOT NULL DEFAULT 'Approved',
  broker_order_id TEXT UNIQUE,            -- UNIQUE: a broker order maps to one row, ever
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (id = proposal_id)                -- OrderIntent.refId === proposalId
);

CREATE TABLE fills (
  id              BIGSERIAL PRIMARY KEY,
  order_id        TEXT NOT NULL REFERENCES orders(id),
  broker_order_id TEXT NOT NULL,
  ticker          TEXT NOT NULL,
  side            proposal_side NOT NULL,
  shares          NUMERIC(18,4) NOT NULL CHECK (shares > 0),
  price           NUMERIC(14,4) NOT NULL CHECK (price >= 0),
  amount          NUMERIC(16,2) NOT NULL,
  agent_id        agent_id,
  realized_gain   NUMERIC(16,2),          -- SELL only
  filled_at       TIMESTAMPTZ NOT NULL,
  -- A given broker order is accounted exactly once — the crash-replay guarantee
  -- the fill-processing tests assert, enforced by the database.
  UNIQUE (broker_order_id)
);

-- Which lots a SELL fill consumed (contracts/lot.js LotConsumptionSchema).
-- Append-only; attributes realized P&L to the consumed owned lots.
CREATE TABLE lot_consumptions (
  id                BIGSERIAL PRIMARY KEY,
  fill_id           BIGINT NOT NULL REFERENCES fills(id),
  lot_id            TEXT NOT NULL REFERENCES lots(lot_id),
  shares_consumed   NUMERIC(18,4) NOT NULL CHECK (shares_consumed > 0),
  cost_per_share    NUMERIC(14,4) NOT NULL,
  proceeds_per_share NUMERIC(14,4) NOT NULL,
  gain              NUMERIC(16,2) NOT NULL,
  owner_agent_id    agent_id,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Operational (partly exists in Redis/Sheets today) ────────────────────────
CREATE TABLE job_runs (
  id         BIGSERIAL PRIMARY KEY,
  job        TEXT NOT NULL,
  status     TEXT NOT NULL,           -- ok | failed | degraded (budget_exhausted/scan_error)
  started_at TIMESTAMPTZ NOT NULL,
  ended_at   TIMESTAMPTZ,
  detail     JSONB
);
CREATE INDEX job_runs_job_time_idx ON job_runs(job, started_at DESC);

CREATE TABLE audit_events (
  id         BIGSERIAL PRIMARY KEY,
  action     TEXT NOT NULL,
  actor      TEXT,
  target     TEXT,
  payload    JSONB,
  hmac       TEXT,                     -- append-only signed ledger row
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Accounting (contracts/accounting.js) ─────────────────────────────────────
CREATE TYPE capital_entry_type AS ENUM ('contribution', 'withdrawal');

CREATE TABLE investors (
  investor_id TEXT PRIMARY KEY,
  email       TEXT NOT NULL,          -- normalized lowercase
  name        TEXT NOT NULL
);

-- Append-only, HMAC-signed capital ledger (InvestorLedgerEntrySchema). One row
-- per contribution/withdrawal; the double-entry cash/units event ledger.
CREATE TABLE capital_entries (
  entry_id     TEXT PRIMARY KEY,
  investor_id  TEXT NOT NULL REFERENCES investors(investor_id),
  entry_date   DATE NOT NULL,
  type         capital_entry_type NOT NULL,
  amount       NUMERIC(16,2) NOT NULL CHECK (amount >= 0),
  nav_per_unit NUMERIC(18,6),
  units        NUMERIC(20,6) NOT NULL,
  row_hmac     TEXT,                  -- integrity signature; never UPDATEd
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Current holdings (PositionSchema). market_value is NULLABLE on purpose — a
-- missing quote must never be inferred as a zero/absent position.
CREATE TABLE positions (
  ticker       TEXT PRIMARY KEY,
  name         TEXT,
  shares       NUMERIC(18,4) NOT NULL CHECK (shares >= 0),
  avg_cost     NUMERIC(14,4) NOT NULL,
  cost_basis   NUMERIC(16,2) NOT NULL,
  market_value NUMERIC(16,2),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Point-in-time fund valuation (NavSnapshotSchema) — reproducible NAV.
CREATE TABLE nav_snapshots (
  id                BIGSERIAL PRIMARY KEY,
  snapshot_date     DATE NOT NULL,
  total_value       NUMERIC(18,2) NOT NULL,
  cash              NUMERIC(18,2) NOT NULL,
  units_outstanding NUMERIC(20,6) NOT NULL,
  nav_per_unit      NUMERIC(18,6),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX nav_snapshots_date_idx ON nav_snapshots(snapshot_date DESC);

-- ── Additive research history (migration 0004; advisory only) ────────────────
CREATE TABLE research_job_runs (
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
CREATE INDEX research_job_runs_status_started_idx ON research_job_runs(status, started_at DESC);

CREATE TABLE universe_snapshots (
  id TEXT PRIMARY KEY,
  observed_at TIMESTAMPTZ NOT NULL,
  source_revision TEXT NOT NULL,
  catalog_count INTEGER NOT NULL CHECK (catalog_count >= 0),
  eligible_count INTEGER NOT NULL CHECK (eligible_count >= 0 AND eligible_count <= catalog_count),
  membership JSONB NOT NULL,
  content_hash TEXT NOT NULL UNIQUE CHECK (content_hash ~ '^[0-9a-f]{64}$')
);
CREATE INDEX universe_snapshots_observed_at_idx ON universe_snapshots(observed_at DESC);

CREATE TABLE evidence_snapshots (
  id TEXT PRIMARY KEY,
  ticker TEXT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL,
  source_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  freshness_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  content_hash TEXT NOT NULL UNIQUE CHECK (content_hash ~ '^[0-9a-f]{64}$')
);
CREATE INDEX evidence_snapshots_ticker_observed_at_idx ON evidence_snapshots(ticker, observed_at DESC);

CREATE TABLE mandate_score_observations (
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
CREATE INDEX mandate_score_observations_agent_score_idx ON mandate_score_observations(agent_id, score DESC);
CREATE INDEX mandate_score_observations_ticker_observed_at_idx ON mandate_score_observations(ticker, observed_at DESC);
CREATE INDEX mandate_score_observations_agent_ticker_observed_at_idx ON mandate_score_observations(agent_id, ticker, observed_at DESC);
CREATE INDEX mandate_score_observations_score_cause_idx ON mandate_score_observations(score_cause);

-- ── Additive research events and selection history (migration 0005; advisory only) ──
CREATE TABLE research_events (
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
  CHECK ((previous_observation_id IS NOT NULL) OR (primary_cause = 'initial' AND all_causes = '["initial"]'::jsonb AND research_eligible = false)),
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
CREATE INDEX research_events_agent_ticker_created_idx ON research_events(agent_id, ticker, created_at DESC);
CREATE INDEX research_events_eligible_created_idx ON research_events(research_eligible, created_at DESC);
CREATE INDEX research_events_current_observation_idx ON research_events(current_observation_id, created_at DESC);

CREATE TABLE research_selection_runs (
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
CREATE INDEX research_selection_runs_source_created_idx ON research_selection_runs(source_run_id, created_at DESC);
CREATE INDEX research_selection_runs_policy_created_idx ON research_selection_runs(policy_version, created_at DESC);
CREATE INDEX research_selection_runs_mode_created_idx ON research_selection_runs(mode, created_at DESC);

CREATE TABLE research_selection_items (
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
CREATE INDEX research_selection_items_run_rank_idx ON research_selection_items(selection_run_id, rank);
CREATE INDEX research_selection_items_agent_ticker_idx ON research_selection_items(agent_id, ticker);

-- ── Additive immutable research outcomes (migration 0008; advisory only) ─────
CREATE TABLE research_outcomes (
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
  CHECK ((status = 'matured' AND metrics IS NOT NULL AND reason IS NULL AND exit_at IS NOT NULL) OR (status IN ('immature', 'unavailable', 'excluded') AND metrics IS NULL AND hit IS NULL))
);
CREATE INDEX research_outcomes_observation_as_of_idx ON research_outcomes(observation_id, as_of DESC, id DESC);
CREATE INDEX research_outcomes_selection_as_of_idx ON research_outcomes(selection_item_id, as_of DESC, id DESC);
CREATE INDEX research_outcomes_comparison_as_of_idx ON research_outcomes(comparison_pair_id, as_of DESC, id DESC);
CREATE INDEX research_outcomes_status_as_of_idx ON research_outcomes(status, as_of DESC, id DESC);
CREATE INDEX research_outcomes_agent_mandate_idx ON research_outcomes(agent_id, mandate_version, as_of DESC, id DESC);
CREATE INDEX research_outcomes_policy_versions_idx ON research_outcomes(horizon_policy_version, benchmark_policy_version, hit_policy_version, cost_policy_version, as_of DESC, id DESC);
