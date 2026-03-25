-- Materialized view — pre-computed fire risk per ~10km grid cell
-- Recompute nightly with: REFRESH MATERIALIZED VIEW CONCURRENTLY risk_grid
--
-- Uses ST_Centroid so each fire is assigned to exactly one cell (the cell
-- containing its centre), avoiding degenerate geometry from snapping
-- complex polygon vertices directly to the grid.
--
-- Score formula: frequency weighted more than size, capped at 100.
-- A cell with 10 fires scores higher than one with a single massive outlier.
CREATE MATERIALIZED VIEW risk_grid AS
SELECT
  ST_SnapToGrid(ST_Centroid(geom), 0.1) AS cell,
  COUNT(*)::int                          AS fire_count,
  SUM(acres_burned)                      AS total_acres,
  MAX(year)                              AS most_recent_year,
  LEAST(100,
    COUNT(*) * 10
    + LOG(1 + SUM(COALESCE(acres_burned, 0))) * 2
  )::int                                 AS score
FROM fire_perimeters
GROUP BY ST_SnapToGrid(ST_Centroid(geom), 0.1);

CREATE INDEX idx_risk_grid_cell ON risk_grid USING GIST (cell);
