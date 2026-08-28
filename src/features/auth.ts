import { createHmac, scryptSync, timingSafeEqual } from "node:crypto";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import type { Config } from "../config";
import { tooMany, unauthorized } from "../core/errors";
import { body, text } from "../core/validate";
import type { TokenRepo } from "./tokens";

const COOKIE = "key_admin";
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const LIMIT = 10;
const WINDOW_MS = 60_000;

const Login = z.object({ password: text("invalid_password") });

/** Header-based, not the socket address: every real request arrives through the tunnel, so the socket
 *  is always the tunnel's. */
const clientIp = (c: Context) =>
  c.req.header("x-real-ip") ?? c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

/**
 * Every credential format here is the Postgres version's, byte for byte, so cookies and bot tokens it
 * minted still verify: `scrypt:<saltHex>:<keyHex>` passwords, sha256 token hashes, an HMAC-signed
 * stateless cookie. node:crypto rather than Bun.* for the same reason — the digests are identical
 * either way, and there is no reason to churn a credential format for a syntax preference.
 */
export class Auth {
  private attempts = new Map<string, { n: number; resetAt: number }>();

  constructor(
    private readonly config: Config,
    private readonly tokens: TokenRepo,
  ) {}

  /** Dashboard endpoints: the signed cookie, plus the Origin pin that replaces SameSite=Lax. */
  readonly requireAdmin: MiddlewareHandler = (c, next) => {
    const origin = c.req.header("origin");
    // SameSite=None gave up Lax's CSRF protection, so a foreign origin is refused here. A request with
    // no Origin at all is curl or another server, which no browser CSRF can produce.
    if (origin && !this.config.origins.includes(origin)) throw unauthorized("unauthorized");
    if (!this.isAdmin(getCookie(c, COOKIE))) throw unauthorized("unauthorized");
    return next();
  };

  /** Bot endpoints: a bearer token from api_tokens. Not origin-pinned — bots aren't browsers. */
  readonly requireBot: MiddlewareHandler = (c, next) => {
    if (!this.tokens.authenticate(c.req.header("authorization"))) throw unauthorized("unauthorized");
    return next();
  };

  /** The signed cookie value, stateless — there is no sessions table. */
  sessionValue() {
    const payload = Buffer.from(JSON.stringify({ exp: Date.now() + SESSION_MS })).toString("base64url");
    return `${payload}.${this.hmac(payload)}`;
  }

  isAdmin(raw: string | undefined): boolean {
    const dot = raw?.lastIndexOf(".") ?? -1;
    if (!raw || dot < 1) return false;

    const mac = Buffer.from(raw.slice(dot + 1));
    const expected = Buffer.from(this.hmac(raw.slice(0, dot)));
    if (mac.length !== expected.length || !timingSafeEqual(mac, expected)) return false;

    try {
      const { exp } = JSON.parse(Buffer.from(raw.slice(0, dot), "base64url").toString());
      return typeof exp === "number" && exp > Date.now();
    } catch {
      return false;
    }
  }

  /**
   * `scrypt:<saltHex>:<keyHex>` rather than Bun.password's argon2: the format has no `$`, which .env
   * parsers expand. ponytail: scryptSync blocks ~80ms, fine on a route throttled to 10/min.
   */
  verifyPassword(password: string): boolean {
    const [scheme, saltHex, keyHex] = this.config.adminPasswordHash.split(":");
    if (scheme !== "scrypt" || !saltHex || !keyHex) return false;
    const expected = Buffer.from(keyHex, "hex");
    return timingSafeEqual(scryptSync(password, Buffer.from(saltHex, "hex"), expected.length), expected);
  }

  routes() {
    const app = new Hono();

    app.post("/login", async (c) => {
      if (this.throttled(clientIp(c))) throw tooMany("too_many_attempts");
      // 401, not 400: a missing password and a wrong one must be indistinguishable to a prober
      const { password } = await body(c, Login, 401);
      if (!this.verifyPassword(password)) throw unauthorized("invalid_password");
      this.setSession(c);
      return c.json({ ok: true });
    });

    app.post("/logout", (c) => {
      deleteCookie(c, COOKIE, this.cookieOptions());
      return c.json({ ok: true });
    });

    return app;
  }

  private setSession(c: Context) {
    setCookie(c, COOKIE, this.sessionValue(), { ...this.cookieOptions(), maxAge: SESSION_MS / 1000 });
  }

  /** SameSite=None because the dashboard is on another origin; None requires Secure, and browsers
   *  accept Secure on http://localhost, so it is unconditional. */
  private cookieOptions() {
    return { httpOnly: true, sameSite: "None", secure: true, path: "/" } as const;
  }

  private hmac(data: string) {
    return createHmac("sha256", this.config.sessionSecret).update(data).digest("base64url");
  }

  // ponytail: in-memory counter — a speed bump, not a wall. One process owns it now, so the limit is
  // finally the real limit rather than LIMIT x workers. Move it to the table if login is ever attacked.
  private throttled(ip: string): boolean {
    const now = Date.now();
    const current = this.attempts.get(ip);
    if (!current || current.resetAt < now) {
      this.attempts.set(ip, { n: 1, resetAt: now + WINDOW_MS });
      if (this.attempts.size > 1000)
        for (const [k, v] of this.attempts) if (v.resetAt < now) this.attempts.delete(k);
      return false;
    }
    current.n += 1;
    return current.n > LIMIT;
  }
}
