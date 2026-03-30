import {
  existsSync,
  mkdirSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";
import type { Metafile } from "esbuild";
import { build } from "esbuild";

export interface BundleOptions {
  entryPoints: string[];
  outDir: string;
  projectRoot: string;
  minify?: boolean;
  clientEntrySource?: string;
  clientEntryDir?: string;
  staticDir?: string;
}

export interface BundleManifest {
  scripts: string[];
  totalBytes: number;
}

function cleanOldBundles(outDir: string): void {
  if (!existsSync(outDir)) return;
  for (const file of readdirSync(outDir)) {
    if (file.startsWith("island-") || file.startsWith("rain-client-")) {
      unlinkSync(join(outDir, file));
    }
  }
}

function extractManifest(
  metafile: Metafile,
  publicDir: string,
): BundleManifest {
  const scripts: string[] = [];
  let totalBytes = 0;

  for (const [outPath, meta] of Object.entries(metafile.outputs)) {
    if (meta.entryPoint) {
      const relPath = relative(publicDir, outPath);
      scripts.push(`/${relPath.replace(/\\/g, "/")}`);
      totalBytes += meta.bytes;
    }
  }

  return { scripts, totalBytes };
}

export async function bundleClientFiles(
  options: BundleOptions,
): Promise<BundleManifest> {
  if (options.entryPoints.length === 0 && !options.clientEntrySource) {
    return { scripts: [], totalBytes: 0 };
  }

  if (!existsSync(options.outDir)) {
    mkdirSync(options.outDir, { recursive: true });
  }

  cleanOldBundles(options.outDir);

  let entryPoints = options.entryPoints;

  if (options.clientEntrySource && options.clientEntryDir) {
    if (!existsSync(options.clientEntryDir)) {
      mkdirSync(options.clientEntryDir, { recursive: true });
    }
    const clientEntryPath = join(options.clientEntryDir, "client-entry.ts");
    writeFileSync(clientEntryPath, options.clientEntrySource);
    entryPoints = [clientEntryPath];
  }

  const result = await build({
    entryPoints,
    outdir: options.outDir,
    bundle: true,
    minify: options.minify ?? true,
    format: "esm",
    metafile: true,
    entryNames: "rain-client-[hash]",
    write: true,
    treeShaking: true,
    platform: "browser",
    target: ["es2022"],
    jsx: "automatic",
    jsxImportSource: "@rainfw/core",
    alias: {
      "@rainfw/core/jsx-runtime": resolve(
        options.projectRoot,
        "src/framework/client/jsx-runtime.ts",
      ),
    },
    loader: { ".ts": "ts", ".tsx": "tsx" },
  });

  const staticRoot =
    options.staticDir ?? resolve(options.projectRoot, "public");
  return extractManifest(result.metafile, staticRoot);
}
