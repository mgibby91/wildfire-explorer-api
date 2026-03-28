import cron from 'node-cron';
import { db } from '../db/client';

// Continental US + southern Canada
const BBOX = '-168,24,-52,70';

interface FirmsRow {
  latitude: string;
  longitude: string;
  bright_ti4: string;
  frp: string;
  confidence: string;
  acq_date: string;
  acq_time: string;
}

const parseCSV = (csv: string): FirmsRow[] => {
  const lines = csv.trim().split('\n');
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map((h) => h.trim());

  return lines.slice(1).map((line) => {
    const values = line.split(',').map((v) => v.trim());
    return Object.fromEntries(
      headers.map((h, i) => [h, values[i]]),
    ) as unknown as FirmsRow;
  });
};

const normaliseConfidence = (raw: string): 'low' | 'nominal' | 'high' => {
  const val = raw?.toLowerCase();
  if (val === 'l') return 'low';
  if (val === 'h') return 'high';
  return 'nominal';
};

const poll = async (): Promise<void> => {
  const apiKey = process.env.FIRMS_API_KEY;
  if (!apiKey) {
    console.warn('FIRMS_API_KEY not set — skipping poll');
    return;
  }

  const today = new Date().toISOString().split('T')[0];
  const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${apiKey}/VIIRS_SNPP_NRT/${BBOX}/1/${today}`;

  console.log(`[FIRMS] Polling ${today}...`);

  const res = await fetch(url);
  if (!res.ok) {
    console.error(`[FIRMS] Request failed: ${res.status} ${res.statusText}`);
    return;
  }

  const csv = await res.text();
  const rows = parseCSV(csv);

  if (rows.length === 0) {
    console.log('[FIRMS] No hotspots returned.');
    return;
  }

  let upserted = 0;

  for (const row of rows) {
    const lat = parseFloat(row.latitude);
    const lng = parseFloat(row.longitude);
    const brightness = parseFloat(row.bright_ti4) || null;
    const frp = parseFloat(row.frp) || null;
    const confidence = normaliseConfidence(row.confidence);
    const time = (row.acq_time ?? '0000').padStart(4, '0');
    const acquiredAt = `${row.acq_date} ${time.slice(0, 2)}:${time.slice(2, 4)}:00`;

    await db.query(
      `INSERT INTO active_hotspots
         (latitude, longitude, brightness, frp, confidence, instrument, acquired_at, geom)
       VALUES ($1::numeric, $2::numeric, $3, $4, $5, 'VIIRS', $6,
               ST_SetSRID(ST_MakePoint($2::float8, $1::float8), 4326))
       ON CONFLICT (latitude, longitude, acquired_at, instrument)
       DO UPDATE SET frp = EXCLUDED.frp WHERE active_hotspots.frp IS NULL`,
      [lat, lng, brightness, frp, confidence, acquiredAt],
    );

    upserted++;
  }

  // Prune hotspots older than 72 hours
  const { rowCount } = await db.query(
    `DELETE FROM active_hotspots WHERE acquired_at < NOW() - INTERVAL '72 hours'`,
  );

  console.log(
    `[FIRMS] Upserted ${upserted} hotspots, pruned ${rowCount ?? 0} expired.`,
  );
};

export const startFirmsPoller = (): void => {
  // Run immediately on startup, then every 3 hours
  poll().catch((err) => console.error('[FIRMS] Poll error:', err));

  cron.schedule('0 */3 * * *', () => {
    poll().catch((err) => console.error('[FIRMS] Poll error:', err));
  });

  console.log('[FIRMS] Poller started — running every 3 hours.');
};
