CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  sport TEXT NOT NULL,
  competition TEXT NOT NULL,
  venue TEXT NOT NULL,
  city TEXT NOT NULL,
  country TEXT NOT NULL,
  capacity INTEGER,
  kickoff TIMESTAMPTZ NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  flag_url TEXT
);

CREATE INDEX IF NOT EXISTS games_kickoff_idx ON games (kickoff);
CREATE INDEX IF NOT EXISTS games_sport_idx ON games (sport);
