import type { DrizzleD1Database } from "drizzle-orm/d1";
import { drizzle } from "drizzle-orm/d1";
import { bindings } from "./bindings";

interface D1Env {
  DB: D1Database;
}

export function db(d1Binding?: D1Database): DrizzleD1Database {
  const d1 = d1Binding ?? bindings<D1Env>().DB;
  if (!d1) {
    throw new Error(
      '[Rain] D1 binding "DB" was not found in the ' +
        "current environment. " +
        "Ensure wrangler.toml has a [[d1_databases]] " +
        'section with binding = "DB". ' +
        "If using a custom binding name, pass it " +
        "explicitly: db(ctx.bindings.YOUR_DB)",
    );
  }
  return drizzle(d1);
}
