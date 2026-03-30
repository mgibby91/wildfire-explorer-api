# Wildfire Explorer — Technical Plan

## Stack

- **Backend:** Node.js + TypeScript + Fastify + PostGIS (PostgreSQL)
- **Frontend:** React + TypeScript + Mapbox GL JS
- **Infra:** Docker (local dev), deploy target TBD (Railway / Render / Fly.io recommended)
- **ETL:** Node.js scripts (one-time loaders + scheduled pollers)

---

## Phase 1 — Database & Server Foundation ✅ COMPLETE (2026-03-25)

### Goals

Get PostGIS running, data ingested, and core API endpoints working.
No frontend yet — validate everything with curl or a REST client.

---

### 1.1 Project Structure

Two separate repos — open each in its own VS Code window.

**`wildfire-explorer-api`** — backend, ETL, and Docker

> Repo named `wildfire-explorer-api` (not `wildfire-api` as originally planned)

```
wildfire-explorer-api/
├── CLAUDE.md
├── WILDFIRE_TECHNICAL_PLAN.md
├── docker-compose.yml
├── .env
├── src/
│   ├── server.ts
│   ├── config/
│   │   └── env.ts
│   ├── db/
│   │   ├── client.ts
│   │   └── migrations/        ← SQL files mounted into Docker at startup
│   ├── routes/
│   │   ├── fires.ts
│   │   ├── active.ts
│   │   └── risk.ts
│   ├── services/
│   │   ├── fires.service.ts
│   │   ├── firms.service.ts
│   │   └── risk.service.ts
│   └── jobs/
│       └── firms-poller.ts
├── etl/
│   ├── load-nifc.ts
│   └── load-landfire.ts
├── package.json
└── tsconfig.json
```

**`wildfire-web`** — React + Mapbox frontend

```
wildfire-web/
├── CLAUDE.md           # frontend-specific Claude context
├── .env
├── src/
│   ├── App.tsx
│   ├── components/
│   │   ├── Map/
│   │   ├── Sidebar/
│   │   └── Timeline/
│   ├── hooks/
│   └── lib/
├── package.json
└── vite.config.ts
```

---

### 1.2 Docker Setup

`docker-compose.yml` — run PostGIS locally:

> **Deviation from original plan:** migrations are mounted into `docker-entrypoint-initdb.d`
> so they run automatically on first container start — no manual migration step needed.
> Host port is `55433` (not `5432`) to avoid conflicts with any local Postgres instance.

```yaml
services:
  db:
    image: postgis/postgis:16-3.4
    container_name: wildfire-postgis
    restart: unless-stopped
    environment:
      POSTGRES_DB: wildfire
      POSTGRES_USER: wildfire
      POSTGRES_PASSWORD: wildfire
    ports:
      - "55433:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./src/db/migrations:/docker-entrypoint-initdb.d

volumes:
  postgres_data:
```

Start with: `docker compose up -d`

---

### 1.3 Database Schema

Files live in `src/db/migrations/` and are auto-applied by Docker on first start.
Name them with numeric prefixes so they run in order (`001-`, `002-`, etc.).

**001-init.sql** ✅ already exists

```sql
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS postgis_topology;
```

**002-fire-perimeters.sql** ← TODO: create this file

```sql
CREATE TABLE fire_perimeters (
  id              SERIAL PRIMARY KEY,
  fire_name       TEXT,
  year            INT,
  agency          TEXT,
  state           TEXT,
  country         TEXT CHECK (country IN ('US', 'CA')),  -- future Canada support
  acres_burned    NUMERIC,
  cause           TEXT,
  fire_date_start DATE,
  fire_date_end   DATE,
  source          TEXT,   -- 'NIFC' | 'CIFFC'
  geom            GEOMETRY(MULTIPOLYGON, 4326) NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Critical: spatial index for all polygon queries
CREATE INDEX idx_fire_perimeters_geom
  ON fire_perimeters USING GIST (geom);

-- Covering indexes for common filter patterns
CREATE INDEX idx_fire_perimeters_year  ON fire_perimeters (year);
CREATE INDEX idx_fire_perimeters_state ON fire_perimeters (state);
```

**003-active-hotspots.sql** ← TODO: create this file

```sql
CREATE TABLE active_hotspots (
  id              SERIAL PRIMARY KEY,
  latitude        NUMERIC NOT NULL,
  longitude       NUMERIC NOT NULL,
  brightness      NUMERIC,   -- FIRMS brightness temperature (Kelvin)
  confidence      TEXT,      -- 'low' | 'nominal' | 'high'
  instrument      TEXT,      -- 'MODIS' | 'VIIRS'
  acquired_at     TIMESTAMPTZ NOT NULL,
  geom            GEOMETRY(POINT, 4326) NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_hotspots_geom        ON active_hotspots USING GIST (geom);
CREATE INDEX idx_hotspots_acquired_at ON active_hotspots (acquired_at DESC);

-- Auto-expire hotspots older than 72 hours (run via cron or trigger)
-- We keep the table lean — old hotspots move to fire_perimeters context
```

