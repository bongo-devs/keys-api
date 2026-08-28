import type { Database } from "bun:sqlite";

export type Row = Record<string, unknown>;
/** What SQLite will actually bind — notably not `undefined`, which is why setClause drops those keys. */
export type Params = Record<string, string | number | boolean | null>;

/**
 * The row plumbing all three tables share, so a subclass is only its SQL. SQLite has no json, no
 * boolean and no timestamp type, and every one of those has to reach the dashboard as the JSON type it
 * expects, so the conversion happens here rather than once per table.
 */
export abstract class Repo<T> {
  /** Columns holding JSON text. */
  protected json: string[] = [];
  /** Columns holding 0/1 that must serialise as a JSON boolean. */
  protected bool: string[] = [];

  constructor(protected readonly db: Database) {}

  /**
   * Every `*_at` column in the schema stores epoch millis and leaves here as ISO with a Z: the
   * dashboard's `ago()` runs Date.parse, which reads a bare "2026-08-28 10:00:00" as local time.
   */
  private map<R>(r: Row): R {
    for (const [k, v] of Object.entries(r)) {
      if (k.endsWith("_at")) r[k] = typeof v === "number" ? new Date(v).toISOString() : null;
      else if (this.json.includes(k)) r[k] = JSON.parse(v as string);
      else if (this.bool.includes(k)) r[k] = !!v;
    }
    return r as R;
  }

  /** `R` is for the statements that project fewer columns than the whole row. */
  protected one<R = T>(sql: string, params: Params = {}): R | null {
    // query() caches the prepared statement per connection, so the parse cost is paid once
    const row = this.db.query(sql).get(params) as Row | null;
    return row ? this.map<R>(row) : null;
  }

  protected many<R = T>(sql: string, params: Params = {}): R[] {
    return (this.db.query(sql).all(params) as Row[]).map((r) => this.map<R>(r));
  }

  /** True when the statement touched a row — every write in this app is scoped to one id. */
  protected changed(sql: string, params: Params = {}): boolean {
    return this.db.query(sql).run(params).changes > 0;
  }
}

/**
 * `label = $label, enabled = $enabled` for exactly the keys that are present, which is what replaces a
 * `coalesce(<param>::text, col)` per column. Absent (undefined) means leave it alone; null means null.
 */
export function setClause(patch: Row): { sql: string; params: Params } {
  const present = Object.entries(patch).filter(([, v]) => v !== undefined);
  return {
    sql: present.map(([k]) => `${k} = $${k}`).join(", "),
    params: Object.fromEntries(present) as Params,
  };
}
