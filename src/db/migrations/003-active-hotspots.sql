CREATE TABLE active_hotspots (
  id           SERIAL PRIMARY KEY,
  latitude     NUMERIC NOT NULL,
  longitude    NUMERIC NOT NULL,
  brightness   NUMERIC,
  confidence   TEXT CHECK (confidence IN ('low', 'nominal', 'high')),
  instrument   TEXT CHECK (instrument IN ('MODIS', 'VIIRS')),
  acquired_at  TIMESTAMPTZ NOT NULL,
  geom         GEOMETRY(POINT, 4326) NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Unique constraint for upsert deduplication in the FIRMS poller
CREATE UNIQUE INDEX idx_hotspots_unique
  ON active_hotspots (latitude, longitude, acquired_at, instrument);

CREATE INDEX idx_hotspots_geom        ON active_hotspots USING GIST (geom);
CREATE INDEX idx_hotspots_acquired_at ON active_hotspots (acquired_at DESC);
