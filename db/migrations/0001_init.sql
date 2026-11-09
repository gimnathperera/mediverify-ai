-- 0001_init: core schema for MediVerify AI.
-- Forward-only, applied by scripts/migrate.ts inside a transaction under an advisory lock.

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ───────────────────────────── identity ─────────────────────────────
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         citext NOT NULL UNIQUE,
  password_hash text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Opaque session tokens; only sha256(token) is stored so a DB leak does not leak live sessions.
CREATE TABLE sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  bytea NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz
);
CREATE INDEX sessions_user_idx ON sessions(user_id);

-- ───────────────────────────── reference corpus ─────────────────────────────
-- One row per reference *version*. Additional versions/references are new rows (slug + version_label unique).
CREATE TABLE reference_documents (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug             text NOT NULL,
  title            text NOT NULL,
  version_label    text NOT NULL,
  filename         text NOT NULL,
  mime_type        text NOT NULL,
  sha256           text NOT NULL,
  bytes            bytea NOT NULL,
  page_count       int,
  index_status     text NOT NULL DEFAULT 'pending'
                   CHECK (index_status IN ('pending', 'indexing', 'ready', 'failed')),
  index_error      text,
  embedding_model  text,
  indexed_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (slug, version_label),
  UNIQUE (sha256)
);

CREATE TABLE reference_monographs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_document_id uuid NOT NULL REFERENCES reference_documents(id) ON DELETE CASCADE,
  name                  text NOT NULL,           -- exact heading text, e.g. 'Cordizem-XR'
  name_normalized       text NOT NULL,           -- identity key, e.g. 'cordizem-xr'
  aliases               text[] NOT NULL DEFAULT '{}', -- normalized explicit aliases only
  section_title         text,                    -- e.g. 'I. Cardiovascular Agents'
  page_start            int NOT NULL,
  page_end              int NOT NULL,
  ordinal               int NOT NULL,
  rules                 jsonb,                   -- deterministic prescribing rules parsed from the monograph
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (reference_document_id, name_normalized)
);

CREATE TABLE reference_chunks (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_document_id      uuid NOT NULL REFERENCES reference_documents(id) ON DELETE CASCADE,
  monograph_id               uuid REFERENCES reference_monographs(id) ON DELETE CASCADE,
  kind                       text NOT NULL CHECK (kind IN ('monograph', 'field', 'section', 'summary', 'coverage', 'front_matter')),
  ordinal                    int NOT NULL,
  medication_name_normalized text,
  section_title              text,
  field_label                text,                -- e.g. 'Standard adult dose'
  page_start                 int NOT NULL,
  page_end                   int NOT NULL,
  text                       text NOT NULL,
  content_hash               text NOT NULL,
  tsv                        tsvector GENERATED ALWAYS AS (to_tsvector('english', text)) STORED,
  embedding                  vector,              -- dimension depends on embedding_model
  embedding_model            text,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  UNIQUE (reference_document_id, ordinal)
);
CREATE INDEX reference_chunks_monograph_idx ON reference_chunks(monograph_id);
CREATE INDEX reference_chunks_med_idx ON reference_chunks(reference_document_id, medication_name_normalized);
CREATE INDEX reference_chunks_tsv_idx ON reference_chunks USING gin(tsv);
-- No ANN index: corpus is tens of chunks per version, exact scan gives perfect recall. Add HNSW per model at scale.

-- ───────────────────────────── user documents ─────────────────────────────
CREATE TABLE documents (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id              uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reference_document_id uuid NOT NULL REFERENCES reference_documents(id) ON DELETE RESTRICT,
  filename              text NOT NULL,
  mime_type             text NOT NULL,
  size_bytes            int NOT NULL CHECK (size_bytes > 0),
  sha256                text NOT NULL,
  bytes                 bytea NOT NULL,
  preview_pdf           bytea,                    -- DOCX converted to PDF by the worker (null for PDFs)
  page_count            int,
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX documents_owner_created_idx ON documents(owner_id, created_at DESC);
CREATE INDEX documents_owner_sha_idx ON documents(owner_id, sha256, created_at DESC);

-- ───────────────────────────── jobs / queue ─────────────────────────────
CREATE TABLE jobs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id      uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  owner_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status           text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  current_stage    text,
  attempts         int NOT NULL DEFAULT 0,
  max_attempts     int NOT NULL DEFAULT 3,
  available_at     timestamptz NOT NULL DEFAULT now(),
  lease_owner      text,
  lease_expires_at timestamptz,
  error_code       text,
  error_message    text,
  llm_provider     text,
  llm_model        text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  started_at       timestamptz,
  finished_at      timestamptz,
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_claim_idx ON jobs(available_at, created_at) WHERE status = 'queued';
CREATE INDEX jobs_lease_idx ON jobs(lease_expires_at) WHERE status = 'running';
CREATE INDEX jobs_document_idx ON jobs(document_id, created_at DESC);
CREATE INDEX jobs_owner_idx ON jobs(owner_id);

CREATE TABLE job_stages (
  job_id        uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  stage         text NOT NULL CHECK (stage IN ('parsed', 'chunked', 'embedded', 'summarized',
                  'key_points_extracted', 'entities_extracted', 'verified', 'done')),
  ordinal       int NOT NULL,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'skipped')),
  attempt       int NOT NULL DEFAULT 0,
  started_at    timestamptz,
  finished_at   timestamptz,
  duration_ms   int,
  error_code    text,
  error_message text,
  detail        text,          -- short human-readable outcome, e.g. 'reused reference index (24 chunks)'
  metadata      jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (job_id, stage)
);