**004-risk-scores.sql** ← TODO: create this file

```sql
-- Materialized view — recomputed nightly
-- Combines: proximity to historical fires + frequency + fuel load (Phase 2)
CREATE MATERIALIZED VIEW risk_grid AS
SELECT
  ST_SnapToGrid(fp.geom, 0.1) AS cell,  -- 0.1 degree grid cells (~10km)
  COUNT(*)                               AS fire_count,
  SUM(fp.acres_burned)                   AS total_acres,
  MAX(fp.year)                           AS most_recent_year,
  -- Simple composite score (0-100), normalized in app layer
  LEAST(100, COUNT(*) * 10 + LOG(1 + SUM(COALESCE(fp.acres_burned, 0))) * 2) AS raw_score
FROM fire_perimeters fp
GROUP BY ST_SnapToGrid(fp.geom, 0.1);

CREATE INDEX idx_risk_grid_cell ON risk_grid USING GIST (cell);
```

---

### 1.4 ETL — Loading NIFC Historical Perimeters

**Data source:**

- URL: https://data-nifc.opendata.arcgis.com/datasets/nifc::interagencyfireperimeterhistory-all-years-view/about
- Download: GeoJSON or Shapefile (GeoJSON preferred for Node ETL)
- Size: ~200MB, covers all US fires with recorded perimeters

**etl/load-nifc.ts** — lives in `wildfire-explorer-api/etl/`, stub exists, needs implementation:

```typescript
import { Client } from "pg";
import * as fs from "fs";

// After downloading NIFC GeoJSON to ./data/nifc-perimeters.geojson
async function loadNIFC() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const raw = fs.readFileSync("./data/nifc-perimeters.geojson", "utf-8");
  const fc = JSON.parse(raw);

  let loaded = 0;
  for (const feature of fc.features) {
    const p = feature.properties;

    // Skip features with no geometry or useless records
    if (!feature.geometry) continue;

    await client.query(
      `
      INSERT INTO fire_perimeters
        (fire_name, year, agency, state, acres_burned, cause,
         fire_date_start, fire_date_end, source, country, geom)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'NIFC','US',
              ST_SetSRID(ST_GeomFromGeoJSON($9), 4326))
      ON CONFLICT DO NOTHING
    `,
      [
        p.IncidentName,
        p.FireYear,
        p.Agency,
        p.State,
        p.GISAcres,
        p.FireCause,
        p.DateCurrent,
        p.ContainDate,
        JSON.stringify(feature.geometry),
      ],
    );

    loaded++;
    if (loaded % 1000 === 0) console.log(`Loaded ${loaded} perimeters...`);
  }

  console.log(`Done. Total loaded: ${loaded}`);
  await client.end();
}

loadNIFC().catch(console.error);
```

**Run once:** `npx tsx etl/load-nifc.ts`

> Note: project uses `tsx` not `ts-node` (see `package.json`)

> Tip for Claude Code: after this runs, query `SELECT COUNT(*), MIN(year), MAX(year) FROM fire_perimeters;`
> to verify the load. You should see 100k+ records spanning several decades.

---

### 1.5 NASA FIRMS Integration

**API setup:**

1. Register at https://firms.modaps.eosdis.nasa.gov/api/
2. Get a free MAP_KEY (instant, no approval needed)
3. Add to `.env` as `FIRMS_API_KEY`

**Endpoint format:**

```
https://firms.modaps.eosdis.nasa.gov/api/area/csv/{KEY}/VIIRS_SNPP_NRT/{BBOX}/1/{DATE}
```

Where BBOX is `W,S,E,N` and DATE is `YYYY-MM-DD`.

**jobs/firms-poller.ts** — runs every 3 hours via `node-cron`:

