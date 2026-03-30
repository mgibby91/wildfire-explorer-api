ALTER TABLE fire_perimeters
  ADD COLUMN IF NOT EXISTS geom_simplified GEOMETRY(MULTIPOLYGON, 4326);

UPDATE fire_perimeters
  SET geom_simplified = ST_SimplifyPreserveTopology(geom, 0.001)
  WHERE geom_simplified IS NULL;

CREATE INDEX IF NOT EXISTS idx_fire_perimeters_geom_simplified
  ON fire_perimeters USING GIST (geom_simplified);