-- Append-only event log; bigserial id doubles as SSE event id (monotonic per database).
CREATE TABLE job_events (
  id         bigserial PRIMARY KEY,
  job_id     uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  stage      text,
  type       text NOT NULL,
  payload    jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX job_events_job_idx ON job_events(job_id, id);

-- ───────────────────────────── pipeline outputs (keyed by job) ─────────────────────────────
CREATE TABLE document_chunks (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id           uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  document_id      uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  ordinal          int NOT NULL,
  kind             text NOT NULL CHECK (kind IN ('prose', 'table', 'table_row', 'heading')),
  page_start       int NOT NULL,
  page_end         int NOT NULL,
  section_title    text,
  text             text NOT NULL,
  data             jsonb,          -- structured cells for table rows
  embedding        vector,
  embedding_model  text,
  UNIQUE (job_id, ordinal)
);

CREATE TABLE document_summaries (
  job_id     uuid PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
  text       text NOT NULL,
  warnings   text[] NOT NULL DEFAULT '{}',
  model      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE critical_points (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id             uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  rank               int NOT NULL,
  category           text NOT NULL,
  severity           text NOT NULL CHECK (severity IN ('high', 'medium', 'low')),
  text               text NOT NULL,
  related_medication text,
  sources            jsonb NOT NULL,  -- [{page, quote, quoteValid}]
  UNIQUE (job_id, rank)
);

CREATE TABLE medication_entities (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id              uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  ordinal             int NOT NULL,
  drug_name           text NOT NULL,
  drug_name_normalized text NOT NULL,
  dose_value          numeric,
  dose_unit           text,
  dose_raw            text,
  route               text,
  route_raw           text,
  frequency           text,
  frequency_raw       text,
  timing              text,
  duration_value      numeric,
  duration_unit       text,
  duration_raw        text,
  indication          text,
  is_new_start        boolean,
  source_page         int,
  source_quote        text,
  source_quote_valid  boolean NOT NULL DEFAULT false,
  ambiguities         text[] NOT NULL DEFAULT '{}',
  UNIQUE (job_id, ordinal)
);

CREATE TABLE verification_results (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id               uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  medication_entity_id uuid NOT NULL REFERENCES medication_entities(id) ON DELETE CASCADE,
  status               text NOT NULL CHECK (status IN ('supported', 'contradicted', 'unsupported', 'incomplete')),
  monograph_id         uuid REFERENCES reference_monographs(id) ON DELETE SET NULL,
  summary              text NOT NULL,
  similar_names        text[] NOT NULL DEFAULT '{}',
  coverage_chunk_id    uuid REFERENCES reference_chunks(id) ON DELETE SET NULL,
  retrieval            jsonb NOT NULL DEFAULT '{}',  -- retrieved chunk ids + scores, for audit/eval
  UNIQUE (job_id, medication_entity_id)
);

CREATE TABLE verification_findings (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  verification_result_id uuid NOT NULL REFERENCES verification_results(id) ON DELETE CASCADE,
  field                  text NOT NULL,
  verdict                text NOT NULL CHECK (verdict IN ('consistent', 'conflict', 'not_addressed', 'unknown')),
  prescribed_value       text,
  reference_constraint   text,
  explanation            text NOT NULL,
  decided_by             text NOT NULL CHECK (decided_by IN ('deterministic', 'llm', 'both')),
  confidence             text NOT NULL CHECK (confidence IN ('high', 'medium', 'low')),
  chunk_id               uuid REFERENCES reference_chunks(id) ON DELETE SET NULL,
  quote                  text,
  quote_valid            boolean NOT NULL DEFAULT false,
  ordinal                int NOT NULL
);
CREATE INDEX verification_findings_result_idx ON verification_findings(verification_result_id, ordinal);
