import { z } from "zod";
import { Refresher, type Result, type Secrets } from "./refresher";

// Google's public TV-app OAuth client, the one every youtube-tv-token flow uses — not a user secret,
// and the stored refresh tokens are bound to it, so it cannot be rotated without invalidating them.
// ponytail: worth moving behind env if this repo ever goes public.
const CLIENT_ID = "861556708454-d6dlm3lh05idd8npek18k6be8ba3oc68.apps.googleusercontent.com";
const CLIENT_SECRET = "SboVhoG9s0rNafixCSGGKXAT";
const TOKEN_URL = "https://www.youtube.com/o/oauth2/token";

/**
 * Nothing is guaranteed: a refused refresh token comes back as `error` with no `access_token`, sometimes
 * under HTTP 200, so the refusal is a shape of this reply rather than an alternative to it.
 * `refresh_token` is absent whenever it hasn't changed, which is nearly always.
 */
const YoutubeRefresh = z.object({
  access_token: z.string().min(1).optional(),
  expires_in: z.number().positive().optional(),
  token_type: z.string().min(1).optional(),
  refresh_token: z.string().min(1).optional(),
  error: z.string().min(1).optional(),
});

export class YoutubeRefresher extends Refresher {
  /** A cookie-only key has no refresh token to spend, so it is never dragged through a refresh. */
  override stale(s: Secrets, now?: number) {
    return !!s.refresh_token && super.stale(s, now);
  }

  async run(s: Secrets): Promise<Result> {
    if (!s.refresh_token) return { ok: false, error: "no refresh_token in secrets", dead: true };

    let res: Response;
    try {
      res = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          refresh_token: s.refresh_token,
          grant_type: "refresh_token",
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (e) {
      return { ok: false, error: `refresh unreachable: ${(e as Error).message}`, dead: false };
    }

    const parsed = YoutubeRefresh.safeParse(await res.json().catch(() => null));
    if (!parsed.success)
      return { ok: false, error: `refresh reply unreadable (http ${res.status})`, dead: false };
    const r = parsed.data;

    // the one that matters: this can arrive as HTTP 200, so anything reading res.ok would store
    // undefined as the access token and hand a bot a broken key
    if (!r.access_token)
      return {
        ok: false,
        error: `refresh rejected: ${r.error ?? `http ${res.status}`}`,
        dead: r.error === "invalid_grant",
      };

    return {
      ok: true,
      secrets: {
        ...s,
        refresh_token: r.refresh_token ?? s.refresh_token,
        access_token: r.access_token,
        access_token_expires_at: new Date(Date.now() + (r.expires_in ?? 300) * 1000).toISOString(),
        token_type: r.token_type ?? "Bearer",
      },
    };
  }
}
