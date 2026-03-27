function drizzleConfigTemplate() {
  return [
    'import { defineConfig } from "drizzle-kit";',
    "",
    "export default defineConfig({",
    '  out: "./drizzle",',
    '  schema: "./src/db/schema.ts",',
    '  dialect: "sqlite",',
    '  driver: "d1-http",',
    "});",
    "",
  ].join("\n");
}

module.exports = { drizzleConfigTemplate };
