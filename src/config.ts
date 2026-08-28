export type Config = ReturnType<typeof loadConfig>;

function env(name: string, check?: (v: string) => boolean, hint = ""): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is missing — copy .env.example to .env and fill it in`);
  if (check && !check(value)) throw new Error(`${name} looks wrong. ${hint}`);
  return value;
}

/** Every env var the app reads, read once at boot so a missing one fails before the port opens. */
export function loadConfig() {
  return {
    port: Number(process.env.PORT ?? 8787),
    dbPath: process.env.DB_PATH ?? "data/keys.db",
    sessionSecret: env("SESSION_SECRET"),
    adminPasswordHash: env(
      "ADMIN_PASSWORD_HASH",
      (v) => v.startsWith("scrypt:"),
      'Expected "scrypt:<saltHex>:<keyHex>" — see .env.example for the one-liner that prints it.',
    ),
    // Comma-separated: the dashboard is not the only browser origin that calls this. Each entry is
    // matched against the Origin header verbatim, which is why it stays a list rather than one string —
    // `includes` on a string would let "http://localhost:300" pass the CSRF pin as a substring.
    origins: env(
      "NEXT_PUBLIC_ORIGIN",
      (v) => v.split(",").every((o) => URL.canParse(o.trim()) && !o.trim().endsWith("/")),
      'Give each a scheme and no trailing slash, comma-separated, e.g. "http://localhost:3000,https://keys.example".',
    )
      .split(",")
      .map((o) => o.trim()),
  };
}