```typescript
import cron from "node-cron";
import fetch from "node-fetch";
import { pool } from "../db/client";

// Continental US + southern Canada bounding box
const BBOX = "-168,24,-52,70";

export function startFirmsPoller() {
  // Every 3 hours
  cron.schedule("0 */3 * * *", async () => {
    const today = new Date().toISOString().split("T")[0];
    const url =
      `https://firms.modaps.eosdis.nasa.gov/api/area/csv` +
      `/${process.env.FIRMS_API_KEY}/VIIRS_SNPP_NRT/${BBOX}/1/${today}`;

    const res = await fetch(url);
    const csv = await res.text();
    const rows = parseCSV(csv); // parse latitude, longitude, brightness, confidence, acq_date

    // Upsert — FIRMS data can repeat across polls
    for (const row of rows) {
      await pool.query(
        `
        INSERT INTO active_hotspots
          (latitude, longitude, brightness, confidence, instrument, acquired_at, geom)
        VALUES ($1,$2,$3,$4,'VIIRS',$5,
                ST_SetSRID(ST_MakePoint($2,$1), 4326))
        ON CONFLICT DO NOTHING
      `,
        [
          row.latitude,
          row.longitude,
          row.brightness,
          row.confidence,
          row.acq_date,
        ],
      );
    }

    // Prune hotspots older than 72 hours
    await pool.query(`
      DELETE FROM active_hotspots WHERE acquired_at < NOW() - INTERVAL '72 hours'
    `);
  });
}
```

---

### 1.6 API Endpoints

All routes return GeoJSON-compatible responses. Fastify handles JSON schema validation.

**GET /api/fires** — Historical perimeters near a point

```
Query params:
  lat      float    required
  lng      float    required
  radius   int      km, default 100, max 500
  year_min int      optional, filter by start year
  year_max int      optional, filter by end year
  limit    int      default 50, max 200

Response:
{
  type: "FeatureCollection",
  features: [{
    type: "Feature",
    geometry: { ... MultiPolygon GeoJSON ... },
    properties: {
      id, fire_name, year, agency, state,
      acres_burned, distance_km
    }
  }]
}
```

**Core SQL for this route:**

```sql
SELECT
  id, fire_name, year, agency, state, acres_burned,
  ROUND(ST_Distance(
    geom::geography,
    ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography
  ) / 1000) AS distance_km,
  ST_AsGeoJSON(ST_SimplifyPreserveTopology(geom, 0.001)) AS geom_json
FROM fire_perimeters
WHERE ST_DWithin(
  geom::geography,
  ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
  $3 * 1000  -- radius in meters
)
AND ($4::int IS NULL OR year >= $4)
AND ($5::int IS NULL OR year <= $5)
ORDER BY distance_km ASC
LIMIT $6
```

> Note: `ST_SimplifyPreserveTopology(geom, 0.001)` is important — raw perimeters
> can have 10k+ vertices. Simplifying for API responses keeps payload size sane.
> Store full-res geometry in DB, simplify on read.

---

**GET /api/fires/bbox** — Perimeters within a bounding box (for map viewport queries)

```
Query params:
  west, south, east, north   float   required
  year_min, year_max         int     optional
  limit                      int     default 100
```

```sql
SELECT id, fire_name, year, acres_burned,
  ST_AsGeoJSON(ST_SimplifyPreserveTopology(geom, 0.001)) AS geom_json
FROM fire_perimeters
WHERE geom && ST_MakeEnvelope($1, $2, $3, $4, 4326)  -- fast bbox index hit
  AND ST_Intersects(geom, ST_MakeEnvelope($1, $2, $3, $4, 4326))  -- precise check
ORDER BY acres_burned DESC NULLS LAST
LIMIT $5
```

> `&&` uses the GIST index for a fast bounding-box pre-filter, then
> `ST_Intersects` refines. Always use both for polygon queries.

---

**GET /api/fires/:id** — Single fire with full-resolution geometry

```sql
SELECT *, ST_AsGeoJSON(geom) AS geom_json
FROM fire_perimeters WHERE id = $1
```

---

**GET /api/active** — Current NASA FIRMS hotspots

```
Query params:
  west, south, east, north   float   optional (defaults to full NA)
  min_confidence             text    'low' | 'nominal' | 'high'
```

---

**GET /api/risk** — Risk score for a point

```
Query params:
  lat   float   required
  lng   float   required

Response:
{
  score: 73,           // 0-100
  fire_count_50km: 12,
  largest_fire_acres: 48000,
  most_recent_year: 2021,
  active_hotspots_nearby: 0
}
```

---

### 1.7 Fastify Server Setup

**src/server.ts** — scaffold exists, needs `startFirmsPoller()` wired in and `/api` prefix added:

> **Deviation:** routes are currently registered without the `/api` prefix.
> Add `{ prefix: '/api' }` to each `app.register()` call when implementing routes.
> `startFirmsPoller()` also needs to be called after server starts.

```typescript
import Fastify from "fastify";
import { env } from "./config/env";
import firesRoutes from "./routes/fires";
import activeRoutes from "./routes/active";
import riskRoutes from "./routes/risk";
import { startFirmsPoller } from "./jobs/firms-poller";

