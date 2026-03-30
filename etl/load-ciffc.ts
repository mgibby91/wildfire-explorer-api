import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { Client } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

const DATA_PATH = path.join(__dirname, 'data', 'ciffc-perimeters.ndjson');

const HA_TO_ACRES = 2.47105;

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

    // Skip records with unknown year
    if (!p.YEAR || p.YEAR === -9999) {
      skipped++;
      continue;
    }

    const acresBurned =
      p.CALC_HA != null
        ? p.CALC_HA * HA_TO_ACRES
        : p.SIZE_HA != null
          ? p.SIZE_HA * HA_TO_ACRES
          : null;

    try {
      await client.query(
        `INSERT INTO fire_perimeters
           (fire_name, year, agency, state, acres_burned,
            fire_date_start, source, country, geom, geom_simplified)
         VALUES ($1, $2, $3, $4, $5, $6, 'CIFFC', 'CA',
                 ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($7), 4326)),
                 ST_SimplifyPreserveTopology(ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($7), 4326)), 0.001))
         ON CONFLICT (fire_name, year, state, source)
           WHERE fire_name IS NOT NULL AND state IS NOT NULL
         DO NOTHING`,
        [
          p.FIRENAME ?? p.FIRE_ID ?? null,
          p.YEAR,
          p.SRC_AGENCY ?? null,
          p.SRC_AGENCY ?? null,
          acresBurned,
          p.REP_DATE ?? null,
          JSON.stringify(feature.geometry),
        ],
      );

      inserted++;
      if (inserted % 1000 === 0) console.log(`Inserted ${inserted} records...`);
    } catch (err) {
      skipped++;
      if (skipped <= 10) {
        console.warn(
          `Skipped (${p.FIRENAME ?? p.FIRE_ID}, ${p.YEAR}):`,
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
    `SELECT COUNT(*)::int        AS total,
            MIN(year)            AS earliest_year,
            MAX(year)            AS latest_year,
            COUNT(DISTINCT state)::int AS provinces
     FROM fire_perimeters
     WHERE country = 'CA'`,
  );
  const s = stats[0];
  console.log(`\nVerification (CA records):`);
  console.log(`  Total records : ${s.total}`);
  console.log(`  Year range    : ${s.earliest_year} – ${s.latest_year}`);
  console.log(`  Provinces     : ${s.provinces}`);

  await client.end();
};

load().catch((err) => {
  console.error('ETL failed:', err);
  process.exit(1);
});
