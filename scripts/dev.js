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

function generate() {
  const dir = path.dirname(ENTRY_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const files = getRouteFiles(ROUTES_DIR);
  const imports = [];
  const registrations = [];

  for (const file of files) {
    const importName = filePathToImportName(file);
    const urlPath = filePathToUrlPath(file);
    const importPath = `../src/routes/${file.replace(/\.ts$/, "").replace(/\\/g, "/")}`;
    const fullPath = path.join(ROUTES_DIR, file);

    const methods = detectExportedMethods(fullPath);
    if (methods.length === 0) continue;

    const importSpecifiers = methods
      .map((m) => `${m} as ${importName}_${m}`)
      .join(", ");
    imports.push(`import { ${importSpecifiers} } from "${importPath}";`);

    for (const method of methods) {
      const methodLower = method.toLowerCase();
      registrations.push(
        `app.${methodLower}("${urlPath}", ${importName}_${method});`,
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
