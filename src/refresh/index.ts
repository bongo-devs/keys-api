import type { KeyRepo, Secrets } from "../features/keys";
import { Refresher } from "./refresher";
import { YoutubeRefresher } from "./youtube";

export { Refresher };
export type { Result, Secrets } from "./refresher";

/** Keyed by provider slug; a provider with no entry hands its secrets straight through. Mutable so a
 *  test can stand a fake in front of a throwaway provider. */
export const REFRESHERS: Record<string, Refresher> = {
  youtube: new YoutubeRefresher(),
};

/**
 * Three outcomes: refreshed, so persist it and hand it out; someone else refreshed it while we were
 * asking, so use theirs; or the provider won't renew it, so flag the key and return null for the caller
 * to step past. The write-back is the point of the whole module — an unpersisted rotation locks a key
 * out permanently, because asking again spends a token the provider has already killed.
 */
export async function ensureFresh<K extends { id: string; secrets: Secrets }>(
  keys: KeyRepo,
  slug: string,
  key: K,
): Promise<K | null> {
  const refresher = REFRESHERS[slug];
  if (!refresher?.stale(key.secrets)) return key;

  const out = await refresher.run(key.secrets);
  if (out.ok) {
    keys.update(key.id, { secrets: out.secrets });
    return { ...key, secrets: out.secrets };
  }

  const current = keys.find(key.id);
  if (current && !refresher.stale(current.secrets)) return { ...key, secrets: current.secrets };

  console.error(`[refresh] ${slug} ${key.id}: ${out.error}`);
  if (out.dead) keys.update(key.id, { status: "flagged", reason: out.error.slice(0, 200) });
  return null;
}