const buildApp = () => {
  const app = Fastify({ logger: true });
  app.register(import("@fastify/cors"), { origin: true });
  app.register(firesRoutes, { prefix: "/api" });
  app.register(activeRoutes, { prefix: "/api" });
  app.register(riskRoutes, { prefix: "/api" });
  return app;
};

const start = async () => {
  const app = buildApp();
  await app.listen({ port: env.port, host: "0.0.0.0" });
  startFirmsPoller();
};

void start();
```

**Key npm packages for backend** — check `package.json` for exact versions already installed.
`node-cron`, `node-fetch` still need to be added when implementing the FIRMS poller.

---

## Phase 2 — React + Mapbox Frontend (Week 2)

### Goals

Map-based UI with satellite base style, fire polygon layers, hotspot markers,
and a query sidebar. Users click a point or draw a bbox to query the API.

### Key Components

```
web/src/
├── App.tsx
├── components/
│   ├── Map/
│   │   ├── MapView.tsx          # Mapbox GL canvas, layer management
│   │   ├── FireLayer.tsx        # Historical perimeter polygons
│   │   ├── HotspotLayer.tsx     # Active FIRMS point markers (pulsing)
│   │   └── RiskOverlay.tsx      # Risk score heatmap (Phase 3)
│   ├── Sidebar/
│   │   ├── SearchPanel.tsx      # Point/bbox query controls
│   │   ├── FireCard.tsx         # Single fire result card
│   │   └── RiskBadge.tsx        # Risk score display
│   └── Timeline/
│       └── YearSlider.tsx       # Scrub through years (the "wow" feature)
├── hooks/
│   ├── useFireQuery.ts          # Wraps /api/fires fetch + state
│   ├── useActiveHotspots.ts     # Polls /api/active every 10 min
│   └── useRiskScore.ts          # Fetches risk on map click
└── lib/
    ├── mapbox.ts                # Mapbox token + style config
    └── api.ts                   # Typed API client
```

### Mapbox Setup Notes

- Use `mapbox://styles/mapbox/satellite-streets-v12` as base — fire data looks
  dramatically better on satellite than street maps
- Fire perimeters: `fill` layer with year-based color ramp (older = cool blue,
  recent = hot red/orange), `fill-opacity: 0.4`
- Fire perimeter outlines: separate `line` layer, `line-color` matched to fill
- Active hotspots: `circle` layer with `circle-color` driven by confidence field
- Add `mapbox-gl-draw` for bbox selection (user draws a rectangle to query)

### Year Slider (MVP "Wow" Feature)

Filter the `fire_perimeters` source by year using Mapbox expression filters —
no re-fetch needed, just client-side layer filtering:

```typescript
map.setFilter("fire-fills", ["==", ["get", "year"], selectedYear]);
```

Load all perimeters for the visible viewport once, then the slider is instant.

---

## Phase 2 — Remaining work (priority order)

- [x] **Draw custom bbox** — implemented with raw Mapbox mouse events (mousedown/mousemove/mouseup).
      No external dependency. `useDrawMode` hook, `SearchControls` button.
- [x] **Deploy** — API on Railway (custom PostGIS Docker image + TCP proxy), frontend on Vercel.
      `npm run deploy` scripts added to both packages.
- [x] **FRP hotspot filtering** — `frp NUMERIC` added to `active_hotspots` (migration 006),
      poller captures it with `ON CONFLICT DO UPDATE` backfill, `min_frp` query param on
      `/api/active`, frontend preset buttons (All / ≥10 MW / ≥50 MW) in `HotspotLegend`.
- [x] **Risk score** — `MapMode` context (`idle | draw | risk`), `useRiskMode` hook, `RiskRadiusLayer`
      (50km white dashed circle), `RiskPanel` in sidebar with score + 4 sub-stats. Score uses
      `MAX(score)` from pre-calibrated `risk_grid` cells to avoid saturation.
- [x] **bbox ORDER BY** — reverted to `ORDER BY acres_burned DESC NULLS LAST, year DESC`.
      Pure `year DESC` caused year diversity loss (dense viewports returned only 2024 fires,
      breaking the year slider). Final decision: largest fires always make the LIMIT cut,
      year is tiebreaker. Sidebar re-sorts client-side by year DESC independently.

## Phase 3 — Polish & Expansion

### Completed

1. **bbox ORDER BY fix** ✓ — see Phase 2 note above.

