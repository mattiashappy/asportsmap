INSERT INTO games (
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
  home_team,
  away_team,
  flag_url
)
VALUES
  (
    'match-1',
    'football',
    'Premier League',
    'Anfield',
    'Liverpool',
    'England',
    54074,
    NOW() + INTERVAL '3 days',
    53.4308,
    -2.9608,
    'Liverpool',
    'Arsenal',
    'https://flagcdn.com/gb-eng.svg'
  ),
  (
    'match-2',
    'football',
    'La Liga',
    'Santiago Bernabéu',
    'Madrid',
    'Spain',
    81044,
    NOW() + INTERVAL '5 days',
    40.4531,
    -3.6883,
    'Real Madrid',
    'Barcelona',
    'https://flagcdn.com/es.svg'
  )
ON CONFLICT (id) DO NOTHING;
