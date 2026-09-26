/**
 * The fixture for GET /api/desk/pipeline/ddl (DESK_FRAME3_SPEC §12.9): the
 * proposed Snowflake export schema as text, the three layers the bridge card
 * shows (RAW, CUR, MART). A .ts module rather than a .sql file so the browser
 * tests (Node) and the dev server read it the same way the JSON fixtures are
 * read.
 *
 * For now a plain TS file (the API plan's R-02). Once session B ships
 * `api/static/snowflake_proposed.sql`, the one copy the route serves verbatim
 * (§12.9, S-04), this file is generated from it by
 * `web/scripts/gen-ddl-fixture.mjs`, with a test that the two match byte for
 * byte; nothing under web/ imports a .sql file. The text below starts with the
 * file's first line, which says the schema is proposed.
 */
export const PIPELINE_DDL = `-- PROPOSED Snowflake export schema (not the current SQLite layout); nothing in this project creates it.
-- Macro Regime Radar · Desk: the Snowflake landing (RAW → CUR → MART)
-- Same three-layer shape as the SQLite build; one idempotent daily job.

CREATE SCHEMA IF NOT EXISTS RAW;
CREATE SCHEMA IF NOT EXISTS CUR;
CREATE SCHEMA IF NOT EXISTS MART;

-- RAW: exact copy of source, never edited
CREATE TABLE IF NOT EXISTS RAW.PRICES_DAILY (
  source        VARCHAR NOT NULL,
  symbol        VARCHAR NOT NULL,
  dt            DATE    NOT NULL,
  open          FLOAT,
  high          FLOAT,
  low           FLOAT,
  close         FLOAT,
  volume        NUMBER,
  ingested_at   TIMESTAMP_NTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS RAW.FRED_OBS (
  series_id      VARCHAR NOT NULL,
  dt             DATE    NOT NULL,
  value          FLOAT,
  realtime_start DATE,
  ingested_at    TIMESTAMP_NTZ NOT NULL
);

-- CURATED: one row per (series, dt), validated
CREATE TABLE IF NOT EXISTS CUR.SERIES_DAILY (
  series_key    VARCHAR NOT NULL,
  dt            DATE    NOT NULL,
  value         FLOAT   NOT NULL,
  as_of         DATE    NOT NULL,
  quality_flag  VARCHAR,
  PRIMARY KEY (series_key, dt)
);
CREATE TABLE IF NOT EXISTS CUR.REGIME_LABEL (
  dt             DATE    NOT NULL,
  regime         VARCHAR NOT NULL,
  method_version VARCHAR NOT NULL,
  inputs_hash    VARCHAR NOT NULL,
  PRIMARY KEY (dt)
);

-- MART: what Desk reads. Rebuilt, never patched.
CREATE TABLE IF NOT EXISTS MART.EVENT_STUDY (
  study_id        VARCHAR NOT NULL,
  shock           VARCHAR NOT NULL,
  cond            VARCHAR,
  horizon         NUMBER  NOT NULL,
  n               NUMBER  NOT NULL,
  hit             FLOAT,
  median          FLOAT,
  baseline_median FLOAT,
  ci_lo           FLOAT,
  ci_hi           FLOAT,
  sample_start    DATE,
  run_at          TIMESTAMP_NTZ NOT NULL,
  inputs_hash     VARCHAR NOT NULL
);
CREATE TABLE IF NOT EXISTS MART.INDEX_LEVELS (
  basket_id      VARCHAR NOT NULL,
  dt             DATE    NOT NULL,
  level          FLOAT   NOT NULL,
  rebalance_flag BOOLEAN,
  run_at         TIMESTAMP_NTZ NOT NULL,
  inputs_hash    VARCHAR NOT NULL
);

-- Every MART row carries run_at + inputs_hash → reproducible.
`;
