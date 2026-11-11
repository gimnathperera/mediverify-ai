-- 0002: verification reasons, citation snapshots, per-job model usage, list/retention indexes.
-- Additive only: existing rows stay valid (new columns are nullable or defaulted).

-- Why a finding is not decisive (not_constrained | not_stated | insufficient_evidence | unverified).
ALTER TABLE verification_findings
  ADD COLUMN reason text
    CHECK (reason IN ('not_constrained', 'not_stated', 'insufficient_evidence', 'unverified'));

-- Snapshot of the cited passage's location, so a citation survives a reference re-index
-- (chunk rows are replaced then and chunk_id becomes NULL via ON DELETE SET NULL).
ALTER TABLE verification_findings ADD COLUMN evidence jsonb;
ALTER TABLE verification_results ADD COLUMN coverage_evidence jsonb;

-- Model usage summed over the job's stages: {calls, promptTokens, completionTokens, costUsd}.
ALTER TABLE jobs ADD COLUMN llm_usage jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Keyset pagination of a user's documents (newest first, id as tiebreaker).
CREATE INDEX documents_owner_created_id_idx ON documents (owner_id, created_at DESC, id DESC);
-- Retention / cleanup scans.
CREATE INDEX sessions_expires_idx ON sessions (expires_at);
CREATE INDEX job_events_created_idx ON job_events (created_at);
