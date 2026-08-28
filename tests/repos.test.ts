// No env, no HTTP, no subprocess: everything here runs against an in-memory database, which is the
// point of handing the repos a Db instead of importing a connection.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { createApp } from "../src/app";
import type { Config } from "../src/config";
import { Db } from "../src/core/db";
import { Auth } from "../src/features/auth";
import { KeyRepo } from "../src/features/keys";
import { ProviderRepo } from "../src/features/providers";
import { TokenRepo } from "../src/features/tokens";
import { ensureFresh, Refresher, REFRESHERS, type Result, type Secrets } from "../src/refresh";
import { YoutubeRefresher } from "../src/refresh/youtube";

const config: Config = {
  port: 0,
  dbPath: ":memory:",
  sessionSecret: "test-secret",
  adminPasswordHash: "scrypt:aa:bb",
  origins: ["http://localhost:3000"],
};

const now = Math.floor(Date.now() / 1000);

/** Secrets carrying a live access token, the shape a refresher hands back. */
const live = (s: Secrets, exp: number): Secrets => ({
  ...s,
  access_token: "at",
  access_token_expires_at: new Date(exp * 1000).toISOString(),
});

/** Stands in for a provider's refresh endpoint, so no test spends a real rotating token. */
class Fake extends Refresher {
  constructor(private readonly reply: (s: Secrets) => Result) {
    super();
  }
  async run(s: Secrets) {
    return this.reply(s);
  }
}

const realFetch = globalThis.fetch;
let db: Db;
let providers: ProviderRepo;
let keys: KeyRepo;
let tokens: TokenRepo;

beforeEach(() => {
  db = new Db(":memory:");
  providers = new ProviderRepo(db);
  keys = new KeyRepo(db);
  tokens = new TokenRepo(db);
  providers.create("zz", "Test", [{ name: "arl", secret: true, required: true }]);
});

afterEach(() => {
  globalThis.fetch = realFetch;
  delete REFRESHERS.zz;
  db.close();
});

test("the migration stamps its version and seeds the two providers", () => {
  expect((db.query("pragma user_version").get() as { user_version: number }).user_version).toBe(1);
  expect(providers.list().map((p) => p.slug)).toEqual(["deezer", "youtube", "zz"]);
});

// The two types SQLite doesn't have, and the dashboard reads both: `enabled` as a JSON boolean, and a
// timestamp Date.parse can't misread as local time.
test("enabled comes back a boolean and timestamps ISO with a Z", () => {
  const p = providers.find("zz")!;
  expect(p.enabled).toBe(true);
  expect(p.created_at).toEndWith("Z");
  expect(Math.abs(Date.parse(p.created_at) - Date.now())).toBeLessThan(5_000);
  expect(providers.update("zz", { enabled: false })!.enabled).toBe(false);
});

test("a patch with nothing in it leaves the row alone", () => {
  expect(providers.update("zz", {})!.label).toBe("Test");
});

test("the sidebar's key counts come back per status", () => {
  keys.create("zz", "a", { arl: "1" });
  const doomed = keys.create("zz", "b", { arl: "2" });
  keys.update(doomed.id, { status: "flagged" });
  const zz = providers.list().find((p) => p.slug === "zz")!;
  expect([zz.working, zz.flagged, zz.disabled, zz.total]).toEqual([1, 1, 0, 2]);
});

test("deleting a provider takes its keys with it", () => {
  const key = keys.create("zz", "a", { arl: "1" });
  expect(providers.delete("zz")).toBe(true);
  expect(keys.find(key.id)).toBeNull();
  expect(providers.delete("zz")).toBe(false);
});

test("a key patch touches only the fields it carries", () => {
  const key = keys.create("zz", "a", { arl: "1" }, "a note");
  const renamed = keys.update(key.id, { name: "b" })!;
  expect([renamed.name, renamed.note, renamed.secrets.arl]).toEqual(["b", "a note", "1"]);
});

