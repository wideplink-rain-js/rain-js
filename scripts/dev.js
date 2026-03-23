const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const ROUTES_DIR = path.join(__dirname, "..", "src", "routes");
const ENTRY_FILE = path.join(__dirname, "..", ".rainjs", "entry.ts");

const HTTP_METHODS = ["GET", "POST", "PUT", "DELETE"];

function getRouteFiles(dir, base = "") {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.join(base, entry.name);

    if (entry.isDirectory()) {
      files.push(...getRouteFiles(fullPath, relativePath));
    } else if (entry.name === "route.ts") {
      files.push(relativePath);
    }
  }

  return files;
}

function getMiddlewareFiles(dir, base = "") {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.join(base, entry.name);

    if (entry.isDirectory()) {
      files.push(...getMiddlewareFiles(fullPath, relativePath));
    } else if (entry.name === "_middleware.ts") {
      files.push(relativePath);
    }
  }

  return files;
}

function middlewarePathToDir(filePath) {
  return filePath
    .replace(/\\/g, "/")
    .replace(/_middleware\.ts$/, "")
    .replace(/\/$/, "");
}

function routePathToDir(filePath) {
  return filePath
    .replace(/\\/g, "/")
    .replace(/route\.ts$/, "")
    .replace(/\/$/, "");
}

function middlewareImportName(filePath) {
  const base = filePath
    .replace(/_middleware\.ts$/, "")
    .replace(/\\/g, "_")
    .replace(/\//g, "_")
    .replace(/\[/g, "$")
    .replace(/\]/g, "")
    .replace(/-/g, "_");
  return `mw_${base || "root"}`;
}

function getMiddlewaresForRoute(routeFile, middlewareFiles) {
  const routeDir = routePathToDir(routeFile);
  const applicable = [];

  for (const mwFile of middlewareFiles) {
    const mwDir = middlewarePathToDir(mwFile);
    if (
      mwDir === "" ||
      routeDir === mwDir ||
      routeDir.startsWith(`${mwDir}/`)
    ) {
      applicable.push(mwFile);
    }
  }

  applicable.sort((a, b) => {
    const depthA = a.split(/[\\/]/).length;
    const depthB = b.split(/[\\/]/).length;
    return depthA - depthB;
  });

  return applicable;
}

function filePathToUrlPath(filePath) {
  let urlPath = filePath.replace(/\.ts$/, "");
  urlPath = urlPath.replace(/\\/g, "/");
  urlPath = urlPath.replace(/\[([^\]]+)\]/g, ":$1");
  urlPath = urlPath.replace(/\/route$/, "");
  if (urlPath === "route") urlPath = "";
  return `/${urlPath}`;
}

function filePathToImportName(filePath) {
  return (
    "route_" +
    filePath
      .replace(/\.ts$/, "")
      .replace(/\\/g, "_")
      .replace(/\//g, "_")
      .replace(/\[/g, "$")
      .replace(/\]/g, "")
      .replace(/-/g, "_")
  );
}

function detectExportedMethods(filePath) {
  const content = fs.readFileSync(filePath, "utf-8");
  const found = [];
  for (const method of HTTP_METHODS) {
    const pattern = new RegExp(
      `export\\s+(?:const|function|async\\s+function)\\s+${method}\\b`,
    );
    if (pattern.test(content)) {
      found.push(method);
    }
  }
  return found;
}

function detectMiddlewareExport(filePath) {
  const content = fs.readFileSync(filePath, "utf-8");
  const pattern = /export\s+(?:const|function|async\s+function)\s+onRequest\b/;
  return pattern.test(content);
}

function generate() {
  const dir = path.dirname(ENTRY_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const files = getRouteFiles(ROUTES_DIR);
  const middlewareFiles = getMiddlewareFiles(ROUTES_DIR);
  const imports = [];
  const registrations = [];

  const importedMiddlewares = new Set();
  for (const mwFile of middlewareFiles) {
    const fullMwPath = path.join(ROUTES_DIR, mwFile);
    const relMwPath = `src/routes/${mwFile.replace(/\\/g, "/")}`;
    if (!detectMiddlewareExport(fullMwPath)) {
      console.error(
        `[Rain] No "onRequest" export found in ${relMwPath}. ` +
          'Middleware files must export "onRequest". Example:\n' +
          "  export const onRequest: Middleware = async (ctx, next) => { ... }",
      );
      continue;
    }
    const name = middlewareImportName(mwFile);
    const importPath = `../src/routes/${mwFile.replace(/\.ts$/, "").replace(/\\/g, "/")}`;
    imports.push(`import { onRequest as ${name} } from "${importPath}";`);
    importedMiddlewares.add(name);
  }

  for (const file of files) {
    const importName = filePathToImportName(file);
    const urlPath = filePathToUrlPath(file);
    const importPath = `../src/routes/${file.replace(/\.ts$/, "").replace(/\\/g, "/")}`;
    const fullPath = path.join(ROUTES_DIR, file);

    const methods = detectExportedMethods(fullPath);
    if (methods.length === 0) {
      const relPath = `src/routes/${file.replace(/\\/g, "/")}`;
      console.error(
        `[Rain] No exported handlers found in ${relPath}. ` +
          "Add an exported handler, e.g.: export const GET: Handler = (ctx) => { ... }",
      );
      continue;
    }

    const importSpecifiers = methods
      .map((m) => `${m} as ${importName}_${m}`)
      .join(", ");
    imports.push(`import { ${importSpecifiers} } from "${importPath}";`);

    const applicableMw = getMiddlewaresForRoute(file, middlewareFiles);
    const mwNames = applicableMw.map((mf) => middlewareImportName(mf));
    const mwArrayStr = mwNames.length > 0 ? `, [${mwNames.join(", ")}]` : "";

    for (const method of methods) {
      const methodLower = method.toLowerCase();
      registrations.push(
        `app.${methodLower}("${urlPath}", ${importName}_${method}${mwArrayStr});`,
      );
    }
  }

  const content = [
    'import { Rain } from "../src/framework";',
    ...imports,
    "",
    "const app = new Rain();",
    "",
    ...registrations,
    "",
    "export default app;",
    "",
  ].join("\n");

  fs.writeFileSync(ENTRY_FILE, content);
  console.log(`[gen] ${files.length} route(s) -> .rainjs/entry.ts`);
}

generate();

let debounceTimer = null;
fs.watch(ROUTES_DIR, { recursive: true }, (eventType, filename) => {
  if (!filename?.endsWith(".ts")) return;
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    console.log(`[watch] ${eventType}: ${filename}`);
    generate();
  }, 100);
});
console.log("[watch] Watching src/routes/ for changes...");

const wrangler = spawn("npx", ["wrangler", "dev"], {
  stdio: "inherit",
  shell: true,
  cwd: path.join(__dirname, ".."),
});

process.on("SIGINT", () => {
  wrangler.kill();
  process.exit(0);
});

wrangler.on("close", (code) => {
  process.exit(code ?? 0);
});
