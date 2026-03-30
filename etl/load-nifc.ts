import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { Client } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

const DATA_PATH = path.join(__dirname, 'data', 'nifc-perimeters.ndjson');

// Parse "20140201000000" → "2014-02-01"
const parseDateCur = (raw?: string): string | null => {
  if (!raw || raw.length < 8) return null;
  const y = raw.slice(0, 4);
  const m = raw.slice(4, 6);
  const d = raw.slice(6, 8);
  const date = new Date(`${y}-${m}-${d}`);
  return isNaN(date.getTime()) ? null : `${y}-${m}-${d}`;
};

// Extract state abbreviation from UNIT_ID (e.g. "NMLNF" → "NM")
const parseState = (unitId?: string): string | null => {
  if (!unitId || unitId.length < 2) return null;
  return unitId.slice(0, 2).toUpperCase();
};

const load = async (): Promise<void> => {
  const client = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT ?? 55433),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });

  await client.connect();
  console.log('Connected to database.');
  console.log(`Reading ${DATA_PATH}...`);

  const rl = readline.createInterface({
    input: fs.createReadStream(DATA_PATH),
    crlfDelay: Infinity,
  });

  let inserted = 0;
  let skipped = 0;

  for await (const line of rl) {
    if (!line.trim()) continue;

    let feature: any;
    try {
      feature = JSON.parse(line);
    } catch {
      skipped++;
      continue;
    }

    if (!feature.geometry) {
      skipped++;
      continue;
    }

    const p = feature.properties ?? {};

    try {
      await client.query(
        `INSERT INTO fire_perimeters
           (fire_name, year, agency, state, acres_burned,
            fire_date_start, source, country, geom, geom_simplified)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'US',
                 ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($8), 4326)),
                 ST_SimplifyPreserveTopology(ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($8), 4326)), 0.001))
         ON CONFLICT (fire_name, year, state, source)
           WHERE fire_name IS NOT NULL AND state IS NOT NULL
         DO NOTHING`,
        [
          p.INCIDENT ?? null,
          p.FIRE_YEAR_INT ?? null,
          p.AGENCY ?? null,
          parseState(p.UNIT_ID),
          p.GIS_ACRES ?? null,
          parseDateCur(p.DATE_CUR),
          'NIFC',
          JSON.stringify(feature.geometry),
        ],
      );

      inserted++;
      if (inserted % 1000 === 0) console.log(`Inserted ${inserted} records...`);
    } catch (err) {
      skipped++;
      if (skipped <= 10) {
        console.warn(
          `Skipped (${p.INCIDENT}, ${p.FIRE_YEAR_INT}):`,
          (err as Error).message,
        );
      }
    }
  }

  console.log(`\nDone. Inserted: ${inserted}, Skipped: ${skipped}`);

  console.log('Updating table statistics...');
  client.on('notice', (msg) => console.log('[analyze]', msg.message));
  await client.query('ANALYZE VERBOSE fire_perimeters');

  const { rows: stats } = await client.query(
    `SELECT COUNT(*)::int AS total,
            MIN(year)      AS earliest_year,
            MAX(year)      AS latest_year,
            COUNT(DISTINCT state)::int AS states
     FROM fire_perimeters
     WHERE year BETWEEN 1900 AND 2100`,
  );
  const s = stats[0];
  console.log(`\nVerification:`);
  console.log(`  Total records : ${s.total}`);
  console.log(`  Year range    : ${s.earliest_year} – ${s.latest_year}`);
  console.log(`  States        : ${s.states}`);

  await client.end();
};

load().catch((err) => {
  console.error('ETL failed:', err);
  process.exit(1);
});
