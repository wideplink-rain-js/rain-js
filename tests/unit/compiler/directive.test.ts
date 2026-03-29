import { describe, expect, it } from "vitest";
import {
  detectDirective,
  hasUseClientDirective,
  hasUseServerDirective,
} from "../../../src/framework/compiler/directive";

describe("detectDirective", () => {
  it("detects use client", () => {
    const source = '"use client";\nexport function Counter() {}';
    expect(detectDirective(source)).toBe("use client");
  });

  it("detects use server", () => {
    const source = '"use server";\nexport async function action() {}';
    expect(detectDirective(source)).toBe("use server");
  });

  it("returns null for no directive", () => {
    const source = 'export const GET = () => new Response("ok");';
    expect(detectDirective(source)).toBeNull();
  });

  it("returns null for empty file", () => {
    expect(detectDirective("")).toBeNull();
  });

  it("returns null when directive is not the first statement", () => {
    const source = 'const x = 1;\n"use client";\nexport function C() {}';
    expect(detectDirective(source)).toBeNull();
  });

  it("returns null for non-directive string literals", () => {
    const source = '"use strict";\nexport function foo() {}';
    expect(detectDirective(source)).toBeNull();
  });

  it("handles single-quoted directive", () => {
    const source = "'use client';\nexport function Counter() {}";
    expect(detectDirective(source)).toBe("use client");
  });

  it("handles directive with no other code", () => {
    const source = '"use client";';
    expect(detectDirective(source)).toBe("use client");
  });

  it("handles directive with leading whitespace", () => {
    const source = '\n\n"use client";\nexport function C() {}';
    expect(detectDirective(source)).toBe("use client");
  });
});

describe("hasUseClientDirective", () => {
  it("returns true for use client", () => {
    expect(hasUseClientDirective('"use client";\nexport function C() {}')).toBe(
      true,
    );
  });

  it("returns false for use server", () => {
    expect(
      hasUseClientDirective('"use server";\nexport async function a() {}'),
    ).toBe(false);
  });

  it("returns false for no directive", () => {
    expect(hasUseClientDirective("export const x = 1;")).toBe(false);
  });
});

describe("hasUseServerDirective", () => {
  it("returns true for use server", () => {
    expect(
      hasUseServerDirective('"use server";\nexport async function a() {}'),
    ).toBe(true);
  });

  it("returns false for use client", () => {
    expect(hasUseServerDirective('"use client";\nexport function C() {}')).toBe(
      false,
    );
  });

  it("returns false for no directive", () => {
    expect(hasUseServerDirective("export const x = 1;")).toBe(false);
  });
});
