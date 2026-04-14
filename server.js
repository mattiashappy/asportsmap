const path = require("path");
const express = require("express");
const { Pool } = require("pg");

const app = express();
const port = process.env.PORT || 3000;

const connectionString = process.env.DATABASE_URL;
const useSsl = process.env.PGSSLMODE !== "disable";

const pool = connectionString
  ? new Pool({
      connectionString,
      ssl: useSsl ? { rejectUnauthorized: false } : false
    })
  : null;

app.use(express.static(path.join(__dirname)));

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

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(port, () => {
  console.log(`SportsMap server running on port ${port}`);
});
