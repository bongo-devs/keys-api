import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import { ApiError } from "./errors";

export const STATUSES = ["working", "flagged", "disabled"] as const;
export type Status = (typeof STATUSES)[number];

/** Mirrors the check constraint in core/db.ts. `admin` is reserved so /api/admin/* can never collide. */
const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
export const isSlug = (v: string) => SLUG_RE.test(v) && v !== "admin";

export type Field = { name: string; label?: string; secret?: boolean; required?: boolean };

/** Required, trimmed, non-empty — one code for "missing", "not a string" and "blank" alike. */
export const text = (code: string) => z.string({ error: code }).trim().min(1, code);

/** Optional and trimmed, where "" means absent: the dashboard posts empty inputs rather than omitting
 *  them, and a blank note must read as "leave it alone", not as a validation error. */
export const opt = (code: string) =>
  z
    .string({ error: code })
    .trim()
    .optional()
    .transform((v) => v || undefined);

export const Status = z.enum(STATUSES, { error: "invalid_status" });

/** A flat {string: string} map, so a nested blob can never land in a secrets column. The code is a
 *  parameter because a *missing* map on create reads as `secrets_required`, not `invalid_secrets`. */
export const secretsMap = (code: string) =>
  z.record(z.string({ error: code }), z.string({ error: code }), { error: code });

/** Attached to the failure body when the matching code fires, so curl gets the rule and not just the
 *  code. Keyed by code, so a hint can never end up pinned to a different field's failure. */
const HINTS: Record<string, Record<string, unknown>> = {
  invalid_slug: { hint: "a-z 0-9 _ - , max 32, not 'admin'" },
  invalid_fields: { hint: "[{name, label?, secret?, required?}]" },
  invalid_secrets: { hint: "flat object of string -> string" },
  secrets_required: { hint: "flat object of string -> string, at least one entry" },
  invalid_status: { allowed: STATUSES },
};

/**
 * The one input gate. Every schema's message is the error code, so the first issue becomes {error} and
 * the codes bots already match on (`invalid_status`, `name_required`, …) don't move; `issues` carries
 * the rest for a human running curl. `status` exists for login, where a malformed body must look
 * identical to a wrong password rather than telling a prober the field was merely blank.
 */
export async function body<S extends z.ZodType>(
  c: Context,
  schema: S,
  status: ContentfulStatusCode = 400,
): Promise<z.output<S>> {
  // a body that isn't JSON, or isn't an object, reads as {} so the schema names the missing field
  const raw = await c.req.json().catch(() => null);
  const parsed = schema.safeParse(raw && typeof raw === "object" ? raw : {});
  if (parsed.success) return parsed.data;

  const code = parsed.error.issues[0]!.message;
  throw new ApiError(status, code, {
    ...HINTS[code],
    issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
  });
}
