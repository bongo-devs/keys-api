import { SQLiteError } from "bun:sqlite";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/**
 * Thrown, not returned: a handler that can't continue says so in one expression instead of carrying
 * `if (!x) return fail(...)` down the happy path. `onError` below renders every one of them.
 */
export class ApiError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(code);
  }

  get body() {
    return { error: this.code, ...this.extra };
  }
}

const at =
  (status: ContentfulStatusCode) =>
  (code: string, extra?: Record<string, unknown>) =>
    new ApiError(status, code, extra);

export const badRequest = at(400);
export const unauthorized = at(401);
export const notFound = at(404);
export const tooMany = at(429);
export const unavailable = at(503);

/** Turns a nullable lookup into a value or a 404, so a route body stays a single expression. */
export function must<T>(value: T | null | undefined, code: string): T {
  if (value == null) throw notFound(code);
  return value;
}

export function onError(err: Error, c: Context) {
  if (err instanceof ApiError) return c.json(err.body, err.status);
  // A violated constraint is a client mistake, not a bug — the same split the Postgres version made
  // on SQLSTATE 23505 vs 23514/23503.
  if (err instanceof SQLiteError && err.code?.startsWith("SQLITE_CONSTRAINT")) {
    const taken = err.code === "SQLITE_CONSTRAINT_UNIQUE" || err.code === "SQLITE_CONSTRAINT_PRIMARYKEY";
    return taken ? c.json({ error: "already_exists" }, 409) : c.json({ error: "constraint_violation" }, 400);
  }
  console.error(err);
  return c.json({ error: "internal_error" }, 500);
}
