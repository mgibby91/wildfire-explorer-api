CREATE TABLE fire_perimeters (
  id              SERIAL PRIMARY KEY,
  fire_name       TEXT,
  year            INT,
  agency          TEXT,
  state           TEXT,
  country         TEXT CHECK (country IN ('US', 'CA')),
  acres_burned    NUMERIC,
  cause           TEXT,
  fire_date_start DATE,
  fire_date_end   DATE,
  source          TEXT CHECK (source IN ('NIFC', 'CIFFC')),
  geom            GEOMETRY(MULTIPOLYGON, 4326) NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Unique constraint so ON CONFLICT DO NOTHING in ETL actually deduplicates
CREATE UNIQUE INDEX idx_fire_perimeters_unique
  ON fire_perimeters (fire_name, year, state, source)
  WHERE fire_name IS NOT NULL AND state IS NOT NULL;

CREATE INDEX idx_fire_perimeters_geom  ON fire_perimeters USING GIST (geom);
CREATE INDEX idx_fire_perimeters_year  ON fire_perimeters (year);
CREATE INDEX idx_fire_perimeters_state ON fire_perimeters (state);
