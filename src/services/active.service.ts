import { db } from '../db/client';
import type { FeatureCollection, Point } from 'geojson';

export interface HotspotProperties {
  id: number;
  latitude: number;
  longitude: number;
  brightness: number | null;
  confidence: string | null;
  instrument: string | null;
  acquired_at: Date;
}

export const getActiveHotspots = async (
  west?: number,
  south?: number,
  east?: number,
  north?: number,
  minConfidence?: string
): Promise<FeatureCollection<Point, HotspotProperties>> => {
  const confidenceOrder = ['low', 'nominal', 'high'];
  const minIdx = minConfidence ? confidenceOrder.indexOf(minConfidence) : -1;
  const allowedConfidence = minIdx >= 0 ? confidenceOrder.slice(minIdx) : null;

  const hasBbox = west != null && south != null && east != null && north != null;

  const { rows } = await db.query(
    `SELECT id, latitude, longitude, brightness, confidence, instrument, acquired_at,
       ST_AsGeoJSON(geom) AS geom_json
     FROM active_hotspots
     WHERE ($1::boolean = false OR geom && ST_MakeEnvelope($2, $3, $4, $5, 4326))
       AND ($6::text[] IS NULL OR confidence = ANY($6::text[]))
     ORDER BY acquired_at DESC`,
    [
      hasBbox,
      west ?? -168, south ?? 24, east ?? -52, north ?? 70,
      allowedConfidence,
    ]
  );

  return {
    type: 'FeatureCollection',
    features: rows.map((row) => ({
      type: 'Feature',
      geometry: JSON.parse(row.geom_json),
      properties: {
        id: row.id,
        latitude: Number(row.latitude),
        longitude: Number(row.longitude),
        brightness: row.brightness != null ? Number(row.brightness) : null,
        confidence: row.confidence,
        instrument: row.instrument,
        acquired_at: row.acquired_at,
      },
    })),
  };
};
