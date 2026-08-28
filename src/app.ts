import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import type { Config } from "./config";
import { onError } from "./core/errors";
import type { Auth } from "./features/auth";
import { keyRoutes, type KeyRepo } from "./features/keys";
import { providerRoutes, type ProviderRepo } from "./features/providers";
import { rotationRoutes } from "./features/rotation";
import { tokenRoutes, type TokenRepo } from "./features/tokens";

export type Deps = {
  config: Config;
  auth: Auth;
  providers: ProviderRepo;
  keys: KeyRepo;
  tokens: TokenRepo;
};

/**
 * Everything is passed in, nothing imported from a global, so a test can stand up a whole app on an
 * in-memory database. Read top to bottom this is also the app's security posture: what is open, what
 * needs the admin cookie, what needs a bot token.
 */
export function createApp({ config, auth, providers, keys, tokens }: Deps) {
  const app = new Hono();

  app.use(logger());

  app.use(
    cors({
      origin: config.origins,
      credentials: true,
      allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: ["content-type", "authorization"],
      maxAge: 86400,
    }),
  );
  app.onError(onError);
  app.notFound((c) => c.json({ error: "not_found" }, 404));

  const api = new Hono();
  api.get("/health", (c) => c.json({ ok: true }));
  api.route("/admin", auth.routes()); // login and logout, mounted before the guard below

  const admin = new Hono();
  admin.use(auth.requireAdmin);
  admin.get("/me", (c) => c.json({ admin: true }));
  admin.route("/", providerRoutes(providers));
  admin.route("/", keyRoutes(keys, providers));
  admin.route("/", tokenRoutes(tokens));
  api.route("/admin", admin);

  // Last: ":provider" would otherwise swallow /health and /admin/*, and Hono runs matches in
  // registration order. The reserved-slug rule (no provider named "admin") is the second line of defence.
  const bot = new Hono();
  bot.use(auth.requireBot);
  bot.route("/", rotationRoutes(keys, providers));
  api.route("/", bot);

  app.route("/api", api);
  return app;
}
