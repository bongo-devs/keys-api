// Real HTTP against `bun src/index.ts`, so route precedence (/api/admin/* and /api/health against the
// /api/:provider wildcard) and CORS are part of what's under test. The database is a throwaway file in a
// temp directory, so there is no cleanup dance: afterAll deletes the directory and everything in it.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes, scryptSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Db } from "../src/core/db";
import { Auth } from "../src/features/auth";
import { KeyRepo } from "../src/features/keys";
import { ProviderRepo } from "../src/features/providers";
import { TokenRepo } from "../src/features/tokens";

const P = "zz-test";
const OTHER = "zz-other";
const PASSWORD = "correct-horse-battery-staple";
const DASHBOARD = "http://localhost:3000";
// A second allowed origin, because DASHBOARD_ORIGIN is a list: the dashboard plus whatever else calls in.
const OTHER_ORIGIN = "https://bot.example";

const salt = randomBytes(16);
const dir = mkdtempSync(join(tmpdir(), "keys-api-"));
const config = {
  port: 0,
  dbPath: join(dir, "keys.db"),
  sessionSecret: "test-session-secret",
  adminPasswordHash: `scrypt:${salt.toString("hex")}:${scryptSync(PASSWORD, salt, 64).toString("hex")}`,
  origins: [DASHBOARD, OTHER_ORIGIN],
};

let base = "";
let child: Bun.Subprocess | null = null;
let db: Db;
let token = "";
let revoked = "";
let cookie = "";

const alive = async () => {
  try {
    return (await fetch(`${base}/api/health`)).ok;
  } catch {
    return false;
  }
};

const bot = (path: string, init?: RequestInit) =>
  fetch(base + path, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...init?.headers },
  });

const adm = (path: string, init?: RequestInit) =>
  fetch(base + path, {
    ...init,
    headers: { cookie, "content-type": "application/json", ...init?.headers },
  });

const row = (id: string) =>
  db.query("select * from keys where id = $id").get({ id }) as Record<string, unknown> | null;

/** Reaches past the API, for the states it deliberately has no route for. `$slug` is always the fixture. */
const setup = (sql: string) => db.query(sql).run({ slug: P });

beforeAll(async () => {
  // Ask the kernel for a port nothing else wants, rather than hoping a hardcoded one is free.
  const probe = Bun.serve({ port: 0, fetch: () => new Response() });
  base = `http://localhost:${probe.port}`;
  probe.stop(true);

  child = Bun.spawn(["bun", "src/index.ts"], {
    cwd: new URL("..", import.meta.url).pathname,
    env: {
      ...process.env,
      PORT: String(new URL(base).port),
      DB_PATH: config.dbPath,
      SESSION_SECRET: config.sessionSecret,
      ADMIN_PASSWORD_HASH: config.adminPasswordHash,
      NEXT_PUBLIC_ORIGIN: `${DASHBOARD},${OTHER_ORIGIN}`,
    },
    stdio: ["ignore", "ignore", "inherit"],
  });
  for (let i = 0; !(await alive()); i++) {
    if (i > 80) throw new Error(`the api never came up on ${base}`);
    await Bun.sleep(250);
  }

  // A second connection on the same file, for the rows the HTTP surface doesn't return. Two processes on
  // one SQLite file is what WAL is for; the server has already run the migrations by now.
  db = new Db(config.dbPath);
  const providers = new ProviderRepo(db);
  const keys = new KeyRepo(db);
  const tokens = new TokenRepo(db);

  providers.create(P, "Test", [{ name: "arl", secret: true, required: true }]);
  providers.create(OTHER, "Other", [{ name: "arl", secret: true }]);
  for (const name of ["a", "b", "c"]) keys.create(P, name, { arl: `secret-${name}` });
  keys.create(OTHER, "elsewhere", { arl: "not-yours" });

  token = tokens.create("test-live").token;
  const dead = tokens.create("test-revoked");
  revoked = dead.token;
  tokens.revoke(dead.id);
  // Minted here rather than through /login, so the cookie's own format is what the tests exercise.
  cookie = `key_admin=${new Auth(config, tokens).sessionValue()}`;
});

