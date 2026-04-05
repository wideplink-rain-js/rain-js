function dbIndexTemplate() {
  return [
    'import { db as createDb } from "@rainfw/core/db";',
    'import * as schema from "./schema";',
    "",
    "export function db() {",
    "  return createDb({ schema });",
    "}",
    "",
  ].join("\n");
}

module.exports = { dbIndexTemplate };
