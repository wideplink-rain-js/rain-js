import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bundleClientFiles } from "../../../src/framework/compiler/bundle";

const TMP_DIR = join(__dirname, "__tmp_bundle_test__");
const OUT_DIR = join(TMP_DIR, "public", "_rain");
const SRC_DIR = join(TMP_DIR, "src");
const CLIENT_DIR = join(SRC_DIR, "framework", "client");

function setupFixtures(): void {
  mkdirSync(CLIENT_DIR, { recursive: true });

  writeFileSync(
    join(CLIENT_DIR, "jsx-runtime.ts"),
    [
      "export function jsx(tag: string, props: Record<string, unknown>) {",
      "  return { tag, props };",
      "}",
      "export function jsxs(tag: string, props: Record<string, unknown>) {",
      "  return { tag, props };",
      "}",
      "export const Fragment = Symbol('Fragment');",
    ].join("\n"),
  );

  writeFileSync(
    join(SRC_DIR, "counter.tsx"),
    [
      '"use client";',
      "export function Counter() {",
      "  return <button>Count</button>;",
      "}",
    ].join("\n"),
  );
}

describe("bundleClientFiles", () => {
  beforeAll(() => {
    setupFixtures();
  });

  afterAll(() => {
    if (existsSync(TMP_DIR)) {
      rmSync(TMP_DIR, { recursive: true, force: true });
    }
  });

  it("returns empty manifest for no entry points", async () => {
    const result = await bundleClientFiles({
      entryPoints: [],
      outDir: OUT_DIR,
      projectRoot: TMP_DIR,
    });
    expect(result.scripts).toHaveLength(0);
    expect(result.totalBytes).toBe(0);
  });

  it("bundles a client file and produces output", async () => {
    const result = await bundleClientFiles({
      entryPoints: [join(SRC_DIR, "counter.tsx")],
      outDir: OUT_DIR,
      projectRoot: TMP_DIR,
      minify: false,
    });
    expect(result.scripts.length).toBeGreaterThanOrEqual(1);
    expect(result.totalBytes).toBeGreaterThan(0);
    expect(result.scripts[0]).toMatch(/^\/_rain\/island-[a-zA-Z0-9]+\.js$/);
  });

  it("creates output directory if it does not exist", async () => {
    const freshOutDir = join(TMP_DIR, "fresh_out", "_rain");
    if (existsSync(freshOutDir)) {
      rmSync(freshOutDir, { recursive: true, force: true });
    }

    const result = await bundleClientFiles({
      entryPoints: [join(SRC_DIR, "counter.tsx")],
      outDir: freshOutDir,
      projectRoot: TMP_DIR,
    });
    expect(existsSync(freshOutDir)).toBe(true);
    expect(result.scripts.length).toBeGreaterThanOrEqual(1);
  });
});
