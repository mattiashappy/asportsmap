# asportsmap

SportsMap är nu förberedd för att köras på Heroku med Postgres.

## Teknisk översikt

- `server.js` kör en Express-server som:
  - serverar frontend-filerna (`index.html`, `app.js`, `styles.css`),
  - exponerar `GET /api/games` som hämtar matcher från Postgres,
  - har `GET /health` för enkel hälsokontroll.
- Frontend (`app.js`) läser matcher från `/api/games` som standard.

## 1) Installera lokalt

```bash
npm install
```

## 2) Konfigurera databasanslutning

Appen använder miljövariabeln `DATABASE_URL`.

Exempel (lokalt):

```bash
export DATABASE_URL='postgres://USER:PASSWORD@HOST:5432/DBNAME'
```

För Heroku sätter du config var:

```bash
heroku config:set DATABASE_URL='postgres://USER:PASSWORD@HOST:5432/DBNAME' -a <din-app>
```

> Tips: På Heroku sätts `DATABASE_URL` normalt automatiskt om du lägger till Heroku Postgres add-on.

## 3) Skapa tabell + index

Kör SQL från `db/schema.sql`:

```bash
psql "$DATABASE_URL" -f db/schema.sql
```

## 4) Lägg in testdata (valfritt)

```bash
psql "$DATABASE_URL" -f db/seed.sql
```

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
      "id": "match-1",
      "sport": "football",
      "competition": "Premier League",
      "venue": "Anfield",
      "city": "Liverpool",
      "country": "England",
      "capacity": 54074,
      "kickoff": "2026-04-17T13:00:00.000Z",
      "lat": 53.4308,
      "lng": -2.9608,
      "homeTeam": "Liverpool",
      "awayTeam": "Arsenal",
      "flagUrl": "https://flagcdn.com/gb-eng.svg"
    }
  ]
}
```

## Felsökning

- `DATABASE_URL is not set` → sätt `DATABASE_URL` i din miljö/Heroku config vars.
- `relation "games" does not exist` → kör `db/schema.sql`.
- Tom karta → kontrollera att det finns framtida matcher i tabellen (`kickoff >= NOW()`).
