const { Pool } = require("pg");

const DATABASE_URL = process.env.DATABASE_URL;
const TOKEN_ENV_CANDIDATES = [
  "X_AUTH",
  "X-Auth",
  "X_AUTH_TOKEN",
  "X-Auth-Token",
  "FOOTBALL_DATA_API_TOKEN",
  "FOOTBALL_DATA_TOKEN"
];

// Här listar vi de ID:n vi vill ha som standard om inget skrivs i terminalen
const DEFAULT_LIGUE_IDS = "2013,2021,2014,2002,2019,2015,2001,2003,2017";

const COMPETITIONS = (process.argv[2] || process.env.FOOTBALL_COMPETITIONS || DEFAULT_LIGUE_IDS)
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean);

const ENABLE_GEOCODING = process.env.ENABLE_GEOCODING !== "false";
const NOMINATIM_EMAIL = process.env.NOMINATIM_EMAIL || "";
const GEOCODE_DELAY_MS = Number(process.env.GEOCODE_DELAY_MS || 1100);

function getApiToken() {
  for (const key of TOKEN_ENV_CANDIDATES) {
    if (process.env[key]) return process.env[key];
  }

  const dynamic = Object.entries(process.env).find(([key, value]) => {
    if (!value) return false;
    const normalized = key.replace(/[^a-z0-9]/gi, "").toUpperCase();
    return normalized === "XAUTH" || normalized === "XAUTHTOKEN" || normalized === "FOOTBALLDATAAPITOKEN";
  });

  return dynamic ? dynamic[1] : "";
}

const API_TOKEN = getApiToken();

if (!DATABASE_URL) {
  console.error("Missing DATABASE_URL");
  process.exit(1);
}

if (!API_TOKEN) {
  console.error(
    `Missing API token. Set one of: ${TOKEN_ENV_CANDIDATES.join(", ")} (Heroku usually works best with X_AUTH).`
  );
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false }
});

const COUNTRY_COORDS = {
  England: { lat: 52.3555, lng: -1.1743 },
  Spain: { lat: 40.4637, lng: -3.7492 },
  Germany: { lat: 51.1657, lng: 10.4515 },
  Italy: { lat: 41.8719, lng: 12.5674 },
  France: { lat: 46.2276, lng: 2.2137 },
  Netherlands: { lat: 52.1326, lng: 5.2913 },
  Portugal: { lat: 39.3999, lng: -8.2245 },
  Belgium: { lat: 50.5039, lng: 4.4699 },
  Sweden: { lat: 60.1282, lng: 18.6435 },
  Norway: { lat: 60.472, lng: 8.4689 },
  Denmark: { lat: 56.2639, lng: 9.5018 }
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const CONTINENTAL_AREAS = new Set([
  "Europe", "South America", "North America", "Africa", "Asia", "Oceania", "World",
  "UEFA", "CONMEBOL", "CONCACAF", "CAF", "AFC", "OFC", "FIFA"
]);

function guessCoords(country) {
  return COUNTRY_COORDS[country] || { lat: 20, lng: 0 };
}

function resolveCountry(match) {
  const area = match.area?.name || "Unknown";
  if (CONTINENTAL_AREAS.has(area)) {
    return match.homeTeam?.area?.name || area;
  }
  return area;
}

function normalizeVenue(venue, country) {
  return `${(venue || "Unknown venue").trim()}|${(country || "Unknown").trim()}`.toLowerCase();
}

async function ensureVenueLocationsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS venue_locations (
      venue_key TEXT PRIMARY KEY,
      venue_name TEXT NOT NULL,
      country TEXT NOT NULL,
      lat DOUBLE PRECISION NOT NULL,
      lng DOUBLE PRECISION NOT NULL,
      source TEXT NOT NULL DEFAULT 'fallback',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function loadVenueLocationCache() {
  const cache = new Map();
  const { rows } = await pool.query("SELECT venue_key, lat, lng FROM venue_locations");
  for (const row of rows) {
    cache.set(row.venue_key, { lat: Number(row.lat), lng: Number(row.lng) });
  }
  return cache;
}

async function saveVenueLocation(venueKey, venue, country, lat, lng, source) {
  await pool.query(
    `
      INSERT INTO venue_locations (venue_key, venue_name, country, lat, lng, source, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
      ON CONFLICT (venue_key)
      DO UPDATE SET
        venue_name = EXCLUDED.venue_name,
        country = EXCLUDED.country,
        lat = EXCLUDED.lat,
        lng = EXCLUDED.lng,
        source = EXCLUDED.source,
        updated_at = NOW()
    `,
    [venueKey, venue, country, lat, lng, source]
  );
}

async function geocodeVenue(venue, country) {
  if (!ENABLE_GEOCODING) return null;

  const params = new URLSearchParams({
    q: `${venue}, ${country}`,
    format: "jsonv2",
    limit: "1"
  });

  if (NOMINATIM_EMAIL) {
    params.set("email", NOMINATIM_EMAIL);
  }

  const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
    headers: {
      "User-Agent": "asportsmap-importer/1.0"
    }
  });

  if (!response.ok) {
    return null;
  }

  const data = await response.json();
  if (!Array.isArray(data) || !data.length) {
    return null;
  }

  const top = data[0];
  const lat = Number(top.lat);
  const lng = Number(top.lon);

  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    return null;
  }

  return { lat, lng };
}

