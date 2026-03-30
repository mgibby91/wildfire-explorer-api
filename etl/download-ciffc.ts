import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import { execSync } from 'child_process';

const ZIP_URL =
  'https://cwfis.cfs.nrcan.gc.ca/downloads/nfdb/fire_poly/current_version/NFDB_poly.zip';

const OUT_DIR = path.resolve(__dirname, 'data');
const ZIP_FILE = path.join(OUT_DIR, 'nfdb-poly.zip');
const SHP_DIR = path.join(OUT_DIR, 'nfdb-poly');
const OUT_FILE = path.join(OUT_DIR, 'ciffc-perimeters.ndjson');

const downloadFile = (url: string, dest: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    let downloaded = 0;

    const request = (targetUrl: string) => {
      https.get(targetUrl, (res) => {
        // Follow redirects
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          request(res.headers.location);
          return;
        }

        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${targetUrl}`));
          return;
        }

        const total = parseInt(res.headers['content-length'] ?? '0', 10);

        res.on('data', (chunk: Buffer) => {
          downloaded += chunk.length;
          if (total > 0) {
            const pct = ((downloaded / total) * 100).toFixed(1);
            process.stdout.write(
              `\rDownloading... ${pct}% (${(downloaded / 1024 / 1024).toFixed(1)} MB)`,
            );
          }
        });

        res.pipe(file);
        file.on('finish', () => {
          file.close();
          process.stdout.write('\n');
          resolve();
        });
      });
    };

    request(url);
    file.on('error', (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });

const download = async (): Promise<void> => {
  if (!fs.existsSync(OUT_DIR)) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
  }

  // Step 1: download zip
  if (fs.existsSync(ZIP_FILE)) {
    const sizeMB = (fs.statSync(ZIP_FILE).size / 1024 / 1024).toFixed(1);
    console.log(`Zip already exists (${sizeMB} MB), skipping download.`);
  } else {
    console.log(`Downloading NFDB shapefile from:\n  ${ZIP_URL}\n`);
    await downloadFile(ZIP_URL, ZIP_FILE);
    const sizeMB = (fs.statSync(ZIP_FILE).size / 1024 / 1024).toFixed(1);
    console.log(`Downloaded: ${ZIP_FILE} (${sizeMB} MB)`);
  }

  // Step 2: extract zip
  if (fs.existsSync(SHP_DIR)) {
    console.log(`Extract dir already exists, skipping unzip.`);
  } else {
    console.log(`\nExtracting to ${SHP_DIR}...`);
    fs.mkdirSync(SHP_DIR, { recursive: true });
    execSync(`unzip -q "${ZIP_FILE}" -d "${SHP_DIR}"`);
    console.log('Extracted.');
  }

  // Step 3: find all .shp files (NFDB splits into 1972-2020 and 2021-2024)
  const shpFiles = fs
    .readdirSync(SHP_DIR)
    .filter((f) => f.endsWith('.shp'))
    .sort();

  if (shpFiles.length === 0) {
    throw new Error(`No .shp file found in ${SHP_DIR}`);
  }

  console.log(`\nFound ${shpFiles.length} shapefile(s):`);
  shpFiles.forEach((f) => console.log(`  ${f}`));

  // Step 4: convert all shapefiles to NDJSON (append after first)
  console.log(`\nConverting to NDJSON via ogr2ogr...`);
  console.log(`Output: ${OUT_FILE}`);

  for (let i = 0; i < shpFiles.length; i++) {
    const shpFile = path.join(SHP_DIR, shpFiles[i]);
    const appendFlag = i > 0 ? '-append' : '';
    console.log(`  Processing ${shpFiles[i]}...`);
    execSync(
      `ogr2ogr -f GeoJSONSeq \
        -t_srs EPSG:4326 \
        -dim 2 \
        ${appendFlag} \
        "${OUT_FILE}" \
        "${shpFile}"`,
      { stdio: 'inherit' },
    );
  }

  const sizeMB = (fs.statSync(OUT_FILE).size / 1024 / 1024).toFixed(1);
  console.log(`\nDone. NDJSON written to ${OUT_FILE} (${sizeMB} MB)`);
  console.log(`\nRun the loader next:\n  npx tsx etl/load-ciffc.ts`);
};

download().catch((err) => {
  console.error('\nDownload failed:', err.message);
  process.exit(1);
});
