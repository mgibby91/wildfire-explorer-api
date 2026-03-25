-- Functional indexes on geography cast so ST_DWithin / ST_Distance queries
-- can use the index directly without casting every row at query time
CREATE INDEX idx_fire_perimeters_geom_geog
  ON fire_perimeters USING GIST ((geom::geography));

CREATE INDEX idx_hotspots_geom_geog
  ON active_hotspots USING GIST ((geom::geography));
