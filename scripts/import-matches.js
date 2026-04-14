const { Pool } = require("pg");

const DATABASE_URL = process.env.DATABASE_URL;
const API_TOKEN = process.env.X_AUTH || process.env["X-Auth"];
const COMPETITIONS = (process.env.FOOTBALL_COMPETITIONS || "2013")
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean);

if (!DATABASE_URL) {
  console.error("Missing DATABASE_URL");
  process.exit(1);
}

if (!API_TOKEN) {
  console.error("Missing API token. Set X_AUTH (or X-Auth) in environment.");
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

function guessCoords(country) {
  return COUNTRY_COORDS[country] || { lat: 20, lng: 0 };
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

function normalizeMatch(match) {
  const id = String(match.id);
  const country = match.area?.name || "Unknown";
  const coords = guessCoords(country);

  return {
    id,
    sport: "football",
    competition: match.competition?.name || "Football",
    venue: match.venue || `${match.homeTeam?.name || "Unknown venue"} Stadium`,
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
  try {
    let total = 0;

    for (const code of COMPETITIONS) {
      const payload = await fetchCompetitionMatches(code);
      const normalized = (payload.matches || []).map(normalizeMatch);
      const imported = await upsertMatches(normalized);
      total += imported;
      console.log(`Imported/updated ${imported} matches from competition ${code}`);
    }

    console.log(`Done. Imported/updated ${total} matches total.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
