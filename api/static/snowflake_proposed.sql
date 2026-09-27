-- PROPOSED Snowflake export schema (not the current SQLite layout); nothing in this project creates it.
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
