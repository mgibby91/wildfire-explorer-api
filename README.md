# Wildfire Explorer API

A geospatial REST API serving historical wildfire perimeter data and real-time fire hotspot detections across North America. Built as the backend for [Wildfire Explorer](https://wildfire-explorer-web.vercel.app) — an interactive map for exploring fire history and assessing fire risk at any location.

**Live API:** `https://wildfire-api-production-9a9b.up.railway.app`
**Frontend repo:** [wildfire-explorer-web](https://github.com/mgibby91/wildfire-explorer-web)

---

## Overview

The API ingests and serves two categories of data:

**Historical fire perimeters** — 152,000+ fire polygon records sourced from the National Interagency Fire Center (NIFC) covering the US from 1980 to 2024, and the Canadian Interagency Forest Fire Centre (CIFFC) covering all Canadian provinces from 1972 to 2024. Both datasets are loaded via custom ETL pipelines into PostGIS, where they're stored as full-resolution geometries alongside pre-computed simplified versions optimised for fast map delivery.

**Active hotspot detections** — Near-real-time fire detections from NASA's FIRMS (Fire Information for Resource Management System), polled every 3 hours and stored with spatial geometry. Each poll upserts new detections and prunes data older than 72 hours to keep the table lean.

On top of this data, the API exposes a composite fire risk scoring endpoint — given any coordinate, it queries a pre-aggregated spatial grid to return a 0–100 risk score based on historical fire frequency, burn magnitude, recency, and nearby active hotspots.

---

## Tech Stack

| Layer      | Technology                                |
| ---------- | ----------------------------------------- |
| Runtime    | Node.js 20 + TypeScript                   |
| Framework  | Fastify 5                                 |
| Database   | PostgreSQL 16 + PostGIS 3.4               |
| Local DB   | Docker (`imresamu/postgis:16-3.4`, ARM64) |
| Scheduling | `node-cron` (FIRMS poller, 3h interval)   |
| Deployment | Railway (API + DB)                        |
| Build      | Multi-stage Docker image                  |

---

## API Endpoints

All routes are prefixed `/api`. Geometry is returned as GeoJSON. List endpoints return a `FeatureCollection`; the single-fire detail endpoint returns a `Feature`.

---

#### `GET /api/fires`
Returns historical fire perimeters within a radius of a coordinate.

| Parameter | Type | Required | Default | Constraints |
|---|---|---|---|---|
| `lat` | number | ✓ | — | -90 to 90 |
| `lng` | number | ✓ | — | -180 to 180 |
| `radius` | number | | 100 | 1–500 (km) |
| `year_min` | integer | | — | — |
| `year_max` | integer | | — | — |
| `limit` | integer | | 50 | 1–200 |

Results are ordered by distance from the given point ascending. Geometry is simplified to 0.001° tolerance.

---

#### `GET /api/fires/bbox`
Returns historical fire perimeters within a bounding box.

| Parameter | Type | Required | Default | Constraints |
|---|---|---|---|---|
| `west` | number | ✓ | — | -180 to 180 |
| `south` | number | ✓ | — | -90 to 90 |
| `east` | number | ✓ | — | -180 to 180 |
| `north` | number | ✓ | — | -90 to 90 |
| `year_min` | integer | | — | — |
| `year_max` | integer | | — | — |
| `limit` | integer | | 100 | 1–500 |

Results are ordered by `acres_burned DESC, year DESC`. Returns pre-computed simplified geometry from the `geom_simplified` column.

---

#### `GET /api/fires/:id`
Returns a single fire by ID with full-resolution geometry and all fields including `cause`, `fire_date_start`, `fire_date_end`, `source`, and `country`. Returns `404` if not found.

---

#### `GET /api/active`
Returns active NASA FIRMS hotspot detections.

| Parameter | Type | Required | Default | Constraints |
|---|---|---|---|---|
| `west` | number | | -168 | -180 to 180 |
| `south` | number | | 24 | -90 to 90 |
| `east` | number | | -52 | -180 to 180 |
| `north` | number | | 70 | -90 to 90 |
| `min_confidence` | string | | — | `low`, `nominal`, `high` |
| `min_frp` | number | | — | ≥ 0 |

Defaults to continental US + southern Canada when no bbox is provided. `min_confidence` is inclusive upward — `nominal` returns `nominal` and `high`. Results are ordered by `acquired_at DESC`.

---

#### `GET /api/risk`
Returns a composite fire risk score for a coordinate.

| Parameter | Type | Required |
|---|---|---|
| `lat` | number | ✓ |
| `lng` | number | ✓ |

**Response:**
```json
{
  "score": 74,
  "fire_count_50km": 31,
  "largest_fire_acres": 142000,
  "most_recent_year": 2021,
  "active_hotspots_nearby": 3
}
```

`score` is 0–100 based on the pre-aggregated `risk_grid` materialized view. All metrics are scoped to a 50km radius around the given point.

---

## Pre-Computed Geometry Simplification

The bbox fire query (`/api/fires/bbox`) is triggered when a user searches their current viewport or draws a custom area on the map. It needs to return simplified polygons for potentially hundreds of fires, and in fire-dense regions of the American West, computing `ST_SimplifyPreserveTopology(geom, 0.001)` live at query time regularly exceeded 1–2 seconds — too slow for a responsive UI.

The fix was to store a pre-computed `geom_simplified` column alongside the full-resolution geometry, populated at ETL load time and indexed separately:

```sql
-- Migration 007
ALTER TABLE fire_perimeters
  ADD COLUMN geom_simplified GEOMETRY(MULTIPOLYGON, 4326);

UPDATE fire_perimeters
  SET geom_simplified = ST_SimplifyPreserveTopology(geom, 0.001)
  WHERE geom_simplified IS NULL;

CREATE INDEX idx_fire_perimeters_geom_simplified
  ON fire_perimeters USING GIST (geom_simplified);
```

Both ETL loaders populate `geom_simplified` at insert time, so new records are never missing it. The bbox query reads directly from the pre-computed column rather than simplifying on the fly:

```sql
-- Before: live simplification on every request
ST_AsGeoJSON(ST_SimplifyPreserveTopology(geom, 0.001))

-- After: pre-computed, indexed column
ST_AsGeoJSON(geom_simplified)
```

The full-resolution `geom` column is retained and returned only by the single-fire detail endpoint (`/api/fires/:id`), where full fidelity is needed and only one geometry is returned at a time.

---

## Spatial Indexing Strategy

Every geometry column in the schema has a GiST (Generalized Search Tree) index — PostGIS's spatial index type, which organises geometries into bounding-box hierarchies for fast intersection and distance lookups.

```sql
CREATE INDEX idx_fire_perimeters_geom ON fire_perimeters USING GIST (geom);
CREATE INDEX idx_fire_perimeters_geom_simplified ON fire_perimeters USING GIST (geom_simplified);
CREATE INDEX idx_hotspots_geom ON active_hotspots USING GIST (geom);
```

**Functional geography indexes**

Distance queries — `ST_DWithin` and `ST_Distance` — require geometries to be cast to the `geography` type so that distances are calculated in metres rather than degrees. Without an index on that cast, PostgreSQL would cast every row at query time, negating the benefit of the index entirely.

The fix is a functional index that stores the cast result directly:

```sql
-- Migration 005
CREATE INDEX idx_fire_perimeters_geom_geog ON fire_perimeters USING GIST ((geom::geography));
CREATE INDEX idx_hotspots_geom_geog ON active_hotspots USING GIST ((geom::geography));
```

With this in place, queries like `ST_DWithin(geom::geography, point, radius)` hit the index directly rather than performing the cast per row. This is used by both the `/api/fires` near-point query and the 50km radius lookups in `/api/risk`.

**Deduplication via partial unique indexes**

The ETL loaders use `ON CONFLICT DO NOTHING` to safely re-run without creating duplicate records. The deduplication key for fire perimeters is `(fire_name, year, state, source)` — but not every record has a name or state, and those nulls shouldn't block insertion of genuinely distinct unnamed fires. A standard unique index treats `NULL` as distinct from everything including itself, which would break deduplication entirely for those records.

A partial unique index scoped to non-null values solves this cleanly:

```sql
CREATE UNIQUE INDEX idx_fire_perimeters_unique
  ON fire_perimeters (fire_name, year, state, source)
  WHERE fire_name IS NOT NULL AND state IS NOT NULL;
```

Records with a name and state participate in conflict detection; records without them are inserted freely. The hotspot table uses a simpler key of `(latitude, longitude, acquired_at, instrument)` since all four fields are always present.

---

## ETL Pipeline

The pipeline handles two structurally different data sources, each requiring its own download and load scripts.

**NIFC (US perimeters)**

The NIFC dataset is served via an ArcGIS Feature Server. The downloader paginates through the API in batches of 500 features, checking `exceededTransferLimit` on each response to know when to stop, with a 300ms delay between pages to be polite to the API.

The output is written as NDJSON (newline-delimited JSON — one feature per line) rather than a single JSON array. This is intentional: a full JSON array of 100k+ features would exceed V8's max string length when parsed with `JSON.parse`. NDJSON lets the loader use Node's `readline` interface to process one record at a time, keeping memory flat regardless of dataset size.

The loader extracts fields from each feature's properties, applying two transformations worth noting:
- **State** is derived from the `UNIT_ID` field (e.g. `"NMLNF"` → `"NM"`) — there is no direct state column in the source data
- **Date** is parsed from a raw `YYYYMMDDHHMMSS` string into `YYYY-MM-DD`

**CIFFC (Canadian perimeters)**

The Canadian National Fire Database is distributed as a ZIP of shapefiles — a binary format that can't be loaded directly. The downloader fetches the ZIP over HTTPS (with redirect following), extracts it, then converts each shapefile to NDJSON using `ogr2ogr`:

```bash
ogr2ogr -f GeoJSONSeq -t_srs EPSG:4326 -dim 2 output.ndjson input.shp
```

The `-t_srs EPSG:4326` flag reprojects geometries to WGS84, and `-dim 2` strips any Z coordinates. The NFDB splits its data across two shapefiles (1972–2020 and 2021–2024); the second is appended to the first output file using `-append`.

The CIFFC loader converts hectares to acres (`× 2.47105`) and maps `SRC_AGENCY` to both the `agency` and `state` columns, since Canadian data uses agency codes rather than province abbreviations for regional identification. Records with a year of `-9999` (the NFDB sentinel for unknown year) are skipped.

**Shared insert pattern**

Both ETL loaders use the same insert structure:

```sql
INSERT INTO fire_perimeters (fire_name, year, agency, state, acres_burned,
  fire_date_start, source, country, geom, geom_simplified)
VALUES (...,
  ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($N), 4326)),
  ST_SimplifyPreserveTopology(ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($N), 4326)), 0.001))
ON CONFLICT (fire_name, year, state, source)
  WHERE fire_name IS NOT NULL AND state IS NOT NULL
DO NOTHING
```

`ST_GeomFromGeoJSON` parses the geometry, `ST_SetSRID` assigns WGS84, and `ST_Multi` coerces any Polygon features into MultiPolygon to match the column type. Both `geom` and `geom_simplified` are populated in the same insert, so no backfill step is needed for new records. After loading, both scripts run `ANALYZE VERBOSE` to update table statistics for the query planner.

---

## Risk Scoring & Materialized View

The `/api/risk` endpoint returns a composite 0–100 score for any coordinate, along with contextual data (fire count, largest fire, most recent year, and nearby active hotspots). Computing this on the fly by aggregating across 152k fire perimeters would be prohibitively slow, so historical risk is pre-aggregated into a materialized view.

**The risk grid**

`risk_grid` divides North America into ~10km grid cells and pre-computes fire statistics per cell:

```sql
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
```

`ST_Centroid` assigns each fire to exactly one grid cell — using the polygon itself would cause large fires spanning multiple cells to produce degenerate geometry when snapped to the grid. `ST_SnapToGrid` at 0.1° (~10km) then groups centroids into cells.

**The score formula**

The score weights fire frequency more heavily than burn size:

- `COUNT(*) * 10` — each fire in the cell adds 10 points
- `LOG(1 + SUM(acres_burned)) * 2` — cumulative burn area on a logarithmic scale, weighted at 2x
- `LEAST(100, ...)` — hard cap at 100

The logarithmic burn component prevents a single historically large fire from dominating the score — a cell with 10 smaller fires will score higher than one with a single outlier, which better reflects ongoing fire risk.

**Query design**

At request time, the service runs two queries in parallel via `Promise.all`:

```typescript
const [histResult, hotspotsResult] = await Promise.all([
  db.query(`SELECT COALESCE(SUM(fire_count), 0)::int AS fire_count,
                   MAX(total_acres)                  AS largest_fire_acres,
                   MAX(most_recent_year)             AS most_recent_year,
                   COALESCE(MAX(score), 0)           AS score
            FROM risk_grid
            WHERE ST_DWithin(cell::geography, $point::geography, 50000)`),
  db.query(`SELECT COUNT(*)::int AS nearby
            FROM active_hotspots
            WHERE ST_DWithin(geom::geography, $point::geography, 50000)
              AND acquired_at > NOW() - INTERVAL '72 hours'`),
]);
```

`MAX(score)` is used rather than `SUM(score)` across the cells within 50km — summing pre-calibrated scores from dozens of cells would saturate at 100 almost everywhere in the western US, making the score meaningless. `MAX` returns the worst cell's score within range, which is a more useful signal. `SUM(fire_count)` is still used for the raw fire count, since that's an additive metric.

The active hotspot query is scoped to the last 72 hours, matching the pruning window of the FIRMS poller.

---

## FIRMS Poller & Hotspot Upsert Logic

Active hotspot detections come from NASA's FIRMS API (Fire Information for Resource Management System), using the VIIRS SNPP near-real-time dataset. A `node-cron` job polls the API every 3 hours, running immediately on server startup and then on a `0 */3 * * *` schedule.

Each poll fetches a CSV of detections for the last 24 hours over a fixed bounding box covering continental US and southern Canada (`-168,24,-52,70`):

```
https://firms.modaps.eosdis.nasa.gov/api/area/csv/{key}/VIIRS_SNPP_NRT/{bbox}/1/{today}
```

The CSV is parsed into rows, with two normalisation steps applied per record:
- **Confidence** — FIRMS returns single-letter codes (`L`, `H`, or anything else). These are normalised to `'low'`, `'high'`, and `'nominal'` respectively to match the column's enum constraint
- **Acquisition time** — `acq_date` and `acq_time` are separate fields in the CSV (`"2024-08-01"` and `"1430"`). These are combined into a single timestamptz: `"2024-08-01 14:30:00"`

**Upsert logic**

Each row is inserted with an `ON CONFLICT` clause keyed on `(latitude, longitude, acquired_at, instrument)`:

```sql
INSERT INTO active_hotspots
  (latitude, longitude, brightness, frp, confidence, instrument, acquired_at, geom)
VALUES (...)
ON CONFLICT (latitude, longitude, acquired_at, instrument)
DO UPDATE SET frp = EXCLUDED.frp WHERE active_hotspots.frp IS NULL
```

The conflict action only updates `frp` (Fire Radiative Power), and only when the existing row's `frp` is `NULL`. This handles a specific behaviour of the FIRMS API: FRP estimates for very recent detections can be missing on the first poll and filled in on a subsequent one. The condition ensures that once a non-null FRP is recorded it is never overwritten, while still allowing a previously missing value to be backfilled.

**Pruning**

After each poll, detections older than 72 hours are deleted:

```sql
DELETE FROM active_hotspots WHERE acquired_at < NOW() - INTERVAL '72 hours'
```

This window was chosen to match the hotspot query in `/api/risk`, which also filters to the last 72 hours — keeping the table scoped to only the data that will actually be queried.

---

## Running Locally

**Prerequisites:** Node.js 20+, Docker, and `ogr2ogr` (for the CIFFC ETL only — install via GDAL).

**1. Clone and install dependencies**
```bash
git clone https://github.com/mgibby91/wildfire-explorer-api
cd wildfire-explorer-api
npm install
```

**2. Configure environment variables**

Create a `.env` file in the project root:
```
PORT=3001
DB_HOST=localhost
DB_PORT=55433
DB_NAME=wildfire
DB_USER=wildfire
DB_PASSWORD=wildfire
FIRMS_API_KEY=your_key_here
```

A FIRMS API key can be obtained free from [firms.modaps.eosdis.nasa.gov](https://firms.modaps.eosdis.nasa.gov/api/area/).

**3. Start the database**
```bash
npm run db:up
```

This starts a PostGIS Docker container on port `55433`. On first start, Docker automatically runs all migration files from `src/db/migrations/` in order, creating the schema, indexes, and materialized view.

**4. Load data**

US perimeters (NIFC):
```bash
npx tsx etl/download-nifc.ts
npx tsx etl/load-nifc.ts
```

Canadian perimeters (CIFFC — requires `ogr2ogr`):
```bash
npx tsx etl/download-ciffc.ts
npx tsx etl/load-ciffc.ts
```

**5. Start the dev server**
```bash
npm run dev
```

The API will be available at `http://localhost:3001`. The FIRMS poller runs immediately on startup and every 3 hours thereafter.

**Useful scripts**

| Script | Description |
|---|---|
| `npm run dev` | Start dev server with hot reload |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run db:up` | Start PostGIS container |
| `npm run db:down` | Stop PostGIS container |
| `npm run db:reset` | Wipe and reinitialise the database |
| `npm run db:logs` | Tail database logs |
| `npm run deploy` | Deploy to Railway |