2. **Canada CIFFC data** ✓ — 48,065 records loaded (1972–2024, 13 provinces). Data source is
   NRCan NFDB shapefile (not a REST API). ETL: `etl/download-ciffc.ts` downloads + extracts zip,
   runs `ogr2ogr -dim 2` to strip Z coords and convert to NDJSON; `etl/load-ciffc.ts` mirrors
   load-nifc.ts with hectares→acres conversion (`CALC_HA * 2.47105`). Many CA fires have no
   FIRENAME so fall back to FIRE_ID (e.g. "2021-K42078") — expected, not a bug. Both data files
   loaded to Railway prod via `psql COPY` pipe (row-by-row insert is too slow over network).
   risk_grid materialized view refreshed after load.

### Next up

3. **shadcn/ui + Tailwind** — introduce as the UI foundation before further frontend work.
   Built on Radix UI primitives, Tailwind-based, no imposed design language — better fit than MUI
   for a map-first app. Install both before building any new UI components.

4. **Collapsible sidebar** — replace current fixed sidebar with shadcn/ui `Sheet` component.
   Gets animation, accessibility (focus trap, escape key), and toggle button for free. Map overlay
   controls (slider, search, legend) should account for sidebar open/closed state.

5. **Mobile-responsive layout** — address after sidebar is collapsible, since Sheet gives a
   natural mobile drawer pattern.

6. **Help modal** — a `?` icon in the top-left corner opens a modal summarising the app: what it
   is, the data sources (NIFC, NASA FIRMS, CIFFC), and links to both GitHub repos. Targets
   recruiters/employers clicking the deployed link who want to understand the project quickly.
   Implement after shadcn/ui is installed (use its `Dialog` component).

7. **Wind-adjusted spread direction** — pull NOAA Weather API (free, no key) for wind
   speed/direction at active hotspot locations. New `/api/spread` endpoint returns wind vectors;
   frontend draws directional arrows on the hotspot layer. Makes the app feel live ("what might
   happen next") rather than purely archival.

### Further expansion ideas (lower priority)

- **Evacuation route analysis** — OSM road network, flag roads intersecting active perimeters. Requires pgRouting.
- **Property-level risk scoring** — join against US county parcel data for address-level scores.
- **Alert subscription** — email when a new FIRMS hotspot appears within X km of a registered point.
- **Multi-hazard platform** — earthquake zones + flood plains as toggle layers.

---

## Environment Variables

> **Deviation:** env config uses individual `DB_*` vars instead of a single `DATABASE_URL`.
> The `db/client.ts` reads these via `src/config/env.ts`.

```env
PORT=3001
DB_HOST=localhost
DB_PORT=55433
DB_NAME=wildfire
DB_USER=wildfire
DB_PASSWORD=wildfire
FIRMS_API_KEY=your_key_here
MAPBOX_TOKEN=your_token_here
```

---

## Development Commands

```bash
# --- wildfire-explorer-api repo ---

# Start PostGIS (runs migrations automatically on first start)
docker compose up -d

# Run API in dev mode
npm run dev

# Run ETL loader (once, after downloading NIFC data)
npx tsx etl/load-nifc.ts

# Verify data loaded
psql postgresql://wildfire:wildfire@localhost:55433/wildfire \
  -c "SELECT COUNT(*), MIN(year), MAX(year) FROM fire_perimeters;"

# --- wildfire-web repo ---

# Start React dev server (Vite, port 5173)
npm run dev
```

---

## Useful PostGIS Queries for Development & Debugging

```sql
-- How many fires per year?
SELECT year, COUNT(*) as fires, SUM(acres_burned)::int as total_acres
FROM fire_perimeters GROUP BY year ORDER BY year DESC;

-- Largest fires ever recorded
SELECT fire_name, year, state, acres_burned
FROM fire_perimeters ORDER BY acres_burned DESC LIMIT 20;

-- Test radius query around Calgary
SELECT fire_name, year,
  ROUND(ST_Distance(geom::geography,
    ST_SetSRID(ST_MakePoint(-114.07, 51.04), 4326)::geography) / 1000) as dist_km
FROM fire_perimeters
WHERE ST_DWithin(geom::geography,
  ST_SetSRID(ST_MakePoint(-114.07, 51.04), 4326)::geography, 500000)
ORDER BY dist_km;

-- Check spatial index is being used
EXPLAIN ANALYZE
SELECT COUNT(*) FROM fire_perimeters
WHERE ST_DWithin(geom::geography,
  ST_SetSRID(ST_MakePoint(-114.07, 51.04), 4326)::geography, 100000);
-- Should show "Index Scan using idx_fire_perimeters_geom"

-- Active hotspots in last 24h
SELECT COUNT(*) FROM active_hotspots
WHERE acquired_at > NOW() - INTERVAL '24 hours';
```
