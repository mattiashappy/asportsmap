const { Pool } = require("pg");

const CONTINENTAL_AREAS = [
  "Europe", "South America", "North America", "Africa", "Asia", "Oceania", "World",
  "UEFA", "CONMEBOL", "CONCACAF", "CAF", "AFC", "OFC", "FIFA"
];

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false }
});

async function main() {
  const patterns = CONTINENTAL_AREAS.map((a) => `%|${a.toLowerCase()}`);

  const { rows: preview } = await pool.query(
    `SELECT venue_key, venue_name, country, source FROM venue_locations
     WHERE ${patterns.map((_, i) => `venue_key LIKE $${i + 1}`).join(" OR ")}
     ORDER BY venue_name`,
    patterns
  );

  if (!preview.length) {
    console.log("Inga kontinentala venue-poster hittades. Inget att städa.");
    return;
  }

  console.log(`Hittade ${preview.length} poster att ta bort:`);
  for (const row of preview) {
    console.log(`  ${row.venue_name} | ${row.country} | source: ${row.source} | key: ${row.venue_key}`);
  }

  const { rowCount } = await pool.query(
    `DELETE FROM venue_locations
     WHERE ${patterns.map((_, i) => `venue_key LIKE $${i + 1}`).join(" OR ")}`,
    patterns
  );

  console.log(`\nKlart. ${rowCount} poster borttagna.`);
}

main()
  .catch((err) => { console.error(err.message); process.exitCode = 1; })
  .finally(() => pool.end());
