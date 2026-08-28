import { createApp } from "./app";
import { loadConfig } from "./config";
import { Db } from "./core/db";
import { Auth } from "./features/auth";
import { KeyRepo } from "./features/keys";
import { ProviderRepo } from "./features/providers";
import { TokenRepo } from "./features/tokens";

const config = loadConfig();
const db = new Db(config.dbPath);
const tokens = new TokenRepo(db);

const app = createApp({
  config,
  auth: new Auth(config, tokens),
  providers: new ProviderRepo(db),
  keys: new KeyRepo(db),
  tokens,
});

const server = Bun.serve({ port: config.port, fetch: app.fetch });
console.log(`keys-api on ${server.url} · db ${config.dbPath}`);

for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    server.stop();
    db.close();
    process.exit(0);
  });

process.on("uncaughtException", (err) => {
  console.error(err);
  process.exit(1);
});
