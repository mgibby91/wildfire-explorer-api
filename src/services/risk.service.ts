import { db } from '../db/client';

export interface RiskScore {
  score: number;
  fire_count_50km: number;
  largest_fire_acres: number | null;
  most_recent_year: number | null;
  active_hotspots_nearby: number;
}

export const getRiskScore = async (lat: number, lng: number): Promise<RiskScore> => {
  const point = `ST_SetSRID(ST_MakePoint($2, $1), 4326)`;

  const [histResult, hotspotsResult] = await Promise.all([
    db.query(
      `SELECT
        COUNT(*)::int                         AS fire_count,
        MAX(acres_burned)                     AS largest_fire_acres,
        MAX(year)                             AS most_recent_year,
        LEAST(100,
          COUNT(*) * 10
          + LOG(1 + COALESCE(SUM(acres_burned), 0)) * 2
        )::int                                AS score
       FROM fire_perimeters
       WHERE ST_DWithin(geom::geography, ${point}::geography, 50000)`,
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
    largest_fire_acres: h.largest_fire_acres != null ? Number(h.largest_fire_acres) : null,
    most_recent_year: h.most_recent_year ?? null,
    active_hotspots_nearby: hotspotsResult.rows[0].nearby ?? 0,
  };
};
