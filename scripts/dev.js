const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const {
  generate,
  regenerateClient,
  copyPublicToStatic,
  ROUTES_DIR,
} = require("./generate");
const { printBanner } = require("../cli/utils/banner");

const SRC_DIR = path.join(process.cwd(), "src");

printBanner();

generate();

let debounceTimer = null;
try {
  const watcher = fs.watch(
    ROUTES_DIR,
    { recursive: true },
    (eventType, filename) => {
      if (!(filename?.endsWith(".ts") || filename?.endsWith(".tsx"))) return;
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
        "but route changes won't be detected automatically.\n" +
        '  \u2192 Run "npm run build" manually after ' +
        "making route changes.",
    );
  });
} catch (watchError) {
  console.error(
    "[Rain] Error: Failed to start file watcher " +
      "on src/routes/.\n" +
      `  \u2192 ${watchError.message}\n` +
      "  \u2192 The dev server will still run, " +
      "but route changes won't be detected automatically.\n" +
      '  \u2192 Run "npm run build" manually after ' +
      "making route changes.",
  );
}
console.log("[watch] Watching src/routes/ for changes...");

let clientDebounceTimer = null;
try {
  const clientWatcher = fs.watch(
    SRC_DIR,
    { recursive: true },
    (eventType, filename) => {
      if (!(filename?.endsWith(".ts") || filename?.endsWith(".tsx"))) return;
      if (filename.startsWith("routes")) return;
      clearTimeout(clientDebounceTimer);
      clientDebounceTimer = setTimeout(() => {
        console.log(`[watch:client] ${eventType}: ${filename}`);
        regenerateClient();
      }, 200);
    },
  );

  clientWatcher.on("error", () => {
    console.error("[Rain] Warning: Client file watcher error.");
  });
} catch (_clientWatchError) {
  console.error("[Rain] Warning: Failed to start client file watcher.");
}
console.log("[watch] Watching src/ for client component changes...");

const PUBLIC_DIR = path.join(process.cwd(), "public");
let publicDebounceTimer = null;
try {
  if (fs.existsSync(PUBLIC_DIR)) {
    const publicWatcher = fs.watch(
      PUBLIC_DIR,
      { recursive: true },
      (_eventType, filename) => {
        clearTimeout(publicDebounceTimer);
        publicDebounceTimer = setTimeout(() => {
          console.log(`[watch:public] ${filename}`);
          copyPublicToStatic();
        }, 100);
      },
    );
    publicWatcher.on("error", () => {
      console.error("[Rain] Warning: Public file watcher error.");
    });
  }
} catch (_publicWatchError) {
  console.error("[Rain] Warning: Failed to start public file watcher.");
}
console.log("[watch] Watching public/ for static asset changes...");

const wrangler = spawn("npx", ["wrangler", "dev"], {
  stdio: "inherit",
  shell: true,
  cwd: process.cwd(),
});

process.on("SIGINT", () => {
  wrangler.kill();
  process.exit(0);
});

wrangler.on("close", (code) => {
  process.exit(code ?? 0);
});
