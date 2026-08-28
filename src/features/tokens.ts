import { createHash, randomBytes } from "node:crypto";
import { Hono } from "hono";
import { z } from "zod";
import { notFound } from "../core/errors";
import { Repo } from "../core/repo";
import { body, text } from "../core/validate";

export type Token = {
  id: string;
  name: string;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
};

const TokenCreate = z.object({ name: text("name_required") });

/** sha256, not a password KDF: a 192-bit random token needs no stretching, and stretching would put
 *  ~50ms on the rotation call every bot makes. */
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export function mintToken() {
  const token = "nunu_" + randomBytes(24).toString("base64url");
  return { token, hash: hashToken(token) };
}

export class TokenRepo extends Repo<Token> {
  private columns = "id, name, last_used_at, revoked_at, created_at";

  list() {
    return this.many(`select ${this.columns} from api_tokens order by created_at desc`);
  }

  create(name: string) {
    const { token, hash } = mintToken();
    const row = this.one<Pick<Token, "id" | "name" | "created_at">>(
      `insert into api_tokens (id, name, token_hash, created_at) values ($id, $name, $hash, $now)
       returning id, name, created_at`,
      { id: crypto.randomUUID(), name, hash, now: Date.now() },
    )!;
    // the plaintext exists only in this return value — the row holds nothing but the sha256
    return { ...row, token };
  }

  revoke(id: string) {
    return this.changed(
      "update api_tokens set revoked_at = $now where id = $id and revoked_at is null",
      { id, now: Date.now() },
    );
  }

  /**
   * The api_tokens row id, or null when the bearer token is missing, unknown or revoked. One statement,
   * so stamping last_used_at costs nothing extra — the Postgres version needed a second round-trip for it.
   */
  authenticate(header: string | undefined): string | null {
    const token = header?.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (!token) return null;
    const row = this.one<{ id: string }>(
      `update api_tokens set last_used_at = $now
        where token_hash = $hash and revoked_at is null returning id`,
      { hash: hashToken(token), now: Date.now() },
    );
    return row?.id ?? null;
  }
}

export function tokenRoutes(tokens: TokenRepo) {
  const app = new Hono();

  app.get("/tokens", (c) => c.json({ tokens: tokens.list() }));

  app.post("/tokens", async (c) => {
    const { name } = await body(c, TokenCreate);
    return c.json(tokens.create(name), 201);
  });

  app.delete("/tokens/:id", (c) => {
    if (!tokens.revoke(c.req.param("id"))) throw notFound("unknown_token");
    return c.json({ ok: true });
  });

  return app;
}
