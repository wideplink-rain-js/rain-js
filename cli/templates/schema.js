function schemaTemplate() {
  return [
    'import { int, sqliteTable, text } from "drizzle-orm/sqlite-core";',
    "",
    'export const example = sqliteTable("example", {',
    "  id: int().primaryKey({ autoIncrement: true }),",
    "  name: text().notNull(),",
    '  createdAt: int({ mode: "timestamp" })',
    "    .notNull()",
    "    .$defaultFn(() => new Date()),",
    "});",
    "",
  ].join("\n");
}

module.exports = { schemaTemplate };
