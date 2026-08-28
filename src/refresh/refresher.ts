import type { Secrets } from "../features/keys";

export type { Secrets };
export type Result = { ok: true; secrets: Secrets } | { ok: false; error: string; dead: boolean };

/** Refresh this far ahead of expiry, so a key handed out now still works when the bot actually uses it. */
const BUFFER_MS = 5 * 60 * 1000;

/**
 * A provider whose credential expires. `dead: true` on a failure means the provider refused the
 * credential itself, which flags the key; anything else (network, 5xx) is our problem, not the key's.
 * Its own file so the concrete refreshers can extend it without importing the registry that holds them.
 */
export abstract class Refresher {
  abstract run(secrets: Secrets): Promise<Result>;

  /** Missing or unreadable expiry counts as stale — better one wasted refresh than a dead credential. */
  stale(s: Secrets, now = Date.now()): boolean {
    const exp = Date.parse(s.access_token_expires_at ?? "");
    return !s.access_token || Number.isNaN(exp) || exp <= now + BUFFER_MS;
  }
}