async function resolveCoords(match, locationCache) {
  const venue = match.venue || `${match.homeTeam?.name || "Unknown venue"} Stadium`;
  const country = match.area?.name || "Unknown";
  const venueKey = normalizeVenue(venue, country);

  if (locationCache.has(venueKey)) {
    return locationCache.get(venueKey);
  }

  const geocoded = await geocodeVenue(venue, country);
  if (geocoded) {
    await saveVenueLocation(venueKey, venue, country, geocoded.lat, geocoded.lng, "nominatim");
    locationCache.set(venueKey, geocoded);
    await sleep(GEOCODE_DELAY_MS);
    return geocoded;
  }

  const fallback = guessCoords(country);
  await saveVenueLocation(venueKey, venue, country, fallback.lat, fallback.lng, "fallback");
  locationCache.set(venueKey, fallback);
  return fallback;
}


async function ensureImportRunsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS import_runs (
      id BIGSERIAL PRIMARY KEY,
      status TEXT NOT NULL,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      finished_at TIMESTAMPTZ,
      competitions TEXT[] NOT NULL DEFAULT '{}',
      imported_matches INTEGER NOT NULL DEFAULT 0,
      error_message TEXT
    )
  `);
}

async function startImportRun() {
  const { rows } = await pool.query(
    `
      INSERT INTO import_runs (status, competitions, started_at)
      VALUES ('running', $1::text[], NOW())
      RETURNING id
    `,
    [COMPETITIONS]
  );
  return rows[0].id;
}

async function completeImportRun(runId, importedMatches) {
  await pool.query(
    `
      UPDATE import_runs
      SET status = 'success', imported_matches = $2, finished_at = NOW(), error_message = NULL
      WHERE id = $1
    `,
    [runId, importedMatches]
  );
}

async function failImportRun(runId, errorMessage) {
  if (!runId) return;

  await pool.query(
    `
      UPDATE import_runs
      SET status = 'failed', finished_at = NOW(), error_message = $2
      WHERE id = $1
    `,
    [runId, String(errorMessage || 'Unknown import error').slice(0, 2000)]
  );
}

async function fetchCompetitionMatches(code) {
  const url = `https://api.football-data.org/v4/competitions/${code}/matches`;
  const response = await fetch(url, {
    headers: {
      "X-Auth-Token": API_TOKEN
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`football-data API failed (${response.status}) for ${code}: ${text}`);
  }

  return response.json();
}

async function normalizeMatch(match, locationCache) {
  const id = String(match.id);
  const country = resolveCountry(match);
  const venue = match.venue || `${match.homeTeam?.name || "Unknown venue"} Stadium`;
  const coords = await resolveCoords(match, locationCache);

  return {
    id,
    sport: "football",
    competition: match.competition?.name || "Football",
    venue,
    city: country,
    country,
    capacity: null,
    kickoff: match.utcDate,
    lat: coords.lat,
    lng: coords.lng,
    homeTeam: match.homeTeam?.name || "Home",
    awayTeam: match.awayTeam?.name || "Away",
    flagUrl: match.area?.flag || ""
  };
}

async function upsertMatches(matches) {
  if (!matches.length) return 0;

  const query = `
    INSERT INTO games (
      id, sport, competition, venue, city, country, capacity, kickoff, lat, lng,
      home_team, away_team, flag_url
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
      $11, $12, $13
    )
    ON CONFLICT (id)
    DO UPDATE SET
      sport = EXCLUDED.sport,
      competition = EXCLUDED.competition,
      venue = EXCLUDED.venue,
      city = EXCLUDED.city,
      country = EXCLUDED.country,
      capacity = EXCLUDED.capacity,
      kickoff = EXCLUDED.kickoff,
      lat = EXCLUDED.lat,
      lng = EXCLUDED.lng,
      home_team = EXCLUDED.home_team,
      away_team = EXCLUDED.away_team,
      flag_url = EXCLUDED.flag_url
  `;

  let count = 0;
  for (const match of matches) {
    await pool.query(query, [
      match.id,
      match.sport,
      match.competition,
      match.venue,
      match.city,
      match.country,
      match.capacity,
      match.kickoff,
      match.lat,
      match.lng,
      match.homeTeam,
      match.awayTeam,
      match.flagUrl
    ]);
    count += 1;
  }

  return count;
}

async function main() {
  let runId = null;

  try {
    await ensureVenueLocationsTable();
    await ensureImportRunsTable();
    runId = await startImportRun();

    const locationCache = await loadVenueLocationCache();

    let total = 0;

    for (const code of COMPETITIONS) {
      const payload = await fetchCompetitionMatches(code);
      const normalized = [];

      for (const match of payload.matches || []) {
        normalized.push(await normalizeMatch(match, locationCache));
      }

      const imported = await upsertMatches(normalized);
      total += imported;
      console.log(`Imported/updated ${imported} matches from competition ${code}`);
    }

    await completeImportRun(runId, total);
    console.log(`Done. Imported/updated ${total} matches total.`);
  } catch (error) {
    await failImportRun(runId, error.message);
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
