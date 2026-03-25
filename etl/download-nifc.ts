import * as fs from "fs";
import * as path from "path";

const FEATURE_SERVER =
  "https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services" +
  "/InterAgencyFirePerimeterHistory_All_Years_View/FeatureServer/0/query";

const OUT_DIR = path.resolve(__dirname, "data");
// NDJSON format (one feature per line) — avoids V8 string length limits on load
const OUT_FILE = path.join(OUT_DIR, "nifc-perimeters.ndjson");
const PAGE_SIZE = 500;

const fetchPage = async (offset: number): Promise<any> => {
  const params = new URLSearchParams({
    where: "1=1",
    outFields:
      "INCIDENT,FIRE_YEAR_INT,AGENCY,GIS_ACRES,DATE_CUR,SOURCE,UNIT_ID",
    returnGeometry: "true",
    outSR: "4326",
    f: "geojson",
    resultOffset: String(offset),
    resultRecordCount: String(PAGE_SIZE),
  });

  const res = await fetch(`${FEATURE_SERVER}?${params}`);

  if (!res.ok) {
    throw new Error(
      `HTTP ${res.status} at offset ${offset}: ${await res.text()}`,
    );
  }

  return res.json();
};

const download = async (): Promise<void> => {
  if (!fs.existsSync(OUT_DIR)) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
  }

  console.log("Starting NIFC perimeter download...");
  console.log(`Output: ${OUT_FILE}\n`);

  const allFeatures: any[] = [];
  let offset = 0;
  let page = 1;

  while (true) {
    process.stdout.write(`Fetching page ${page} (offset ${offset})...`);

    const data = await fetchPage(offset);

    if (data.error) {
      throw new Error(`API error: ${JSON.stringify(data.error)}`);
    }

    const features: any[] = data.features ?? [];
    allFeatures.push(...features);

    process.stdout.write(
      ` got ${features.length} features (total: ${allFeatures.length})\n`,
    );

    if (!data.properties?.exceededTransferLimit || features.length === 0) {
      break;
    }

    offset += features.length;
    page++;

    // Be polite to the API
    await new Promise((r) => setTimeout(r, 300));
  }

  console.log(
    `\nDownload complete. Writing ${allFeatures.length} features to disk...`,
  );

  // Write as NDJSON (one feature per line) so the loader can use readline
  // without hitting V8's max string length limit
  const stream = fs.createWriteStream(OUT_FILE);
  for (const feature of allFeatures) {
    stream.write(JSON.stringify(feature) + "\n");
  }
  await new Promise<void>((resolve, reject) => {
    stream.end(resolve);
    stream.on("error", reject);
  });

  const fileSizeMB = (fs.statSync(OUT_FILE).size / 1024 / 1024).toFixed(1);
  console.log(`Done. Saved to ${OUT_FILE} (${fileSizeMB} MB)`);
};

download().catch((err) => {
  console.error("\nDownload failed:", err.message);
  process.exit(1);
});
