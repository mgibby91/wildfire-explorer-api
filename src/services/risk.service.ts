import { db } from '../db/client';

export interface RiskScore {
  score: number;
  fire_count_50km: number;
  largest_fire_acres: number | null;
  most_recent_year: number | null;
  active_hotspots_nearby: number;
}

export const getRiskScore = async (
  lat: number,
  lng: number,
): Promise<RiskScore> => {
  const point = `ST_SetSRID(ST_MakePoint($2, $1), 4326)`;

  const [histResult, hotspotsResult] = await Promise.all([
    db.query(
      // Use MAX(score) from pre-calibrated risk_grid cells rather than
      // re-aggregating raw counts — summing fire_count across dozens of cells
      // within 50km causes the score to saturate at 100 almost everywhere.
      `SELECT
        COALESCE(SUM(fire_count), 0)::int  AS fire_count,
        MAX(total_acres)                   AS largest_fire_acres,
        MAX(most_recent_year)              AS most_recent_year,
        COALESCE(MAX(score), 0)            AS score
       FROM risk_grid
       WHERE ST_DWithin(cell::geography, ${point}::geography, 50000)`,
      [lat, lng],
    ),
    db.query(
      `SELECT COUNT(*)::int AS nearby
       FROM active_hotspots
       WHERE ST_DWithin(geom::geography, ${point}::geography, 50000)
         AND acquired_at > NOW() - INTERVAL '72 hours'`,
      [lat, lng],
    ),
  ]);

  const h = histResult.rows[0];

  return {
    score: h.score ?? 0,
    fire_count_50km: h.fire_count ?? 0,
    largest_fire_acres:
      h.largest_fire_acres != null ? Number(h.largest_fire_acres) : null,
    most_recent_year: h.most_recent_year ?? null,
    active_hotspots_nearby: hotspotsResult.rows[0].nearby ?? 0,
  };
};
