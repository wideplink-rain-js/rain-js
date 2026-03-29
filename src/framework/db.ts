import type { DrizzleD1Database } from "drizzle-orm/d1";
import { drizzle } from "drizzle-orm/d1";
import { bindings } from "./bindings";

interface D1Env {
  DB: D1Database;
}

interface DbOptions<S extends Record<string, unknown> = Record<string, never>> {
  schema?: S;
  d1?: D1Database;
}

function isDbOptions(value: unknown): value is DbOptions {
  return (
    value !== null &&
    value !== undefined &&
    typeof value === "object" &&
    ("schema" in value || "d1" in value)
  );
}

function resolveD1(d1?: D1Database): D1Database {
  const resolved = d1 ?? bindings<D1Env>().DB;
  if (!resolved) {
    throw new Error(
      '[Rain] D1 binding "DB" was not found in the ' +
        "current environment. " +
        "Ensure wrangler.toml has a [[d1_databases]] " +
        'section with binding = "DB". ' +
        "If using a custom binding name, pass it " +
        "explicitly: db({ d1: ctx.bindings.YOUR_DB })",
    );
  }
  return resolved;
}

export function db(): DrizzleD1Database;
export function db(d1: D1Database): DrizzleD1Database;
export function db<S extends Record<string, unknown>>(
  options: DbOptions<S>,
): DrizzleD1Database<S>;
export function db<S extends Record<string, unknown>>(
  d1OrOptions?: D1Database | DbOptions<S>,
): DrizzleD1Database<S> {
  if (isDbOptions(d1OrOptions)) {
    const resolved = resolveD1(d1OrOptions.d1);
    return (d1OrOptions.schema
      ? drizzle(resolved, { schema: d1OrOptions.schema })
      : drizzle(resolved)) as unknown as DrizzleD1Database<S>;
  }
  return drizzle(
    resolveD1(d1OrOptions as D1Database | undefined),
  ) as unknown as DrizzleD1Database<S>;
}
