# keys-api

A credential pool with a rotation endpoint in front of it. Bots ask for a key, get the
least-recently-used working one, and report back when one turns out to be dead. Bun, Hono and SQLite —
one process, one file on disk.

Providers are rows, not code: the field list for a provider lives in the database, so adding one is a
POST and `GET /api/<slug>` starts working immediately.

## Running it

```sh
bun install
cp .env.example .env    # fill in the three required vars
bun run dev             # http://localhost:8787
```

Or with Docker, which is how it's meant to run:

```sh
docker compose up -d
```

The database is `data/keys.db` (`DB_PATH`), in the `keys-data` volume under compose. Back that up and
you've backed up everything — there is no other state.

### Env

| Var | What it's for |
|---|---|
| `SESSION_SECRET` | Signs the admin cookie. Any long random string. |
| `ADMIN_PASSWORD_HASH` | Dashboard password as `scrypt:<saltHex>:<keyHex>`. `.env.example` has the one-liner that prints it. |
| `NEXT_PUBLIC_ORIGIN` | Comma-separated origins allowed to call the API. This is both the CORS allowance and the CSRF check, so no trailing slashes. |
| `PORT` | Optional, 8787. |
| `DB_PATH` | Optional, `data/keys.db`. |

## Two kinds of caller

**Bots** carry a bearer token minted in the dashboard (`nunu_…`) and only get the rotation:

```sh
curl -H "authorization: Bearer $TOKEN" localhost:8787/api/youtube
# {"provider":"youtube","id":"…","name":"acct-3","secrets":{…},"use_count":12}

# a key the provider rejected — takes it out of rotation and counts the failure
curl -X PATCH -H "authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d '{"status":"flagged","reason":"403 account banned"}' \
  localhost:8787/api/youtube/<key-id>
```

A pool that can't answer is a 503, and there are two of those worth telling apart: `no_working_keys`
means there was nothing to hand out, `refresh_failed` means the keys exist but the provider wouldn't
renew them.

**The dashboard** posts to `/api/admin/login` with `{"password":"…"}`, gets an HttpOnly cookie, and
uses everything under `/api/admin`:

| Endpoint | What it does |
|---|---|
| `GET POST /api/admin/providers` | List, add |
| `PATCH DELETE /api/admin/providers/:slug` | Relabel, change fields, enable/disable, delete (takes its keys with it) |
| `GET POST /api/admin/providers/:slug/keys` | List, add |
| `PATCH DELETE /api/admin/keys/:id` | Edit secrets, note, status |
| `GET POST /api/admin/tokens` | List, mint a bot token |
| `DELETE /api/admin/tokens/:id` | Revoke |

`GET /api/health` needs no credentials and is what the container's healthcheck hits.

## Adding a provider

`fields` is what the dashboard renders as the add-key form, and the only thing the server validates a
new key against:

```sh
curl -X POST -b cookies.txt -H "content-type: application/json" \
  -d '{"slug":"spotify","label":"Spotify","fields":[
        {"name":"refresh_token","label":"Refresh token","secret":true,"required":true}]}' \
  localhost:8787/api/admin/providers
```

Seeded out of the box: `deezer` and `youtube`.

## Refresh

A provider whose credential expires needs an entry in `src/refresh/index.ts`; everything else hands its
secrets straight through. `youtube` is the one implementation — a key with a `refresh_token` is renewed
against Google before it goes out and the new token is written back, a cookie-only key is left alone.
A credential the provider actually refuses gets the key flagged; a network error or a 5xx doesn't,
because that fault is ours and not the key's.

The write-back is the part that matters. Providers that rotate the refresh token on every use kill the
old one, so an unpersisted rotation locks the key out permanently.

## Dashboard

Next.js, in `dashboard/`, deployed separately:

```sh
cd dashboard
bun install
cp .env.example .env.local   # NEXT_PUBLIC_API_URL=http://localhost:8787
bun run dev
```

Whatever origin it lands on has to be in the API's `NEXT_PUBLIC_ORIGIN`, or the admin cookie check
refuses it.

## Tests

```sh
bun test            # in-memory database, no network, no env
bun run check-types
```
