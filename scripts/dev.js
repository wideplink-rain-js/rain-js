const fs = require("node:fs");
const { spawn } = require("node:child_process");
const { generate, ROUTES_DIR } = require("./generate");

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
