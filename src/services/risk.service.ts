import { db } from '../db/client';

export interface RiskScore {
  score: number;
  fire_count_50km: number;
  total_acres_50km: number | null;
  most_recent_year: number | null;
  active_hotspots_nearby: number;
}

export const getRiskScore = async (lat: number, lng: number): Promise<RiskScore> => {
  const point = `ST_SetSRID(ST_MakePoint($2, $1), 4326)`;

  const [histResult, hotspotsResult] = await Promise.all([
    db.query(
      `SELECT
        COALESCE(SUM(fire_count), 0)::int     AS fire_count,
        SUM(total_acres)                      AS total_acres,
        MAX(most_recent_year)                 AS most_recent_year,
        LEAST(100,
          COALESCE(SUM(fire_count), 0) * 10
          + LOG(1 + COALESCE(SUM(total_acres), 0)) * 2
        )::int                                AS score
       FROM risk_grid
       WHERE ST_DWithin(cell::geography, ${point}::geography, 50000)`,
      [lat, lng]
    ),
    db.query(
      `SELECT COUNT(*)::int AS nearby
       FROM active_hotspots
       WHERE ST_DWithin(geom::geography, ${point}::geography, 50000)
         AND acquired_at > NOW() - INTERVAL '72 hours'`,
      [lat, lng]
    ),
  ]);

  const h = histResult.rows[0];

  return {
    score: h.score ?? 0,
    fire_count_50km: h.fire_count ?? 0,
    total_acres_50km: h.total_acres != null ? Number(h.total_acres) : null,
    most_recent_year: h.most_recent_year ?? null,
    active_hotspots_nearby: hotspotsResult.rows[0].nearby ?? 0,
  };
};
