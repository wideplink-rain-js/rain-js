import { describe, expect, it } from "vitest";

const { parseD1Bindings } = await import("../../cli/utils/toml-parser");

describe("parseD1Bindings", () => {
  it("extracts a single D1 binding", () => {
    const toml = `
name = "my-app"
main = ".rainjs/entry.ts"

[[d1_databases]]
binding = "DB"
database_name = "my-db"
database_id = "abc-123"
`;
    const result = parseD1Bindings(toml);
    expect(result).toEqual([
      {
        binding: "DB",
        database_name: "my-db",
        database_id: "abc-123",
      },
    ]);
  });

  it("extracts multiple D1 bindings", () => {
    const toml = `
[[d1_databases]]
binding = "DB"
database_name = "primary"
database_id = "id-1"

[[d1_databases]]
binding = "ANALYTICS"
database_name = "analytics"
database_id = "id-2"
`;
    const result = parseD1Bindings(toml);
    expect(result).toHaveLength(2);
    expect(result[0]?.binding).toBe("DB");
    expect(result[1]?.binding).toBe("ANALYTICS");
  });

  it("returns empty array when no D1 section", () => {
    const toml = `
name = "my-app"
main = ".rainjs/entry.ts"

[assets]
directory = "./public"
`;
    expect(parseD1Bindings(toml)).toEqual([]);
  });

  it("ignores comment lines", () => {
    const toml = `
# Database config
[[d1_databases]]
binding = "DB"
# database_name = "wrong"
database_name = "correct"
database_id = "abc"
`;
    const result = parseD1Bindings(toml);
    expect(result[0]?.database_name).toBe("correct");
  });

  it("handles D1 section followed by another section", () => {
    const toml = `
[[d1_databases]]
binding = "DB"
database_name = "my-db"
database_id = "abc"

[assets]
directory = "./public"
`;
    const result = parseD1Bindings(toml);
    expect(result).toHaveLength(1);
    expect(result[0]?.binding).toBe("DB");
  });

  it("handles D1 section at end of file", () => {
    const toml = `
name = "app"

[[d1_databases]]
binding = "DB"
database_name = "my-db"
database_id = "abc"`;
    const result = parseD1Bindings(toml);
    expect(result).toHaveLength(1);
  });
});
