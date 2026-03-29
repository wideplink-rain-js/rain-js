import { describe, expect, it } from "vitest";
import {
  extractServerFunctions,
  generateActionId,
  generateClientProxy,
} from "../../../src/framework/compiler/server-action";

describe("extractServerFunctions", () => {
  it("detects use server in function declaration body", () => {
    const source = [
      "export async function addUser(formData: FormData) {",
      '  "use server";',
      "  console.log(formData);",
      "}",
    ].join("\n");

    const fns = extractServerFunctions(source);
    expect(fns).toHaveLength(1);
    expect(fns[0]).toEqual({
      name: "addUser",
      isExported: true,
      isAsync: true,
    });
  });

  it("detects use server in arrow function body", () => {
    const source = [
      "export const deleteUser = async (id: string) => {",
      '  "use server";',
      "  console.log(id);",
      "};",
    ].join("\n");

    const fns = extractServerFunctions(source);
    expect(fns).toHaveLength(1);
    expect(fns[0]).toEqual({
      name: "deleteUser",
      isExported: true,
      isAsync: true,
    });
  });

  it("detects use server in function expression", () => {
    const source = [
      "export const updateUser = async function(data: unknown) {",
      '  "use server";',
      "  console.log(data);',",
      "};",
    ].join("\n");

    const fns = extractServerFunctions(source);
    expect(fns).toHaveLength(1);
    expect(fns[0]?.name).toBe("updateUser");
  });

  it("detects all exported functions when file-level use server", () => {
    const source = [
      '"use server";',
      "",
      "export async function create(data: FormData) {",
      "  return data;",
      "}",
      "",
      "export async function remove(id: string) {",
      "  return id;",
      "}",
      "",
      "function privateHelper() {",
      "  return null;",
      "}",
    ].join("\n");

    const fns = extractServerFunctions(source);
    expect(fns).toHaveLength(2);
    expect(fns.map((f) => f.name)).toEqual(["create", "remove"]);
  });

  it("file-level use server includes exported arrow functions", () => {
    const source = [
      '"use server";',
      "",
      "export const handler = async () => {",
      "  return null;",
      "};",
    ].join("\n");

    const fns = extractServerFunctions(source);
    expect(fns).toHaveLength(1);
    expect(fns[0]?.name).toBe("handler");
  });

  it("ignores non-exported functions with file-level use server", () => {
    const source = [
      '"use server";',
      "",
      "function privateHelper() {",
      "  return null;",
      "}",
    ].join("\n");

    const fns = extractServerFunctions(source);
    expect(fns).toHaveLength(0);
  });

  it("ignores functions without use server in body", () => {
    const source = [
      "export async function normalHandler(req: Request) {",
      "  return new Response('ok');",
      "}",
    ].join("\n");

    const fns = extractServerFunctions(source);
    expect(fns).toHaveLength(0);
  });

  it("returns empty for file with no functions", () => {
    const source = "export const X = 42;\nexport type Y = string;";
    expect(extractServerFunctions(source)).toHaveLength(0);
  });

  it("returns empty for empty source", () => {
    expect(extractServerFunctions("")).toHaveLength(0);
  });

  it("detects non-async function with use server", () => {
    const source = [
      "export function syncAction(data: FormData) {",
      '  "use server";',
      "  return data;",
      "}",
    ].join("\n");

    const fns = extractServerFunctions(source);
    expect(fns).toHaveLength(1);
    expect(fns[0]).toEqual({
      name: "syncAction",
      isExported: true,
      isAsync: false,
    });
  });

  it("detects non-exported function with use server", () => {
    const source = [
      "async function internalAction(data: FormData) {",
      '  "use server";',
      "  return data;",
      "}",
    ].join("\n");

    const fns = extractServerFunctions(source);
    expect(fns).toHaveLength(1);
    expect(fns[0]).toEqual({
      name: "internalAction",
      isExported: false,
      isAsync: true,
    });
  });

  it("handles multiple server functions in one file", () => {
    const source = [
      "export async function addItem(fd: FormData) {",
      '  "use server";',
      "  return fd;",
      "}",
      "",
      "export async function removeItem(fd: FormData) {",
      '  "use server";',
      "  return fd;",
      "}",
      "",
      "export function normalRoute() {",
      "  return new Response('ok');",
      "}",
    ].join("\n");

    const fns = extractServerFunctions(source);
    expect(fns).toHaveLength(2);
    expect(fns.map((f) => f.name)).toEqual(["addItem", "removeItem"]);
  });

  it("handles single-quoted use server", () => {
    const source = [
      "export async function action(fd: FormData) {",
      "  'use server';",
      "  return fd;",
      "}",
    ].join("\n");

    const fns = extractServerFunctions(source);
    expect(fns).toHaveLength(1);
  });
});

describe("generateActionId", () => {
  it("generates deterministic IDs", () => {
    const id1 = generateActionId("src/routes/users/page.tsx", "addUser");
    const id2 = generateActionId("src/routes/users/page.tsx", "addUser");
    expect(id1).toBe(id2);
  });

  it("generates different IDs for different functions", () => {
    const id1 = generateActionId("src/routes/page.tsx", "create");
    const id2 = generateActionId("src/routes/page.tsx", "remove");
    expect(id1).not.toBe(id2);
  });

  it("generates different IDs for different files", () => {
    const id1 = generateActionId("src/routes/a/page.tsx", "action");
    const id2 = generateActionId("src/routes/b/page.tsx", "action");
    expect(id1).not.toBe(id2);
  });

  it("normalizes backslashes", () => {
    const id1 = generateActionId("src\\routes\\page.tsx", "action");
    const id2 = generateActionId("src/routes/page.tsx", "action");
    expect(id1).toBe(id2);
  });
});

describe("generateClientProxy", () => {
  it("generates fetch call code", () => {
    const code = generateClientProxy("abc123");
    expect(code).toContain("fetch");
    expect(code).toContain("/_rain/action/abc123");
    expect(code).toContain("POST");
  });

  it("escapes special characters in action ID", () => {
    const code = generateClientProxy('a"b\\c');
    expect(code).toContain('\\"');
    expect(code).toContain("\\\\");
  });
});
