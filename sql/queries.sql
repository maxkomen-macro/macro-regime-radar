-- Last 12 months of regime history
SELECT date, label, confidence
FROM regimes
ORDER BY date DESC
LIMIT 12;

-- Count months per regime (all time)
SELECT label, COUNT(*) AS months
FROM regimes
GROUP BY label
ORDER BY months DESC;

-- Currently triggered signals (most recent month)
SELECT date, signal_name, value
FROM signals
WHERE triggered = 1
  AND date = (SELECT MAX(date) FROM signals)
ORDER BY signal_name;

-- Yield curve spread history (last 24 months)
SELECT date, value AS spread_pp
FROM signals
WHERE signal_name = 'yield_curve_inversion'
ORDER BY date DESC
LIMIT 24;

-- CPI YoY history (last 24 months)
SELECT date, value AS cpi_yoy_pct
FROM signals
WHERE signal_name = 'cpi_hot'
ORDER BY date DESC
LIMIT 24;

-- Regime transitions (where label differs from previous month)
SELECT curr.date, prev.label AS from_regime, curr.label AS to_regime
FROM regimes curr
JOIN regimes prev ON prev.date = (
    SELECT MAX(date) FROM regimes WHERE date < curr.date
)
WHERE curr.label != prev.label
ORDER BY curr.date DESC;

-- Raw series row counts per series
SELECT series_id, COUNT(*) AS observations, MIN(date) AS earliest, MAX(date) AS latest
FROM raw_series
GROUP BY series_id
ORDER BY series_id;
