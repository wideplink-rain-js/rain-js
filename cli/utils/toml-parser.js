const fs = require("node:fs");
const path = require("node:path");

const WRANGLER_TOML = path.join(process.cwd(), "wrangler.toml");

function parseD1Bindings(content) {
  const results = [];
  const lines = content.split("\n");
  let inD1Section = false;
  let current = {};

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith("#")) continue;

    if (trimmed === "[[d1_databases]]") {
      if (inD1Section && current.binding) {
        results.push({ ...current });
      }
      inD1Section = true;
      current = {};
      continue;
    }

    if (trimmed.startsWith("[") && inD1Section) {
      if (current.binding) {
        results.push({ ...current });
      }
      inD1Section = false;
      current = {};
      continue;
    }

    if (inD1Section) {
      const match = trimmed.match(/^([\w-]+)\s*=\s*"([^"]*)"/);
      if (match) {
        current[match[1]] = match[2];
      }
    }
  }

  if (inD1Section && current.binding) {
    results.push({ ...current });
  }

  return results;
}

function getD1Bindings() {
  if (!fs.existsSync(WRANGLER_TOML)) {
    return [];
  }
  const content = fs.readFileSync(WRANGLER_TOML, "utf-8");
  return parseD1Bindings(content);
}

module.exports = { parseD1Bindings, getD1Bindings, WRANGLER_TOML };