test("flagging counts the failure, and any other status clears the flag", () => {
  const key = keys.create("zz", "a", { arl: "1" });
  const flagged = keys.update(key.id, { status: "flagged", reason: "403 from provider" })!;
  expect([flagged.fail_count, flagged.flag_reason]).toEqual([1, "403 from provider"]);
  expect(flagged.flagged_at).not.toBeNull();

  // the count is history and stays; the flag itself is state and goes
  const back = keys.update(key.id, { status: "working" })!;
  expect([back.fail_count, back.flag_reason, back.flagged_at]).toEqual([1, null, null]);
});

test("one provider's bot cannot flag another provider's key by id", () => {
  const key = keys.create("zz", "a", { arl: "1" });
  expect(keys.update(key.id, { status: "flagged" }, "deezer")).toBeNull();
  expect(keys.update(key.id, { status: "flagged" }, "zz")).not.toBeNull();
});

test("the rotation hands out least-recently-used first, then wraps", () => {
  for (const name of ["a", "b", "c"]) keys.create("zz", name, { arl: name });
  const seen = [1, 2, 3, 4].map(() => keys.take("zz")!.name);
  expect(seen.slice(0, 3).sort()).toEqual(["a", "b", "c"]);
  expect(seen[3]).toBe(seen[0]);
});

test("the rotation skips flagged keys, a disabled provider and an empty pool", () => {
  const key = keys.create("zz", "a", { arl: "1" });
  expect(keys.take("zz")!.use_count).toBe(1);

  keys.update(key.id, { status: "flagged" });
  expect(keys.take("zz")).toBeNull();

  keys.update(key.id, { status: "working" });
  providers.update("zz", { enabled: false });
  expect(keys.take("zz")).toBeNull();
  expect(keys.take("no-such-provider")).toBeNull();
});

test("a bot token verifies until it is revoked, and stamps its own last use", () => {
  const { id, token } = tokens.create("bot");
  expect(token).toStartWith("nunu_");
  expect(tokens.authenticate(`Bearer ${token}`)).toBe(id);
  expect(tokens.list()[0]!.last_used_at).not.toBeNull();

  expect(tokens.authenticate("Bearer nunu_junk")).toBeNull();
  expect(tokens.authenticate(undefined)).toBeNull();
  expect(tokens.authenticate(token)).toBeNull(); // no Bearer prefix

  expect(tokens.revoke(id)).toBe(true);
  expect(tokens.authenticate(`Bearer ${token}`)).toBeNull();
  expect(tokens.revoke(id)).toBe(false);
});

test("stale covers never-refreshed, unreadable and nearly-expired tokens", () => {
  const r = new Fake(() => ({ ok: true, secrets: {} }));
  expect(r.stale({ refresh_token: "r" })).toBe(true);
  expect(r.stale({ access_token: "a", access_token_expires_at: "" })).toBe(true);
  expect(r.stale(live({}, now + 120))).toBe(true); // inside the 5-min buffer
  expect(r.stale(live({}, now + 3600))).toBe(false);
});

test("a refreshed key is written back before it is handed out", async () => {
  const key = keys.create("zz", "rotating", { refresh_token: "first" });
  REFRESHERS.zz = new Fake((s) => ({
    ok: true,
    secrets: { ...live(s, now + 3600), refresh_token: `after-${s.refresh_token}` },
  }));

  const out = await ensureFresh(keys, "zz", key);
  expect(out?.secrets.refresh_token).toBe("after-first");
  // the row itself, not just the reply — an unwritten rotation locks the key out permanently
  expect(keys.find(key.id)?.secrets.refresh_token).toBe("after-first");

  // second pass: the access token is live now, so nothing is spent and nothing rotates
  expect((await ensureFresh(keys, "zz", out!))?.secrets.refresh_token).toBe("after-first");
});

test("a credential the provider refuses is flagged, not handed out", async () => {
  const key = keys.create("zz", "dead", { refresh_token: "revoked" });
  REFRESHERS.zz = new Fake(() => ({ ok: false, error: "refresh rejected: invalid_grant", dead: true }));

  expect(await ensureFresh(keys, "zz", key)).toBeNull();
  const row = keys.find(key.id)!;
  expect(row.status).toBe("flagged");
  expect(row.flag_reason).toContain("invalid_grant");
  expect(row.secrets.access_token).toBeUndefined(); // nothing half-written
});

