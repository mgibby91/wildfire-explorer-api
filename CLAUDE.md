# Wildfire Explorer — Claude Code Context

## What this project is
A full-stack geospatial web application for exploring historical US wildfire
perimeters and near-real-time active fire hotspots. Built as a portfolio project
to demonstrate geospatial engineering skills for software engineering roles
involving spatial data, mapping, and location-based systems.

## Tech stack
- **Backend:** Node.js + TypeScript + Fastify + PostgreSQL + PostGIS
- **Frontend:** React + TypeScript + Mapbox GL JS (Vite)
- **ETL:** Node.js/TypeScript scripts inside `wildfire-explorer-api` (share db config)
- **Local DB:** Docker → `postgis/postgis:16-3.4`
- **Repo structure:** Two separate repos — `wildfire-explorer-api` and `wildfire-web`

## Key data sources
- **NIFC historical perimeters** — polygon dataset, all US fires on record
  Downloaded as GeoJSON, loaded via `etl/load-nifc.ts` in `wildfire-explorer-api`
- **NASA FIRMS** — active fire hotspots, VIIRS instrument, polled every 3h
  API key in `.env` as `FIRMS_API_KEY`
- **Future:** CIFFC (Canadian fires) for Phase 3

## Database conventions
- All geometry stored as `GEOMETRY(..., 4326)` — WGS84 always
- Every geometry column has a GIST index named `idx_{table}_{column}`
- Use `::geography` cast for distance queries (ST_DWithin, ST_Distance)
  so distances are in metres, not degrees
- Always use `ST_SimplifyPreserveTopology(geom, 0.001)` when returning
  geometries over the API — raw perimeters can have 10k+ vertices
- Use `&&` bbox operator before `ST_Intersects` for polygon queries
  (fast index pre-filter + precise check)

## API conventions
- All routes prefixed `/api`
- Geometry always returned as GeoJSON (`ST_AsGeoJSON(...)`)
- Responses are GeoJSON FeatureCollections where applicable
- Fastify schema validation on all query params
- Errors follow `{ error: string, statusCode: number }` shape

## Environment variables
```
PORT=3001
DB_HOST=localhost
DB_PORT=55433
DB_NAME=wildfire
DB_USER=wildfire
DB_PASSWORD=wildfire
FIRMS_API_KEY=...
MAPBOX_TOKEN=...
```

## Current build phase
See WILDFIRE_TECHNICAL_PLAN.md for the full phased plan.

**Phase 1 (current):** DB schema + ETL + core API endpoints
**Phase 2:** React + Mapbox frontend
**Phase 3:** Polish, deploy, year timeline slider, Canada data

## Useful dev commands
```bash
# In wildfire-explorer-api repo:
docker compose up -d                    # Start PostGIS (auto-runs migrations on first start)
npm run dev                             # API dev server (port 3001)
npx tsx etl/load-nifc.ts               # Run ETL loader (once)

# In wildfire-web repo:
npm run dev                             # Frontend dev server (Vite, port 5173)
```

## Useful verification queries
```sql
-- Confirm data loaded
SELECT COUNT(*), MIN(year), MAX(year) FROM fire_perimeters;

-- Confirm spatial index is used
EXPLAIN ANALYZE SELECT COUNT(*) FROM fire_perimeters
WHERE ST_DWithin(geom::geography,
  ST_SetSRID(ST_MakePoint(-114.07, 51.04), 4326)::geography, 100000);

-- Active hotspots in last 24h
SELECT COUNT(*) FROM active_hotspots
WHERE acquired_at > NOW() - INTERVAL '24 hours';
```

## Coding standards

### General
- Use arrow functions for all functions — named function declarations only where necessary (e.g. Fastify plugin signatures require `async function` in some edge cases, prefer arrow functions otherwise)
- Add a blank line between logical blocks of code (imports, declarations, logic, return)
- Use `type` imports (`import type { ... }`) for TypeScript-only imports

### Project structure
- Types live in `src/types/{domain}.types.ts` — one file per domain
- Fastify schemas live in `src/schemas/{domain}.schema.ts` — one file per domain
- Services are named after the domain concept they serve, not the data source
  (e.g. `active.service.ts`, not `firms.service.ts`)
- Routes import their schema and types from the above files — never define them inline

### API responses
- List endpoints return `FeatureCollection` with **simplified geometry** (`ST_SimplifyPreserveTopology(geom, 0.001)`) and display fields only
- Detail endpoints (single resource by ID) return a single `Feature` with **full-resolution geometry** and all fields
- DB rows are mapped to GeoJSON using a `rowTo{Domain}Feature(row)` mapper function — never map inline inside a `.map()` call
- Errors always follow `{ error: string, statusCode: number }`

## Notes & decisions
- Geometry simplified on API read, not on write — store full res, simplify for transport
- FIRMS poller prunes hotspots older than 72h to keep the table lean
- Risk score is a materialized view, refreshed nightly
- Mapbox satellite-streets style is the intended base map — fire data looks much
  better on satellite than street tiles
