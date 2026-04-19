const path = require("path");
const crypto = require("crypto");
const express = require("express");
const { Pool } = require("pg");

const app = express();
const port = process.env.PORT || 3000;

const connectionString = process.env.DATABASE_URL;
const useSsl = process.env.PGSSLMODE !== "disable";

const ADMIN_USERNAME = process.env.ADMIN_NAME || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin";
const ADMIN_SESSION_SECRET = process.env.ADMIN_SESSION_SECRET || "change-this-admin-secret";
const ADMIN_SESSION_TTL_MS = Number(process.env.ADMIN_SESSION_TTL_MS || 8 * 60 * 60 * 1000);

const pool = connectionString
  ? new Pool({
      connectionString,
      ssl: useSsl ? { rejectUnauthorized: false } : false
    })
  : null;

app.use(express.json());
app.use(express.static(path.join(__dirname)));

function toBase64Url(value) {
  return Buffer.from(value).toString("base64url");
}

function signToken(payload) {
  return crypto.createHmac("sha256", ADMIN_SESSION_SECRET).update(payload).digest("base64url");
}

function buildSessionToken(username) {
  const payload = JSON.stringify({
    username,
    exp: Date.now() + ADMIN_SESSION_TTL_MS
  });
  const encodedPayload = toBase64Url(payload);
  const signature = signToken(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

function readCookies(req) {
  const header = req.headers.cookie || "";
  return header.split(";").reduce((acc, part) => {
    const [key, ...rest] = part.trim().split("=");
    if (!key) return acc;
    acc[key] = decodeURIComponent(rest.join("="));
    return acc;
  }, {});
}

function verifySessionToken(token) {
  if (!token || !token.includes(".")) return null;

  const [encodedPayload, signature] = token.split(".");
  const expected = signToken(encodedPayload);

  if (signature !== expected) return null;

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
    if (!payload.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch (_error) {
    return null;
  }
}


async function ensureImportRunsTable() {
  if (!pool) return;

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

function requireAdminAuth(req, res, next) {
  const cookies = readCookies(req);
  const session = verifySessionToken(cookies.admin_session);

  if (!session) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  req.admin = session;
  return next();
}

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/games", async (_req, res) => {
  if (!pool) {
    return res.status(500).json({
      error: "DATABASE_URL is not set. Configure your Heroku Postgres URL first."
    });
  }

  const query = `
    SELECT
      id,
      sport,
      competition,
      venue,
      city,
      country,
      capacity,
      kickoff,
      lat,
      lng,
      home_team AS "homeTeam",
      away_team AS "awayTeam",
      flag_url AS "flagUrl"
    FROM games
    WHERE sport = 'football' AND kickoff >= NOW()
    ORDER BY kickoff ASC
  `;

  try {
    const { rows } = await pool.query(query);
    res.json({ games: rows });
  } catch (error) {
    console.error("Error reading games from Postgres", error);
    res.status(500).json({
      error: "Failed to load games from database",
      details: error.message
    });
  }
});

app.post("/api/admin/login", (req, res) => {
  const { username, password } = req.body || {};

  if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const token = buildSessionToken(username);
  const secure = process.env.NODE_ENV === "production";
  res.setHeader(
    "Set-Cookie",
    `admin_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(
      ADMIN_SESSION_TTL_MS / 1000
    )}${secure ? "; Secure" : ""}`
  );

  return res.json({ ok: true });
});

app.post("/api/admin/logout", (_req, res) => {
  res.setHeader("Set-Cookie", "admin_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0");
  res.json({ ok: true });
});

app.get("/api/admin/stats", requireAdminAuth, async (_req, res) => {
  if (!pool) {
    return res.status(500).json({
      error: "DATABASE_URL is not set. Configure your Heroku Postgres URL first."
    });
  }

  try {
    await ensureImportRunsTable();

    const [gameCounts, latestImport, failedImports] = await Promise.all([
      pool.query(
        `
        SELECT
          COUNT(*)::int AS total_games,
          COUNT(*) FILTER (WHERE kickoff >= NOW())::int AS upcoming_games,
          COUNT(*) FILTER (WHERE kickoff >= NOW() - INTERVAL '24 hours')::int AS last_24h_games
        FROM games
      `
      ),
      pool.query(
        `
        SELECT id, status, started_at, finished_at, competitions, imported_matches, error_message
        FROM import_runs
        ORDER BY started_at DESC
        LIMIT 1
      `
      ),
      pool.query(
        `
        SELECT id, started_at, finished_at, competitions, error_message
        FROM import_runs
        WHERE status = 'failed'
        ORDER BY started_at DESC
        LIMIT 10
      `
      )
    ]);

    res.json({
      counts: gameCounts.rows[0] || { total_games: 0, upcoming_games: 0, last_24h_games: 0 },
      latestImport: latestImport.rows[0] || null,
      failedImports: failedImports.rows
    });
  } catch (error) {
    console.error("Error reading admin stats", error);
    res.status(500).json({
      error: "Failed to load admin stats",
      details: error.message
    });
  }
});

app.get("/api/admin/venues", requireAdminAuth, async (_req, res) => {
  if (!pool) return res.status(500).json({ error: "DATABASE_URL is not set." });

  try {
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

    const { rows } = await pool.query(`
      SELECT
        lower(g.venue) || '_' || lower(g.country) AS venue_key,
        g.venue,
        g.city,
        g.country,
        COALESCE(vl.lat, g.lat) AS lat,
        COALESCE(vl.lng, g.lng) AS lng,
        COALESCE(vl.source, 'auto') AS source,
        counts.match_count
      FROM (
        SELECT DISTINCT ON (venue, country) venue, city, country, lat, lng
        FROM games
        ORDER BY venue, country
      ) g
      LEFT JOIN venue_locations vl ON vl.venue_key = lower(g.venue) || '_' || lower(g.country)
      LEFT JOIN (
        SELECT venue, country, COUNT(*)::int AS match_count FROM games GROUP BY venue, country
      ) counts ON counts.venue = g.venue AND counts.country = g.country
      ORDER BY g.venue ASC
    `);
    res.json({ venues: rows });
  } catch (error) {
    console.error("Error reading venues", error);
    res.status(500).json({ error: "Failed to load venues", details: error.message });
  }
});

app.put("/api/admin/venues/:venueKey", requireAdminAuth, async (req, res) => {
  if (!pool) return res.status(500).json({ error: "DATABASE_URL is not set." });

  const { venueKey } = req.params;
  const { lat, lng, venue_name, country } = req.body || {};
  const latNum = Number(lat);
  const lngNum = Number(lng);

  if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) {
    return res.status(400).json({ error: "lat and lng must be valid numbers" });
  }

  try {
    await pool.query(`
      INSERT INTO venue_locations (venue_key, venue_name, country, lat, lng, source, updated_at)
      VALUES ($1, $2, $3, $4, $5, 'manual', NOW())
      ON CONFLICT (venue_key) DO UPDATE SET
        lat = EXCLUDED.lat,
        lng = EXCLUDED.lng,
        source = 'manual',
        updated_at = NOW()
    `, [venueKey, venue_name || venueKey, country || "", latNum, lngNum]);

    await pool.query(
      `UPDATE games SET lat = $1, lng = $2 WHERE lower(venue) || '_' || lower(country) = $3`,
      [latNum, lngNum, venueKey]
    );

    res.json({ ok: true });
  } catch (error) {
    console.error("Error updating venue", error);
    res.status(500).json({ error: "Failed to update venue", details: error.message });
  }
});

app.get("/admin", (_req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(port, () => {
  console.log(`asportmap.com server running on port ${port}`);
});