test("a refresh that fails for our own reasons leaves the key working", async () => {
  const key = keys.create("zz", "unreachable", { refresh_token: "fine" });
  REFRESHERS.zz = new Fake(() => ({ ok: false, error: "refresh unreachable: dns", dead: false }));

  expect(await ensureFresh(keys, "zz", key)).toBeNull();
  expect(keys.find(key.id)!.status).toBe("working");
});

test("a key someone else refreshed mid-flight is used rather than refreshed again", async () => {
  const key = keys.create("zz", "raced", { refresh_token: "first" });
  REFRESHERS.zz = new Fake((s) => {
    keys.update(key.id, { secrets: live(s, now + 3600) }); // the other caller
    return { ok: false, error: "refresh failed 429: slow down", dead: false };
  });

  expect((await ensureFresh(keys, "zz", key))?.secrets.access_token).toBeDefined();
});

// Google's replies, without touching Google: the interesting cases are all about how a refusal arrives.
const youtube = new YoutubeRefresher();
const stub = (body: unknown, status = 200) => {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  globalThis.fetch = (async () => new Response(text, { status })) as unknown as typeof fetch;
};

test("a cookie-only youtube key is never dragged through a refresh", () => {
  expect(youtube.stale({ cookie: "SID=x" })).toBe(false);
  expect(youtube.stale({ refresh_token: "rt" })).toBe(true);
});

test("the access token is stored with its expiry, and the stored refresh token survives", async () => {
  stub({ access_token: "ya29.new", expires_in: 3599, token_type: "Bearer" });
  const out = await youtube.run({ refresh_token: "rt-keep", cookie: "SID=x" });
  expect(out.ok).toBe(true);
  if (!out.ok) return;

  expect(out.secrets.access_token).toBe("ya29.new");
  expect(out.secrets.refresh_token).toBe("rt-keep"); // Google sent none back; ours is still live
  expect(out.secrets.cookie).toBe("SID=x"); // the other field is untouched
  // ~1h out, so the fresh token isn't immediately stale to the very check that asked for it
  expect(youtube.stale(out.secrets)).toBe(false);
});

test("a rotated youtube refresh token is kept when Google does send one", async () => {
  stub({ access_token: "ya29.new", expires_in: 3599, refresh_token: "rt-rotated" });
  const out = await youtube.run({ refresh_token: "rt-old" });
  expect(out.ok && out.secrets.refresh_token).toBe("rt-rotated");
});

// The one that matters: this arrives as HTTP 200, so anything reading res.ok would store undefined as
// the access token and hand a bot a broken key.
test("invalid_grant under HTTP 200 is a dead credential, not a success", async () => {
  stub({ error: "invalid_grant" }, 200);
  const out = await youtube.run({ refresh_token: "rt-revoked" });
  expect(out.ok).toBe(false);
  expect(out.ok === false && out.dead).toBe(true);
});

test("a client-side error flags nothing — the fault is ours, not the key's", async () => {
  stub({ error: "invalid_client" }, 401);
  expect((await youtube.run({ refresh_token: "rt" })).ok).toBe(false);
  expect(await youtube.run({ refresh_token: "rt" }).then((o) => o.ok === false && o.dead)).toBe(false);

  stub("<html>502</html>", 502);
  expect((await youtube.run({ refresh_token: "rt" })).ok).toBe(false);
});

// The whole app, no server and no env — the 503 that only happens when the pool exists but won't renew.
test("a pool that will not refresh answers 503 refresh_failed", async () => {
  keys.create("zz", "dead", { refresh_token: "revoked" });
  REFRESHERS.zz = new Fake(() => ({ ok: false, error: "refresh unreachable: dns", dead: false }));
  const { token } = tokens.create("bot");
  const app = createApp({ config, auth: new Auth(config, tokens), providers, keys, tokens });

  const res = await app.request("/api/zz", { headers: { authorization: `Bearer ${token}` } });
  expect(res.status).toBe(503);
  expect(await res.json()).toMatchObject({ error: "refresh_failed", provider: "zz" });
});
