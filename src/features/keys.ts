import { Hono } from "hono";
import { z } from "zod";
import { must, notFound } from "../core/errors";
import { Repo, setClause } from "../core/repo";
import { body, opt, secretsMap, Status, text } from "../core/validate";
import type { ProviderRepo } from "./providers";

export type Secrets = Record<string, string>;

export type Key = {
  id: string;
  provider_slug: string;
  name: string;
  secrets: Secrets;
  status: Status;
  note: string | null;
  last_used_at: string | null;
  use_count: number;
  fail_count: number;
  flagged_at: string | null;
  flag_reason: string | null;
  created_at: string;
  updated_at: string;
};

/** All a bot is handed: the rest of the row is bookkeeping it has no use for. */
export type TakenKey = Pick<Key, "id" | "name" | "secrets" | "use_count">;

export type KeyPatch = {
  name?: string;
  secrets?: Secrets;
  note?: string;
  status?: Status;
  reason?: string;
};

const KeyCreate = z.object({
  name: text("name_required"),
  secrets: secretsMap("secrets_required").refine((s) => Object.keys(s).length > 0, "secrets_required"),
  note: opt("invalid_note"),
});

/** The dashboard's edit form. `status` is here only for the documented curl escape hatch — the UI never
 *  sends it, and a bot's own report goes through StatusReport. */
const KeyEdit = z.object({
  name: opt("invalid_name"),
  secrets: secretsMap("invalid_secrets").optional(),
  note: opt("invalid_note"),
  status: Status.optional(),
  reason: opt("invalid_reason"),
});

/** What a bot PATCHes back after using a key. */
export const StatusReport = z.object({ status: Status, reason: opt("invalid_reason") });

export class KeyRepo extends Repo<Key> {
  protected json = ["secrets"];
  private cursor = 0;

  list(slug: string) {
    return this.many("select * from keys where provider_slug = $slug order by status, name", { slug });
  }

  find(id: string) {
    return this.one("select * from keys where id = $id", { id });
  }

  create(slug: string, name: string, secrets: Secrets, note?: string) {
    const now = Date.now();
    return this.one(
      `insert into keys (id, provider_slug, name, secrets, note, created_at, updated_at)
       values ($id, $slug, $name, $secrets, $note, $now, $now) returning *`,
      { id: crypto.randomUUID(), slug, name, secrets: JSON.stringify(secrets), note: note ?? null, now },
    )!;
  }

  /**
   * The single write path for both the dashboard's edit and the bot's report, so flag bookkeeping cannot
   * drift between them. `providerSlug`, when given, scopes the row, so one bot's token can't flag
   * another provider's key by id.
   */
  update(id: string, patch: KeyPatch, providerSlug?: string) {
    const { status } = patch;
    const flagged = status === "flagged";
    const now = Date.now();
    const set = setClause({
      name: patch.name,
      secrets: patch.secrets && JSON.stringify(patch.secrets),
      note: patch.note,
      status,
      // any other status change clears the flag; no status at all leaves it where it was
      flagged_at: flagged ? now : status ? null : undefined,
      flag_reason: flagged ? (patch.reason ?? null) : status ? null : undefined,
      updated_at: now,
    });
    // the only counter in the app, so it stays a SQL expression rather than a read-modify-write
    return this.one(
      `update keys set ${set.sql}${flagged ? ", fail_count = fail_count + 1" : ""}
        where id = $id and ($scope is null or provider_slug = $scope) returning *`,
      { ...set.params, id, scope: providerSlug ?? null },
    );
  }

  delete(id: string) {
    return this.changed("delete from keys where id = $id", { id });
  }

  /**
   * The rotation. One statement, so two bots arriving together can never be handed the same row —
   * Postgres needed `for update … skip locked` to promise that, SQLite serialises writers instead.
   * Ascending on last_used_at already puts the never-used keys first. Null when the pool is dry.
   */
  take(slug: string) {
    return this.one<TakenKey>(
      `update keys set last_used_at = $now, use_count = use_count + 1, updated_at = $now
        where id = (select k.id from keys k join providers p on p.slug = k.provider_slug
                     where k.provider_slug = $slug and k.status = 'working' and p.enabled
                     order by k.last_used_at, k.created_at limit 1)
       returning id, name, secrets, use_count`,
      { slug, now: this.stamp() },
    );
  }

  /** last_used_at is the rotation's cursor, and a millisecond is coarser than the rotation: two takes
   *  inside one tick would tie and the order would go arbitrary. One process owns the file. */
  private stamp() {
    return (this.cursor = Math.max(Date.now(), this.cursor + 1));
  }
}

export function keyRoutes(keys: KeyRepo, providers: ProviderRepo) {
  const app = new Hono();

  app.get("/providers/:slug/keys", (c) => {
    const provider = must(providers.find(c.req.param("slug")), "unknown_provider");
    return c.json({ provider, keys: keys.list(provider.slug) });
  });

  app.post("/providers/:slug/keys", async (c) => {
    const { name, secrets, note } = await body(c, KeyCreate);
    const provider = must(providers.find(c.req.param("slug")), "unknown_provider");
    return c.json({ key: keys.create(provider.slug, name, secrets, note) }, 201);
  });

  app.patch("/keys/:id", async (c) => {
    const patch = await body(c, KeyEdit);
    return c.json({ key: must(keys.update(c.req.param("id"), patch), "unknown_key") });
  });

  app.delete("/keys/:id", (c) => {
    if (!keys.delete(c.req.param("id"))) throw notFound("unknown_key");
    return c.json({ ok: true });
  });

  return app;
}
