import { Hono } from "hono";
import { must, unavailable } from "../core/errors";
import { body } from "../core/validate";
import { ensureFresh } from "../refresh";
import { StatusReport, type KeyRepo } from "./keys";
import type { ProviderRepo } from "./providers";

/** The bot's whole API: take a key, report back what happened to it. */
export function rotationRoutes(keys: KeyRepo, providers: ProviderRepo) {
  const app = new Hono();

  // A provider whose credential expires (youtube) is refreshed on the way out, so the access token in
  // this response is live and the caller never has to know it happened.
  app.get("/:provider", async (c) => {
    const slug = c.req.param("provider");
    let refreshFailed = false;

    // A key we couldn't refresh is no use to the caller, so step to the next one. Bounded, because the
    // whole pool could be unrefreshable and the bot is still owed an answer.
    for (let i = 0; i < 3; i++) {
      const key = keys.take(slug);
      if (!key) break;
      const fresh = await ensureFresh(keys, slug, key);
      if (fresh) return c.json({ provider: slug, ...fresh });
      refreshFailed = true;
    }

    const provider = must(providers.find(slug), "unknown_provider");
    if (!provider.enabled) throw unavailable("provider_disabled", { provider: slug });
    // refresh_failed is distinct from an empty pool: the keys exist, the provider wouldn't renew them
    throw unavailable(refreshFailed ? "refresh_failed" : "no_working_keys", { provider: slug });
  });

  app.patch("/:provider/:id", async (c) => {
    const report = await body(c, StatusReport);
    const key = must(keys.update(c.req.param("id"), report, c.req.param("provider")), "unknown_key");
    return c.json({ id: key.id, name: key.name, status: key.status, fail_count: key.fail_count });
  });

  return app;
}
