# bartender-aid

**Status:** `internal_UAT` — under acceptance testing inside the team. ![status](https://img.shields.io/badge/status-internal_UAT-e8c35c?style=flat-square)

**Site:** <https://acsdd.github.io/bartender-aid/> — The project landing page.

Bartender Aid is a cocktail assistant: an Expo phone app backed by a small
Express service that keeps the recipe library in sync with TheCocktailDB and
holds the database connection open between requests.

| Part | Path | What it is |
| --- | --- | --- |
| Phone app | `mobile/bartender-aid` | Expo app |
| Phone app (v2) | `mobile/bartender-aid2` | Expo app, current build |
| Backend | `backend` | Express API, recipe sync, database keep-alive |
| Schema | `schema.sql` | PostgreSQL tables |
| Deployment | `render.yaml` | Render blueprint for the backend |

## Run

```bash
npm install     # also installs the backend dependencies
npm start       # starts the backend on $PORT (5000 by default)
```

The backend reads its connection string and API key from `backend/.env`
(`DATABASE_URL`, `COCKTAILDB_API_KEY`). Nothing else is required to run it
locally. The phone app talks to the backend over HTTP — point it at the
address your backend is reachable on before running `npx expo start`.
