import { Hono } from "hono";
import { z } from "zod";
import { must, notFound } from "../core/errors";
import { Repo, setClause } from "../core/repo";
import { body, isSlug, opt, text, type Field } from "../core/validate";

export type Provider = {
  slug: string;
  label: string;
  fields: Field[];
  enabled: boolean;
  created_at: string;
};

/** What the dashboard sidebar reads: every provider plus its keys broken down by status. */
export type ProviderCounts = Provider & {
  working: number;
  flagged: number;
  disabled: number;
  total: number;
};

const Slug = z
  .string({ error: "invalid_slug" })
  .trim()
  .toLowerCase() // typing "Deezer" in the dashboard should just work
  .refine(isSlug, "invalid_slug");

const FieldSpec = z
  .object({
    name: text("invalid_fields"),
    label: opt("invalid_fields"),
    secret: z.boolean({ error: "invalid_fields" }).default(false),
    required: z.boolean({ error: "invalid_fields" }).default(false),
  })
  .transform((f) => ({ ...f, label: f.label ?? f.name }));

const Fields = z.array(FieldSpec, { error: "invalid_fields" });

const ProviderCreate = z.object({
  slug: Slug,
  label: opt("invalid_label"),
  fields: Fields.default([]),
});

const ProviderEdit = z.object({
  label: opt("invalid_label"),
  fields: Fields.optional(),
  enabled: z.boolean({ error: "invalid_enabled" }).optional(),
});

export class ProviderRepo extends Repo<Provider> {
  protected json = ["fields"];
  protected bool = ["enabled"];

  list() {
    // grouping by the primary key makes p.* functionally dependent, so SQLite is happy with the bare *
    return this.many<ProviderCounts>(`
      select p.*,
             count(k.id) filter (where k.status = 'working')  as working,
             count(k.id) filter (where k.status = 'flagged')  as flagged,
             count(k.id) filter (where k.status = 'disabled') as disabled,
             count(k.id) as total
        from providers p left join keys k on k.provider_slug = p.slug
       group by p.slug
       order by p.slug`);
  }

  find(slug: string) {
    return this.one("select * from providers where slug = $slug", { slug });
  }

  create(slug: string, label: string, fields: Field[]) {
    return this.one(
      `insert into providers (slug, label, fields, created_at) values ($slug, $label, $fields, $now)
       returning *`,
      { slug, label, fields: JSON.stringify(fields), now: Date.now() },
    )!;
  }

  update(slug: string, patch: { label?: string; fields?: Field[]; enabled?: boolean }) {
    const set = setClause({
      label: patch.label,
      fields: patch.fields && JSON.stringify(patch.fields),
      enabled: patch.enabled === undefined ? undefined : +patch.enabled,
    });
    if (!set.sql) return this.find(slug);
    return this.one(`update providers set ${set.sql} where slug = $slug returning *`, {
      ...set.params,
      slug,
    });
  }

  /** Cascades to that provider's keys — core/db.ts declares `on delete cascade`. */
  delete(slug: string) {
    return this.changed("delete from providers where slug = $slug", { slug });
  }
}

export function providerRoutes(providers: ProviderRepo) {
  const app = new Hono();

  app.get("/providers", (c) => c.json({ providers: providers.list() }));

  // This is how a provider is added: no code, no deploy.
  app.post("/providers", async (c) => {
    const { slug, label, fields } = await body(c, ProviderCreate);
    return c.json({ provider: providers.create(slug, label ?? slug, fields) }, 201);
  });

  app.patch("/providers/:slug", async (c) => {
    const patch = await body(c, ProviderEdit);
    const provider = must(providers.update(c.req.param("slug"), patch), "unknown_provider");
    return c.json({ provider });
  });

  app.delete("/providers/:slug", (c) => {
    if (!providers.delete(c.req.param("slug"))) throw notFound("unknown_provider");
    return c.json({ ok: true });
  });

  return app;
}
