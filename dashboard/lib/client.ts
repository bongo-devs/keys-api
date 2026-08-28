// The browser half of lib/ — types and one fetch wrapper, no database. The API is a separate Bun
// process on its own origin now, so every call is cross-site: the cookie needs `credentials` and the
// API answers with CORS. ponytail: nothing here may import ./db, that would ship the driver to the client.

export type Field = { name: string; label?: string; secret?: boolean; required?: boolean };

export type Provider = {
  slug: string; label: string; fields: Field[]; enabled: boolean;
  working: number; flagged: number; disabled: number; total: number;
};

export type Status = "working" | "flagged" | "disabled";
export const STATUSES: Status[] = ["working", "flagged", "disabled"];

export type Key = {
  id: string; name: string; secrets: Record<string, string>; status: Status; note: string | null;
  last_used_at: string | null; use_count: number; fail_count: number; flag_reason: string | null;
};

export type Token = {
  id: string; name: string; last_used_at: string | null; revoked_at: string | null; created_at: string;
};

/** Wraps a call so one handler owns every failure: 401 drops to the login gate, the rest is a banner. */
export type Guard = (fn: () => Promise<void>) => Promise<void>;

/** Thrown on 401 so one handler can drop the whole UI back to the login gate. */
export class Unauthorized extends Error {}

/**
 * Where the API lives. Inlined at build time by Next, so a new tunnel hostname needs a redeploy —
 * fine for a named tunnel. Empty means same-origin, which is the old behaviour.
 * Also shown in the UI wherever a route is printed to be copied, since the host is no longer implied.
 */
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(API_URL + path, {
    ...init,
    // The admin cookie is cross-site now; fetch's default of "same-origin" would silently drop it.
    credentials: "include",
    headers: { "content-type": "application/json", ...init?.headers },
  });
  if (res.status === 401) throw new Unauthorized("unauthorized");
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `http_${res.status}`);
  return data as T;
}

export const ago = (iso: string | null) => {
  if (!iso) return "never";
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return `${s | 0}s ago`;
  if (s < 3600) return `${(s / 60) | 0}m ago`;
  if (s < 86400) return `${(s / 3600) | 0}h ago`;
  return `${(s / 86400) | 0}d ago`;
};
