#!/usr/bin/env node

const path = require("node:path");
const fs = require("node:fs");
const { spawn } = require("node:child_process");

const { stripControlChars } = require("./utils/sanitize");

const PACKAGE_JSON = path.join(__dirname, "..", "package.json");
const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, "utf-8"));

const command = process.argv[2];
const VALID_COMMANDS = ["dev", "build", "routes", "db"];

function printHelp() {
  console.log(`
  Rain.js v${pkg.version}

  Usage: rainjs <command>

  Commands:
    dev      Start development server (codegen + watch + wrangler dev)
    build    Run code generation only
    routes   Display registered routes
    db       D1 database management (init, generate, push, migrate, apply-local, studio)

  Options:
    --help, -h     Show this help message
    --version, -v  Show version number
`);
}

function printVersion() {
  console.log(`@rainfw/core v${pkg.version}`);
}

if (!command || command === "--help" || command === "-h") {
  printHelp();
  process.exit(0);
}

if (command === "--version" || command === "-v") {
  printVersion();
  process.exit(0);
}

if (!VALID_COMMANDS.includes(command)) {
  console.error(
    `[Rain] Error: Unknown command "${stripControlChars(command)}".\n` +
      `  → Available commands: ${VALID_COMMANDS.join(", ")}\n` +
      "  → Run \"rainjs --help\" for usage information.",
  );
  process.exit(1);
}

if (command === "db") {
  const { handleDbCommand } = require("./commands/db");
  handleDbCommand(process.argv[3]);
  process.exit(0);
}

if (command === "build") {
  const { generate } = require("../scripts/generate");
  generate();
}

if (command === "routes") {
  const {
    getRouteFiles,
    getMiddlewareFiles,
    getMiddlewaresForRoute,
    filePathToUrlPath,
    detectExportedMethods,
    middlewareImportName,
    ROUTES_DIR,
  } = require("../scripts/generate");

  if (!fs.existsSync(ROUTES_DIR)) {
    console.error(
      "[Rain] Error: src/routes/ directory not found.\n" +
        `  → Current directory: ${process.cwd()}\n` +
        "  → Ensure you are running this command from a Rain.js project root.\n" +
        "  → Or create the directory: mkdir -p src/routes",
    );
    process.exit(1);
  }

  const files = getRouteFiles(ROUTES_DIR);
  const middlewareFiles = getMiddlewareFiles(ROUTES_DIR);

  if (files.length === 0) {
    console.log("[Rain] No routes found in src/routes/.");
    console.log("  → Add a route file, e.g.: src/routes/route.ts");
    process.exit(0);
  }

  console.log("\n  Rain.js Routes\n");

  const rows = [];
  for (const file of files) {
    const urlPath = filePathToUrlPath(file);
    const fullPath = path.join(ROUTES_DIR, file);
    const methods = detectExportedMethods(fullPath);
    const applicableMw = getMiddlewaresForRoute(file, middlewareFiles);
    const mwNames = applicableMw.map((mf) => middlewareImportName(mf));

    rows.push({
      method: methods.join(", ") || "(none)",
      path: urlPath,
      file: `src/routes/${file.replace(/\\/g, "/")}`,
      middleware: mwNames.length > 0 ? mwNames.join(" → ") : "-",
    });
  }

  const maxMethod = Math.max(6, ...rows.map((r) => r.method.length));
  const maxPath = Math.max(4, ...rows.map((r) => r.path.length));
  const maxFile = Math.max(4, ...rows.map((r) => r.file.length));
  const maxMw = Math.max(10, ...rows.map((r) => r.middleware.length));

  const header = `  ${"METHOD".padEnd(maxMethod)}  ${"PATH".padEnd(maxPath)}  ${"FILE".padEnd(maxFile)}  ${"MIDDLEWARE".padEnd(maxMw)}`;
  const separator = `  ${"─".repeat(maxMethod)}  ${"─".repeat(maxPath)}  ${"─".repeat(maxFile)}  ${"─".repeat(maxMw)}`;

  console.log(header);
  console.log(separator);

  for (const row of rows) {
    console.log(
      `  ${row.method.padEnd(maxMethod)}  ${row.path.padEnd(maxPath)}  ${row.file.padEnd(maxFile)}  ${row.middleware.padEnd(maxMw)}`,
    );
  }

  console.log(`\n  Total: ${rows.length} route(s)\n`);
}

if (command === "dev") {
  const { generate, ROUTES_DIR } = require("../scripts/generate");

  generate();

  let debounceTimer = null;
  try {
    const watcher = fs.watch(
      ROUTES_DIR,
      { recursive: true },
      (eventType, filename) => {
        if (
          !(
            filename?.endsWith(".ts") ||
            filename?.endsWith(".tsx")
          )
        )
          return;
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          console.log(`[watch] ${eventType}: ${filename}`);
          generate();
        }, 100);
      },
    );

    watcher.on("error", (err) => {
      console.error(
        "[Rain] Error: File watcher encountered an error.\n" +
          `  \u2192 ${err.message}\n` +
          "  \u2192 The dev server will continue running, " +
          "but route changes won't be detected " +
          "automatically.\n" +
          '  \u2192 Run "rainjs build" manually after ' +
          "making route changes.",
      );
    });
  } catch (watchError) {
    console.error(
      "[Rain] Error: Failed to start file watcher on src/routes/.\n" +
        `  → ${watchError.message}\n` +
        "  → The dev server will still run, but route changes won't be detected automatically.\n" +
        '  → Run "rainjs build" manually after making route changes.',
    );
  }
  console.log("[watch] Watching src/routes/ for changes...");

  const wrangler = spawn("npx", ["wrangler", "dev"], {
    stdio: "inherit",
    shell: true,
    cwd: process.cwd(),
  });

  wrangler.on("error", (err) => {
    console.error(
      "[Rain] Error: Failed to start wrangler dev.\n" +
        `  → ${err.message}\n` +
        '  → Ensure wrangler is installed: npm install -D wrangler\n' +
        '  → Try running "npx wrangler dev" directly to debug.',
    );
    process.exit(1);
  });

  process.on("SIGINT", () => {
    wrangler.kill();
    process.exit(0);
  });

  wrangler.on("close", (code) => {
    process.exit(code ?? 0);
  });
}
