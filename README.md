# asportsmap

SportsMap är nu förberedd för att köras på Heroku med Postgres.

## Teknisk översikt

- `server.js` kör en Express-server som:
  - serverar frontend-filerna (`index.html`, `app.js`, `styles.css`),
  - exponerar `GET /api/games` som hämtar matcher från Postgres,
  - har `GET /health` för enkel hälsokontroll.
- `scripts/import-matches.js` importerar matcher från football-data.org till tabellen `games`.
- Frontend (`app.js`) läser matcher från `/api/games` som standard.

## 1) Installera lokalt

```bash
npm install
```

## 2) Konfigurera miljövariabler

Appen använder:

- `DATABASE_URL` (Postgres)
- `X_AUTH` (din football-data API token, rekommenderad)
- `FOOTBALL_DATA_API_TOKEN` (alternativt namn som också stöds)
- `FOOTBALL_COMPETITIONS` (valfri, kommaseparerad lista med competition ids, default `2013`)
- `ENABLE_GEOCODING` (default `true`, slå av med `false`)
- `NOMINATIM_EMAIL` (valfri men rekommenderad för bättre geokodningshygien)
- `GEOCODE_DELAY_MS` (default `1100`, för att undvika rate-limit)

Exempel (lokalt):

```bash
export DATABASE_URL='postgres://USER:PASSWORD@HOST:5432/DBNAME'
export X_AUTH='your-football-data-token'
# alternativt:
export FOOTBALL_DATA_API_TOKEN='your-football-data-token'
export FOOTBALL_COMPETITIONS='2013,2016,2021'
export ENABLE_GEOCODING='true'
export NOMINATIM_EMAIL='you@example.com'
```

För Heroku:

```bash
heroku config:set DATABASE_URL='postgres://USER:PASSWORD@HOST:5432/DBNAME' -a <din-app>
heroku config:set X_AUTH='your-football-data-token' -a <din-app>
# alternativt:
heroku config:set FOOTBALL_DATA_API_TOKEN='your-football-data-token' -a <din-app>
heroku config:set FOOTBALL_COMPETITIONS='2013,2016,2021' -a <din-app>
heroku config:set ENABLE_GEOCODING='true' -a <din-app>
heroku config:set NOMINATIM_EMAIL='you@example.com' -a <din-app>
```

> Importscriptet försöker flera vanliga namn: `X_AUTH`, `X-Auth`, `X_AUTH_TOKEN`, `X-Auth-Token`, `FOOTBALL_DATA_API_TOKEN`, `FOOTBALL_DATA_TOKEN`.

## 3) Skapa tabell + index

Kör SQL från `db/schema.sql`:

```bash
psql "$DATABASE_URL" -f db/schema.sql
```

## 4) Importera matcher från API

Kör import manuellt:

```bash
npm run import:matches
```

För Heroku one-off:

```bash
heroku run npm run import:matches -a <din-app>
```

Efter geocoder-förbättringar: kör importen igen så befintliga matcher uppdateras med bättre koordinater:

```bash
heroku run npm run import:matches -a <din-app>
```

Importeraren cachar arenakoordinater i tabellen `venue_locations` för snabbare framtida körningar.

## 5) Starta lokalt

```bash
npm start
```

Öppna <http://localhost:3000>.

## 6) Deploy på Heroku

`Procfile` finns redan och kör:

```txt
web: node server.js
```

Vanlig deploy-process:

```bash
git push heroku main
```

(eller aktuell branch beroende på ditt Heroku/Git-flöde).

## API-format

`GET /api/games` returnerar:

```json
{
  "games": [
    {
      "id": "12345",
      "sport": "football",
      "competition": "Championship",
      "venue": "Some Stadium",
      "city": "England",
      "country": "England",
      "capacity": null,
      "kickoff": "2026-04-17T13:00:00.000Z",
      "lat": 52.3555,
      "lng": -1.1743,
      "homeTeam": "Team A",
      "awayTeam": "Team B",
      "flagUrl": "https://crests.football-data.org/770.svg"
    }
  ]
}
```

## Felsökning

- `DATABASE_URL is not set` → sätt `DATABASE_URL` i miljön/Heroku config vars.
- `Missing API token` vid import → sätt `X_AUTH` (rekommenderat) eller `FOOTBALL_DATA_API_TOKEN` i Heroku config vars.
- `relation "games" does not exist` → kör `db/schema.sql`.
- Tom karta/för få markörer → kör om importen med geocoding aktiverad och kontrollera `venue_locations` att koordinater sparas.
