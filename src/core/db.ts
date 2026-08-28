import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Append-only: `pragma user_version` records how many of these have run against a file, so adding a
 * column later is one more entry rather than editing a blob that `create table if not exists` skips.
 */
const MIGRATIONS = [
  `create table providers (
     -- two globs, because GLOB's * is a wildcard and not a quantifier: the first pins the opening
     -- character, the second rejects any character outside the set anywhere in the string
     slug       text primary key check (slug glob '[a-z0-9]*' and not slug glob '*[^a-z0-9_-]*'
                                        and length(slug) <= 32 and slug <> 'admin'),
     label      text not null,
     -- [{name,label,secret,required}] — drives the dashboard's add/edit form, so a new provider needs
     -- no code: POST /api/admin/providers and /api/<slug> works
     fields     text not null default '[]',
     enabled    integer not null default 1,
     created_at integer not null
   );

   create table keys (
     id            text primary key,
     provider_slug text not null references providers(slug) on delete cascade,
     name          text not null,
     secrets       text not null,
     status        text not null default 'working' check (status in ('working','flagged','disabled')),
     note          text,
     last_used_at  integer,
     use_count     integer not null default 0,
     fail_count    integer not null default 0,
     flagged_at    integer,
     flag_reason   text,
     created_at    integer not null,
     updated_at    integer not null,
     unique (provider_slug, name)
   );

   -- exactly the shape the rotation scans; ascending already puts the never-used keys first
   create index keys_rotation_idx on keys (provider_slug, status, last_used_at);

   create table api_tokens (
     id           text primary key,
     name         text not null,
     token_hash   text not null unique,
     last_used_at integer,
     revoked_at   integer,
     created_at   integer not null
   );

   insert into providers (slug, label, fields, created_at) values
     ('deezer',  'Deezer',  '[{"name":"arl","label":"ARL","secret":true,"required":true}]', unixepoch() * 1000),
     -- neither youtube field is required: the server only insists on *some* secret, so a key can carry
     -- the TV OAuth token, the cookie, or both
     ('youtube', 'YouTube', '[{"name":"refresh_token","label":"TV OAuth refresh token","secret":true},
                              {"name":"cookie","label":"Cookie header","secret":true}]', unixepoch() * 1000);`,
];

export class Db extends Database {
  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    // strict binds params as { slug } rather than { $slug }, and throws on a missing one
    super(path, { create: true, strict: true });
    this.exec("pragma journal_mode = wal");
    this.exec("pragma foreign_keys = on"); // per connection, and `on delete cascade` needs it
    this.exec("pragma busy_timeout = 5000");
    this.migrate();
  }

  private migrate() {
    const { user_version } = this.query("pragma user_version").get() as { user_version: number };
    for (let i = user_version; i < MIGRATIONS.length; i++) {
      // pragma takes no bound parameters, and i is a loop counter rather than input
      this.transaction(() => this.exec(`${MIGRATIONS[i]}\npragma user_version = ${i + 1};`))();
    }
  }
}
