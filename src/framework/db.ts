import type { DrizzleD1Database } from "drizzle-orm/d1";
import { drizzle } from "drizzle-orm/d1";
import { bindings, requestLocal } from "./bindings";

interface D1Env {
  DB: D1Database;
}

interface DbOptions<S extends Record<string, unknown> = Record<string, never>> {
  schema?: S;
  d1?: D1Database;
}

interface DbCacheEntry {
  d1: D1Database;
  schema: Record<string, unknown> | undefined;
  instance: DrizzleD1Database<Record<string, unknown>>;
}

const DB_CACHE_KEY = Symbol.for("rain.db.cache");

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

function cachedDrizzle<S extends Record<string, unknown>>(
  d1: D1Database,
  schema?: S,
): DrizzleD1Database<S> {
  const cache = requestLocal<DbCacheEntry[]>(DB_CACHE_KEY, () => []);
  const found = cache.find((e) => e.d1 === d1 && e.schema === schema);
  if (found) return found.instance as DrizzleD1Database<S>;
  const instance = (schema
    ? drizzle(d1, { schema })
    : drizzle(d1)) as unknown as DrizzleD1Database<S>;
  cache.push({
    d1,
    schema,
    instance: instance as DrizzleD1Database<Record<string, unknown>>,
  });
  return instance;
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
    return cachedDrizzle(resolved, d1OrOptions.schema as S | undefined);
  }
  return cachedDrizzle(resolveD1(d1OrOptions as D1Database | undefined));
}
