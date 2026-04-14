# asportsmap

A simple Leaflet-based map UI for upcoming football games.

## Run locally

```bash
python3 -m http.server 4173
```

Open <http://localhost:4173>.

## API integration

By default the app reads from `mock-games.json`.

To wire your API, set `window.SPORTSMAP_API_URL` before `app.js` in `index.html`:

```html
<script>
  window.SPORTSMAP_API_URL = "https://your-api.example.com/upcoming-games";
</script>
```

Expected JSON payload:

```json
{
  "games": [
    {
      "id": "string",
      "sport": "football",
      "competition": "NFL",
      "venue": "Arrowhead Stadium",
      "city": "Kansas City",
      "country": "USA",
      "capacity": 76416,
      "kickoff": "2026-11-24T20:00:00-06:00",
      "lat": 39.0489,
      "lng": -94.4839,
      "homeTeam": "Kansas City Chiefs",
      "awayTeam": "Seattle Seahawks",
      "flagUrl": "https://flagcdn.com/us.svg"
    }
  ]
}
```

Only `sport === "football"` is rendered right now.
