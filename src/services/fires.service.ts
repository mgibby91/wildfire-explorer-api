import { db } from '../db/client';
import type { Feature, FeatureCollection, Geometry, MultiPolygon } from 'geojson';

export interface FireProperties {
  id: number;
  fire_name: string | null;
  year: number | null;
  agency: string | null;
  state: string | null;
  acres_burned: number | null;
  distance_km?: number;
  cause?: string | null;
  fire_date_start?: Date | null;
  fire_date_end?: Date | null;
  source?: string | null;
  country?: string | null;
}

function rowToFireFeature(row: Record<string, unknown>): Feature<Geometry, FireProperties> {
  return {
    type: 'Feature',
    geometry: JSON.parse(row.geom_json as string),
    properties: {
      id: row.id as number,
      fire_name: (row.fire_name as string) ?? null,
      year: (row.year as number) ?? null,
      agency: (row.agency as string) ?? null,
      state: (row.state as string) ?? null,
      acres_burned: row.acres_burned != null ? Number(row.acres_burned) : null,
      ...(row.distance_km != null  && { distance_km: Number(row.distance_km) }),
      ...(row.cause !== undefined   && { cause: (row.cause as string) ?? null }),
      ...(row.fire_date_start !== undefined && { fire_date_start: (row.fire_date_start as Date) ?? null }),
      ...(row.fire_date_end   !== undefined && { fire_date_end:   (row.fire_date_end   as Date) ?? null }),
      ...(row.source  !== undefined && { source:  (row.source  as string) ?? null }),
      ...(row.country !== undefined && { country: (row.country as string) ?? null }),
    },
  };
}

export const getFiresNearPoint = async (
  lat: number,
  lng: number,
  radiusKm: number,
  yearMin?: number,
  yearMax?: number,
  limit: number = 50
): Promise<FeatureCollection<Geometry, FireProperties>> => {
  const { rows } = await db.query(
    `SELECT
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
      $3 * 1000
    )
    AND ($4::int IS NULL OR year >= $4)
    AND ($5::int IS NULL OR year <= $5)
    ORDER BY distance_km ASC
    LIMIT $6`,
    [lat, lng, radiusKm, yearMin ?? null, yearMax ?? null, limit]
  );

  return { type: 'FeatureCollection', features: rows.map(rowToFireFeature) };
};

export const getFiresInBbox = async (
  west: number,
  south: number,
  east: number,
  north: number,
  yearMin?: number,
  yearMax?: number,
  limit: number = 100
): Promise<FeatureCollection<Geometry, FireProperties>> => {
  const { rows } = await db.query(
    `SELECT
      id, fire_name, year, agency, state, acres_burned,
      ST_AsGeoJSON(ST_SimplifyPreserveTopology(geom, 0.001)) AS geom_json
    FROM fire_perimeters
    WHERE geom && ST_MakeEnvelope($1, $2, $3, $4, 4326)
      AND ST_Intersects(geom, ST_MakeEnvelope($1, $2, $3, $4, 4326))
      AND ($5::int IS NULL OR year >= $5)
      AND ($6::int IS NULL OR year <= $6)
    ORDER BY acres_burned DESC NULLS LAST
    LIMIT $7`,
    [west, south, east, north, yearMin ?? null, yearMax ?? null, limit]
  );

  return { type: 'FeatureCollection', features: rows.map(rowToFireFeature) };
};

export const getFireById = async (
  id: number
): Promise<Feature<MultiPolygon, FireProperties> | null> => {
  const { rows } = await db.query(
    `SELECT id, fire_name, year, agency, state, acres_burned, cause,
       fire_date_start, fire_date_end, source, country,
       ST_AsGeoJSON(geom) AS geom_json
     FROM fire_perimeters
     WHERE id = $1`,
    [id]
  );

  if (rows.length === 0) return null;
  return rowToFireFeature(rows[0]) as Feature<MultiPolygon, FireProperties>;
};