afterAll(() => {
  child?.kill();
  db?.close();
  rmSync(dir, { recursive: true, force: true }); // the .db and its -wal and -shm siblings
});

describe("rotation", () => {
  test("hands out every key least-recently-used first, then wraps", async () => {
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      const res = await bot(`/api/${P}`);
      expect(res.status).toBe(200);
      seen.push((await res.json()).name);
    }
    expect(seen.slice(0, 3).sort()).toEqual(["a", "b", "c"]);
    expect(seen[3]).toBe(seen[0]); // wrapped back round
  });

  test("concurrent callers never get the same key", async () => {
    const [x, y] = await Promise.all([bot(`/api/${P}`), bot(`/api/${P}`)]);
    expect((await x.json()).id).not.toBe((await y.json()).id);
  });

  test("returns the provider's secrets, and counts the use", async () => {
    const key = await bot(`/api/${P}`).then((r) => r.json());
    expect(key.secrets.arl).toBe(`secret-${key.name}`);
    expect(key.use_count).toBeGreaterThan(0);
  });
});

describe("status reporting", () => {
  test("a flagged key is never handed out again, and the flag is recorded", async () => {
    const doomed = await bot(`/api/${P}`).then((r) => r.json());

    const res = await bot(`/api/${P}/${doomed.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "flagged", reason: "403 from provider" }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).fail_count).toBe(1);

    for (let i = 0; i < 4; i++) {
      const next = await bot(`/api/${P}`).then((r) => r.json());
      expect(next.id).not.toBe(doomed.id);
    }

    expect(row(doomed.id)!.flag_reason).toBe("403 from provider");
    expect(row(doomed.id)!.flagged_at).not.toBeNull();
  });

  test("marking it working again clears the flag and puts it back in rotation", async () => {
    const flagged = db
      .query(`select id from keys where provider_slug = $slug and status = 'flagged' limit 1`)
      .get({ slug: P }) as { id: string };

    await bot(`/api/${P}/${flagged.id}`, { method: "PATCH", body: JSON.stringify({ status: "working" }) });
    expect(row(flagged.id)).toMatchObject({ status: "working", flag_reason: null, flagged_at: null });
  });

  test("rejects a status that isn't in the enum", async () => {
    const key = db.query(`select id from keys where provider_slug = $slug limit 1`).get({ slug: P }) as {
      id: string;
    };
    const res = await bot(`/api/${P}/${key.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "burnt" }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_status", allowed: ["working", "flagged", "disabled"] });
  });

  test("404s on a key that belongs to another provider", async () => {
    const other = db.query(`select id from keys where provider_slug = $slug`).get({ slug: OTHER }) as {
      id: string;
    };
    const res = await bot(`/api/${P}/${other.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "flagged" }),
    });
    expect(res.status).toBe(404);
    expect(row(other.id)!.status).toBe("working");
  });
});

describe("empty and unknown pools", () => {
  test("503 no_working_keys once every key is flagged", async () => {
    setup(`update keys set status = 'flagged' where provider_slug = $slug`);
    const res = await bot(`/api/${P}`);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("no_working_keys");
  });

  test("503 provider_disabled while the provider is switched off", async () => {
    setup(`update keys set status = 'working' where provider_slug = $slug`);
    setup(`update providers set enabled = 0 where slug = $slug`);
    const res = await bot(`/api/${P}`);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("provider_disabled");
    setup(`update providers set enabled = 1 where slug = $slug`);
  });

  test("404 on a provider that doesn't exist", async () => {
    expect((await bot("/api/nope-nope")).status).toBe(404);
  });
});

describe("auth", () => {
  test("no token, junk token and revoked token are all 401", async () => {
    expect((await fetch(`${base}/api/${P}`)).status).toBe(401);
    const junk = await fetch(`${base}/api/${P}`, { headers: { authorization: "Bearer nunu_junk" } });
    expect(junk.status).toBe(401);
    const dead = await fetch(`${base}/api/${P}`, { headers: { authorization: `Bearer ${revoked}` } });
    expect(dead.status).toBe(401);
  });

  test("admin routes are closed without the session cookie", async () => {
    expect((await fetch(`${base}/api/admin/providers`)).status).toBe(401);
    expect((await fetch(`${base}/api/admin/tokens`)).status).toBe(401);
    // a bot token must not open the dashboard
    const asBot = await fetch(`${base}/api/admin/providers`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(asBot.status).toBe(401);
  });

  test("a tampered cookie is rejected", async () => {
    const [payload] = cookie.slice("key_admin=".length).split(".");
    const res = await fetch(`${base}/api/admin/me`, { headers: { cookie: `key_admin=${payload}.forged` } });
    expect(res.status).toBe(401);
  });

  test("login refuses the wrong password and issues a cookie for the right one", async () => {
    const bad = await fetch(`${base}/api/admin/login`, {
      method: "POST",
      body: JSON.stringify({ password: "wrong" }),
    });
    expect(bad.status).toBe(401);
    expect(bad.headers.get("set-cookie")).toBeNull();

    const good = await fetch(`${base}/api/admin/login`, {
      method: "POST",
      body: JSON.stringify({ password: PASSWORD }),
    });
    expect(good.status).toBe(200);
    const issued = good.headers.get("set-cookie")!;
    expect(issued).toContain("HttpOnly");
    expect(issued).toContain("SameSite=None"); // cross-site dashboard, so Lax is not an option
    expect(issued).toContain("Secure");

    const me = await fetch(`${base}/api/admin/me`, { headers: { cookie: issued.split(";")[0]! } });
    expect(me.status).toBe(200);
  });

  test("health needs no auth, and an unknown path is a plain 404", async () => {
    expect((await fetch(`${base}/api/health`)).status).toBe(200);
    const missing = await fetch(`${base}/nope`);
    expect(missing.status).toBe(404);
    expect((await missing.json()).error).toBe("not_found");
  });
});

// SameSite=None means the admin cookie now rides along on cross-site requests, so the Origin pin is the
// only thing left between a foreign page and this credential vault.
describe("cross-origin", () => {
  test("a valid cookie from a foreign origin is refused", async () => {
    const forged = await fetch(`${base}/api/admin/providers`, {
      headers: { cookie, origin: "https://evil.example" },
    });
    expect(forged.status).toBe(401);

    // every origin on the list is allowed, not just the first
    for (const origin of [DASHBOARD, OTHER_ORIGIN]) {
      const real = await fetch(`${base}/api/admin/providers`, { headers: { cookie, origin } });
      expect(real.status).toBe(200);
      expect(real.headers.get("access-control-allow-origin")).toBe(origin);
    }
  });

  test("every reply carries CORS, including the 401 the login screen has to read", async () => {
    for (const res of [
      await fetch(`${base}/api/admin/me`, { headers: { cookie, origin: DASHBOARD } }),
      await fetch(`${base}/api/admin/me`, { headers: { origin: DASHBOARD } }),
      await fetch(`${base}/api/health`, { headers: { origin: DASHBOARD } }),
    ]) {
      expect(res.headers.get("access-control-allow-origin")).toBe(DASHBOARD);
      expect(res.headers.get("access-control-allow-credentials")).toBe("true");
    }
  });

  test("a mutating route answers its preflight", async () => {
    const res = await fetch(`${base}/api/admin/providers`, {
      method: "OPTIONS",
      headers: { origin: DASHBOARD, "access-control-request-method": "POST" },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(DASHBOARD);
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
  });
});

describe("dashboard CRUD", () => {
  test("add, rename, re-secret and delete a key", async () => {
    const created = await adm(`/api/admin/providers/${P}/keys`, {
      method: "POST",
      body: JSON.stringify({ name: "from-dashboard", secrets: { arl: "one" } }),
    });
    expect(created.status).toBe(201);
    const { key } = await created.json();

    const renamed = await adm(`/api/admin/keys/${key.id}`, {
      method: "PATCH",
      body: JSON.stringify({ name: "renamed", secrets: { arl: "two" }, status: "disabled" }),
    });
    expect(renamed.status).toBe(200);
    expect((await renamed.json()).key).toMatchObject({
      name: "renamed",
      status: "disabled",
      secrets: { arl: "two" },
    });

    expect((await adm(`/api/admin/keys/${key.id}`, { method: "DELETE" })).status).toBe(200);
    expect((await adm(`/api/admin/keys/${key.id}`, { method: "DELETE" })).status).toBe(404);
  });

  test("rejects a key with no name or no secrets", async () => {
    const noName = await adm(`/api/admin/providers/${P}/keys`, {
      method: "POST",
      body: JSON.stringify({ secrets: { arl: "x" } }),
    });
    expect(noName.status).toBe(400);
    const why = await noName.json();
    expect(why.error).toBe("name_required"); // the code names the rule, issues name the field
    expect(why.issues[0].path).toBe("name");

    for (const secrets of [{}, { a: { b: 1 } }]) {
      const res = await adm(`/api/admin/providers/${P}/keys`, {
        method: "POST",
        body: JSON.stringify({ name: "x", secrets }),
      });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("secrets_required");
    }
  });

  test("lists providers with their key counts", async () => {
    const { providers } = await adm("/api/admin/providers").then((r) => r.json());
    const mine = providers.find((p: { slug: string }) => p.slug === P);
    expect(mine.total).toBeGreaterThan(0);
    expect(mine.enabled).toBe(true);
    expect(mine.fields[0].name).toBe("arl");
  });

  test("mints a bot token once and can revoke it", async () => {
    const res = await adm("/api/admin/tokens", { method: "POST", body: JSON.stringify({ name: "minted" }) });
    expect(res.status).toBe(201);
    const minted = await res.json();
    expect(minted.token).toStartWith("nunu_");

    const auth = { authorization: `Bearer ${minted.token}` };
    expect((await fetch(`${base}/api/${P}`, { headers: auth })).status).not.toBe(401);

    expect((await adm(`/api/admin/tokens/${minted.id}`, { method: "DELETE" })).status).toBe(200);
    expect((await fetch(`${base}/api/${P}`, { headers: auth })).status).toBe(401);
    // the plaintext was in that one reply and nowhere else
    const { tokens } = await adm("/api/admin/tokens").then((r) => r.json());
    expect(Object.keys(tokens[0])).not.toContain("token");
  });
});

describe("adding a provider needs no code", () => {
  test("a brand new provider is immediately servable at /api/<slug>", async () => {
    const created = await adm("/api/admin/providers", {
      method: "POST",
      body: JSON.stringify({
        slug: "zz-fresh",
        label: "Fresh",
        fields: [{ name: "client_id" }, { name: "client_secret", secret: true }],
      }),
    });
    expect(created.status).toBe(201);

    // no restart, no new route, no deploy
    expect((await bot("/api/zz-fresh")).status).toBe(503);
    await adm("/api/admin/providers/zz-fresh/keys", {
      method: "POST",
      body: JSON.stringify({ name: "pair", secrets: { client_id: "id", client_secret: "sh" } }),
    });
    const key = await bot("/api/zz-fresh").then((r) => r.json());
    expect(key.secrets).toEqual({ client_id: "id", client_secret: "sh" });

    expect((await adm("/api/admin/providers/zz-fresh", { method: "DELETE" })).status).toBe(200);
    expect((await bot("/api/zz-fresh")).status).toBe(404);
  });

  test("refuses a reserved or malformed slug, but tolerates capitals", async () => {
    for (const slug of ["admin", "_bad", "has space", "x".repeat(40), ""]) {
      const res = await adm("/api/admin/providers", { method: "POST", body: JSON.stringify({ slug }) });
      expect(res.status).toBe(400);
    }
    const dup = await adm("/api/admin/providers", { method: "POST", body: JSON.stringify({ slug: P }) });
    expect(dup.status).toBe(409);

    // typing "Deezer" in the dashboard should just work
    const mixed = await adm("/api/admin/providers", {
      method: "POST",
      body: JSON.stringify({ slug: "ZZ-Mixed" }),
    });
    expect(mixed.status).toBe(201);
    expect((await mixed.json()).provider.slug).toBe("zz-mixed");
    await adm("/api/admin/providers/zz-mixed", { method: "DELETE" });
  });
});
