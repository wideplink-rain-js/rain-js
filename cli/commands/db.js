const path = require("node:path");
const fs = require("node:fs");
const { getD1Bindings } = require("../utils/toml-parser");
const { runCommand, npmInstall } = require("../utils/process");
const { stripControlChars } = require("../utils/sanitize");
const { schemaTemplate } = require("../templates/schema");
const {
  drizzleConfigTemplate,
} = require("../templates/drizzle-config");
const {
  dbIndexTemplate,
} = require("../templates/db-index");
const {
  seedTemplate,
} = require("../templates/seed");

const SCHEMA_DIR = path.join(process.cwd(), "src", "db");
const SCHEMA_FILE = path.join(SCHEMA_DIR, "schema.ts");
const INDEX_FILE = path.join(SCHEMA_DIR, "index.ts");
const DRIZZLE_CONFIG = path.join(
  process.cwd(),
  "drizzle.config.ts",
);
const DRIZZLE_DIR = path.join(process.cwd(), "drizzle");
const SEED_FILE = path.join(
  process.cwd(),
  "src",
  "db",
  "seed.sql",
);
const SAFE_NAME_RE = /^[\w.\-]+$/;

const DB_SUBCOMMANDS = [
  "init",
  "generate",
  "push",
  "migrate",
  "apply-local",
  "seed",
  "studio",
];

function printDbHelp() {
  console.log(`
  Rain.js DB Commands

  Usage: rainjs db <subcommand>

  Subcommands:
    init         Set up D1 + Drizzle ORM integration
    generate     Generate migration SQL from schema changes
    push         Apply schema directly to D1 (remote)
    migrate      Run pending migrations (remote)
    apply-local  Apply migrations to local D1 (wrangler dev)
    seed         Insert seed data into D1
    studio       Open Drizzle Studio (DB browser)

  Flags:
    --remote     Target remote D1 instead of local (seed)
`);
}

function assertD1Configured() {
  const d1Bindings = getD1Bindings();
  if (d1Bindings.length === 0) {
    console.error(
      "[Rain] Error: No D1 database bindings found " +
        "in wrangler.toml.\n\n" +
        "  \u2192 Add a D1 binding to wrangler.toml:\n\n" +
        "    [[d1_databases]]\n" +
        '    binding = "DB"\n' +
        '    database_name = "my-db"\n' +
        '    database_id = "your-database-id"\n\n' +
        "  \u2192 Create a D1 database:\n" +
        "    npx wrangler d1 create my-db\n\n" +
        "  \u2192 Then run: npx rainjs db init",
    );
    process.exit(1);
  }
  return d1Bindings;
}

function assertDrizzleInstalled() {
  try {
    require.resolve("drizzle-kit");
  } catch {
    console.error(
      "[Rain] Error: drizzle-kit is not installed.\n" +
        "  \u2192 Run: npx rainjs db init",
    );
    process.exit(1);
  }
}

function dbInit() {
  const d1Bindings = assertD1Configured();
  const primary = d1Bindings[0];

  console.log(
    `\n[Rain] D1 binding "${primary.binding}" ` +
      "\u3092 wrangler.toml \u304b\u3089\u691c\u51fa\u3057\u307e\u3057\u305f\n",
  );

  console.log(
    "1/4  drizzle-orm \u3092\u30a4\u30f3\u30b9\u30c8\u30fc\u30eb\u4e2d...",
  );
  const ormStatus = npmInstall(["drizzle-orm"]);
  if (ormStatus !== 0) {
    console.error(
      "[Rain] Error: drizzle-orm \u306e\u30a4\u30f3\u30b9\u30c8\u30fc\u30eb" +
        "\u306b\u5931\u6557\u3057\u307e\u3057\u305f\u3002\n" +
        "  \u2192 \u624b\u52d5\u3067\u5b9f\u884c: npm install drizzle-orm",
    );
    process.exit(1);
  }

  console.log(
    "\n2/4  drizzle-kit \u3092\u30a4\u30f3\u30b9\u30c8\u30fc\u30eb\u4e2d...",
  );
  const kitStatus = npmInstall(["drizzle-kit"], true);
  if (kitStatus !== 0) {
    console.error(
      "[Rain] Error: drizzle-kit \u306e\u30a4\u30f3\u30b9\u30c8\u30fc\u30eb" +
        "\u306b\u5931\u6557\u3057\u307e\u3057\u305f\u3002\n" +
        "  \u2192 \u624b\u52d5\u3067\u5b9f\u884c: npm install -D drizzle-kit",
    );
    process.exit(1);
  }

  console.log(
    "\n3/4  \u30d5\u30a1\u30a4\u30eb\u3092\u751f\u6210\u4e2d...",
  );

  if (!fs.existsSync(SCHEMA_DIR)) {
    fs.mkdirSync(SCHEMA_DIR, { recursive: true });
  }

  if (fs.existsSync(SCHEMA_FILE)) {
    console.log(
      "     \u2298 src/db/schema.ts " +
        "\u306f\u65e2\u306b\u5b58\u5728\u3057\u307e\u3059" +
        "\uff08\u30b9\u30ad\u30c3\u30d7\uff09",
    );
  } else {
    fs.writeFileSync(SCHEMA_FILE, schemaTemplate());
    console.log("     \u2713 src/db/schema.ts");
  }

  if (fs.existsSync(INDEX_FILE)) {
    console.log(
      "     \u2298 src/db/index.ts " +
        "\u306f\u65e2\u306b\u5b58\u5728\u3057\u307e\u3059" +
        "\uff08\u30b9\u30ad\u30c3\u30d7\uff09",
    );
  } else {
    fs.writeFileSync(INDEX_FILE, dbIndexTemplate());
    console.log("     \u2713 src/db/index.ts");
  }

  if (fs.existsSync(DRIZZLE_CONFIG)) {
    console.log(
      "     \u2298 drizzle.config.ts " +
        "\u306f\u65e2\u306b\u5b58\u5728\u3057\u307e\u3059" +
        "\uff08\u30b9\u30ad\u30c3\u30d7\uff09",
    );
  } else {
    fs.writeFileSync(DRIZZLE_CONFIG, drizzleConfigTemplate());
    console.log("     \u2713 drizzle.config.ts");
  }

  if (fs.existsSync(SEED_FILE)) {
    console.log(
      "     \u2298 src/db/seed.sql " +
        "\u306f\u65e2\u306b\u5b58\u5728\u3057\u307e\u3059" +
        "\uff08\u30b9\u30ad\u30c3\u30d7\uff09",
    );
  } else {
    fs.writeFileSync(SEED_FILE, seedTemplate());
    console.log("     \u2713 src/db/seed.sql");
  }

  console.log(
    "\n4/4  \u578b\u5b9a\u7fa9\u3092\u66f4\u65b0\u4e2d...",
  );
  runCommand("npx", ["wrangler", "types"]);

  console.log(
    "\n[Rain] D1 \u30bb\u30c3\u30c8\u30a2\u30c3\u30d7\u304c" +
      "\u5b8c\u4e86\u3057\u307e\u3057\u305f\uff01\n\n" +
      "  \u6b21\u306e\u30b9\u30c6\u30c3\u30d7:\n" +
      "    1. src/db/schema.ts " +
      "\u3067\u30c6\u30fc\u30d6\u30eb\u3092\u5b9a\u7fa9\n" +
      "    2. npx rainjs db generate " +
      "\u3067\u30de\u30a4\u30b0\u30ec\u30fc\u30b7\u30e7\u30f3\u751f\u6210\n" +
      "    3. npx rainjs db push " +
      "\u3067 D1 \u306b\u9069\u7528\n" +
      "    4. npx rainjs db seed " +
      "\u3067\u521d\u671f\u30c7\u30fc\u30bf\u6295\u5165\n\n" +
      "  \u30eb\u30fc\u30c8\u30cf\u30f3\u30c9\u30e9\u3067\u306e" +
      "\u4f7f\u3044\u65b9:\n\n" +
      '    import { db } from "../db";\n' +
      '    import { todos } from "../db/schema";\n\n' +
      "    export const GET: Handler = async (ctx) => {\n" +
      "      const rows = await db().select().from(todos);\n" +
      "      return ctx.json(rows);\n" +
      "    };\n",
  );
}

function dbGenerate() {
  assertD1Configured();
  assertDrizzleInstalled();
  console.log(
    "[Rain] \u30de\u30a4\u30b0\u30ec\u30fc\u30b7\u30e7\u30f3" +
      "\u3092\u751f\u6210\u4e2d...\n",
  );
  const status = runCommand("npx", ["drizzle-kit", "generate"]);
  if (status !== 0) {
    console.error(
      "\n[Rain] Error: \u30de\u30a4\u30b0\u30ec\u30fc\u30b7\u30e7\u30f3" +
        "\u751f\u6210\u306b\u5931\u6557\u3057\u307e\u3057\u305f\u3002\n" +
        "  \u2192 src/db/schema.ts \u306e\u30b9\u30ad\u30fc\u30de" +
        "\u5b9a\u7fa9\u3092\u78ba\u8a8d\u3057\u3066\u304f\u3060\u3055\u3044\n" +
        "  \u2192 drizzle-kit \u304c\u30a4\u30f3\u30b9\u30c8\u30fc\u30eb" +
        "\u3055\u308c\u3066\u3044\u308b\u304b\u78ba\u8a8d: " +
        "npx rainjs db init",
    );
    process.exit(1);
  }
}

function dbPush() {
  assertD1Configured();
  assertDrizzleInstalled();
  console.log(
    "[Rain] D1 \u306b\u30b9\u30ad\u30fc\u30de\u3092" +
      "\u9069\u7528\u4e2d...\n",
  );
  const status = runCommand("npx", ["drizzle-kit", "push"]);
  if (status !== 0) {
    console.error(
      "\n[Rain] Error: \u30b9\u30ad\u30fc\u30de\u306e\u9069\u7528\u306b" +
        "\u5931\u6557\u3057\u307e\u3057\u305f\u3002\n" +
        "  \u2192 wrangler.toml \u306e D1 \u8a2d\u5b9a\u3092" +
        "\u78ba\u8a8d\u3057\u3066\u304f\u3060\u3055\u3044\n" +
        "  \u2192 Cloudflare \u306e\u8a8d\u8a3c\u60c5\u5831\u304c" +
        "\u8a2d\u5b9a\u3055\u308c\u3066\u3044\u308b\u304b" +
        "\u78ba\u8a8d\u3057\u3066\u304f\u3060\u3055\u3044",
    );
    process.exit(1);
  }
}

function dbMigrate() {
  assertD1Configured();
  assertDrizzleInstalled();
  console.log(
    "[Rain] \u30de\u30a4\u30b0\u30ec\u30fc\u30b7\u30e7\u30f3\u3092" +
      "\u5b9f\u884c\u4e2d...\n",
  );
  const status = runCommand("npx", ["drizzle-kit", "migrate"]);
  if (status !== 0) {
    console.error(
      "\n[Rain] Error: \u30de\u30a4\u30b0\u30ec\u30fc\u30b7\u30e7\u30f3" +
        "\u306e\u5b9f\u884c\u306b\u5931\u6557\u3057\u307e\u3057\u305f\u3002\n" +
        "  \u2192 drizzle/ \u30d5\u30a9\u30eb\u30c0\u306b" +
        "\u30de\u30a4\u30b0\u30ec\u30fc\u30b7\u30e7\u30f3" +
        "\u30d5\u30a1\u30a4\u30eb\u304c\u3042\u308b\u304b" +
        "\u78ba\u8a8d\u3057\u3066\u304f\u3060\u3055\u3044\n" +
        "  \u2192 \u307e\u305a npx rainjs db generate " +
        "\u3092\u5b9f\u884c\u3057\u3066\u304f\u3060\u3055\u3044",
    );
    process.exit(1);
  }
}

function dbApplyLocal() {
  const d1Bindings = assertD1Configured();
  const dbName = d1Bindings[0].database_name;

  if (!dbName) {
    console.error(
      "[Rain] Error: database_name \u304c wrangler.toml " +
        "\u306b\u898b\u3064\u304b\u308a\u307e\u305b\u3093\u3002\n" +
        "  \u2192 [[d1_databases]] \u30bb\u30af\u30b7\u30e7\u30f3\u306b " +
        'database_name = "my-db" \u3092\u8ffd\u52a0' +
        "\u3057\u3066\u304f\u3060\u3055\u3044",
    );
    process.exit(1);
  }

  if (!SAFE_NAME_RE.test(dbName)) {
    console.error(
      "[Rain] Error: database_name \u306b\u4e0d\u6b63\u306a" +
        "\u6587\u5b57\u304c\u542b\u307e\u308c\u3066\u3044\u307e\u3059: " +
        dbName + "\n" +
        "  \u2192 \u82f1\u6570\u5b57\u30fb\u30cf\u30a4\u30d5\u30f3\u30fb" +
        "\u30a2\u30f3\u30c0\u30fc\u30b9\u30b3\u30a2\u306e\u307f" +
        "\u4f7f\u7528\u3067\u304d\u307e\u3059",
    );
    process.exit(1);
  }

  if (!fs.existsSync(DRIZZLE_DIR)) {
    console.error(
      "[Rain] Error: drizzle/ \u30d5\u30a9\u30eb\u30c0\u304c" +
        "\u898b\u3064\u304b\u308a\u307e\u305b\u3093\u3002\n" +
        "  \u2192 \u307e\u305a npx rainjs db generate " +
        "\u3092\u5b9f\u884c\u3057\u3066\u304f\u3060\u3055\u3044",
    );
    process.exit(1);
  }

  const sqlFiles = fs
    .readdirSync(DRIZZLE_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  if (sqlFiles.length === 0) {
    console.log(
      "[Rain] drizzle/ \u306b SQL \u30d5\u30a1\u30a4\u30eb\u304c" +
        "\u898b\u3064\u304b\u308a\u307e\u305b\u3093\u3002\n" +
        "  \u2192 npx rainjs db generate " +
        "\u3067\u30de\u30a4\u30b0\u30ec\u30fc\u30b7\u30e7\u30f3\u3092" +
        "\u751f\u6210\u3057\u3066\u304f\u3060\u3055\u3044",
    );
    process.exit(0);
  }

  console.log(
    `[Rain] Local D1 "${dbName}" ` +
      "\u306b\u30de\u30a4\u30b0\u30ec\u30fc\u30b7\u30e7\u30f3\u3092" +
      "\u9069\u7528\u4e2d...\n",
  );

  let applied = 0;
  let skipped = 0;

  for (const file of sqlFiles) {
    if (!SAFE_NAME_RE.test(file)) {
      console.error(
        "[Rain] Error: \u4e0d\u6b63\u306a" +
          "\u30d5\u30a1\u30a4\u30eb\u540d: " +
          file + "\n" +
          "  \u2192 \u30d5\u30a1\u30a4\u30eb\u540d\u306b\u306f" +
          "\u82f1\u6570\u5b57\u30fb\u30cf\u30a4\u30d5\u30f3\u30fb" +
          "\u30a2\u30f3\u30c0\u30fc\u30b9\u30b3\u30a2\u30fb" +
          "\u30c9\u30c3\u30c8\u306e\u307f\u4f7f\u7528\u3067\u304d\u307e\u3059",
      );
      process.exit(1);
    }
    const filePath = path.join("drizzle", file);
    console.log(`  \u2192 ${file}`);
    const status = runCommand(
      "npx",
      [
        "wrangler",
        "d1",
        "execute",
        dbName,
        "--local",
        `--file=${filePath}`,
      ],
      { stdio: "pipe" },
    );
    if (status === 0) {
      applied++;
    } else {
      skipped++;
      console.log(
        `     \u26a0 ${file} ` +
          "\u306e\u9069\u7528\u3092\u30b9\u30ad\u30c3\u30d7" +
          "\uff08\u65e2\u306b\u9069\u7528\u6e08\u307f" +
          "\u306e\u53ef\u80fd\u6027\uff09",
      );
    }
  }

  console.log(
    `\n[Rain] \u5b8c\u4e86: ${applied} \u4ef6\u9069\u7528` +
      (skipped > 0
        ? `, ${skipped} \u4ef6\u30b9\u30ad\u30c3\u30d7`
        : ""),
  );
}

function dbSeed(options = {}) {
  const d1Bindings = assertD1Configured();
  const dbName = d1Bindings[0].database_name;

  if (!dbName) {
    console.error(
      "[Rain] Error: database_name \u304c wrangler.toml " +
        "\u306b\u898b\u3064\u304b\u308a\u307e\u305b\u3093\u3002\n" +
        "  \u2192 [[d1_databases]] \u30bb\u30af\u30b7\u30e7\u30f3\u306b " +
        'database_name = "my-db" \u3092\u8ffd\u52a0' +
        "\u3057\u3066\u304f\u3060\u3055\u3044",
    );
    process.exit(1);
  }

  if (!SAFE_NAME_RE.test(dbName)) {
    console.error(
      "[Rain] Error: database_name \u306b\u4e0d\u6b63\u306a" +
        "\u6587\u5b57\u304c\u542b\u307e\u308c\u3066\u3044\u307e\u3059: " +
        dbName + "\n" +
        "  \u2192 \u82f1\u6570\u5b57\u30fb\u30cf\u30a4\u30d5\u30f3\u30fb" +
        "\u30a2\u30f3\u30c0\u30fc\u30b9\u30b3\u30a2\u306e\u307f" +
        "\u4f7f\u7528\u3067\u304d\u307e\u3059",
    );
    process.exit(1);
  }

  if (!fs.existsSync(SEED_FILE)) {
    console.error(
      "[Rain] Error: src/db/seed.sql \u304c" +
        "\u898b\u3064\u304b\u308a\u307e\u305b\u3093\u3002\n" +
        "  \u2192 npx rainjs db init \u3067" +
        "\u30b7\u30fc\u30c9\u30d5\u30a1\u30a4\u30eb\u3092" +
        "\u751f\u6210\u3057\u3066\u304f\u3060\u3055\u3044\n" +
        "  \u2192 \u307e\u305f\u306f\u624b\u52d5\u3067 " +
        "src/db/seed.sql \u3092" +
        "\u4f5c\u6210\u3057\u3066\u304f\u3060\u3055\u3044",
    );
    process.exit(1);
  }

  const target = options.remote
    ? "\u30ea\u30e2\u30fc\u30c8"
    : "\u30ed\u30fc\u30ab\u30eb";
  console.log(
    `[Rain] ${target} D1 "${dbName}" \u306b` +
      "\u30b7\u30fc\u30c9\u30c7\u30fc\u30bf\u3092" +
      "\u6295\u5165\u4e2d...\n",
  );

  const seedPath = path.join("src", "db", "seed.sql");
  const args = [
    "wrangler",
    "d1",
    "execute",
    dbName,
    ...(options.remote ? [] : ["--local"]),
    `--file=${seedPath}`,
  ];

  const status = runCommand("npx", args);
  if (status !== 0) {
    console.error(
      "\n[Rain] Error: \u30b7\u30fc\u30c9\u30c7\u30fc\u30bf\u306e" +
        "\u6295\u5165\u306b\u5931\u6557\u3057\u307e\u3057\u305f\u3002\n" +
        "  \u2192 src/db/seed.sql \u306e SQL \u3092" +
        "\u78ba\u8a8d\u3057\u3066\u304f\u3060\u3055\u3044\n" +
        "  \u2192 \u30c6\u30fc\u30d6\u30eb\u304c\u5b58\u5728\u3059\u308b\u304b" +
        "\u78ba\u8a8d: npx rainjs db apply-local",
    );
    process.exit(1);
  }

  console.log(
    "\n[Rain] \u30b7\u30fc\u30c9\u30c7\u30fc\u30bf\u306e\u6295\u5165\u304c" +
      "\u5b8c\u4e86\u3057\u307e\u3057\u305f\u3002",
  );
}

function dbStudio() {
  assertD1Configured();
  assertDrizzleInstalled();
  console.log(
    "[Rain] Drizzle Studio " +
      "\u3092\u8d77\u52d5\u4e2d...\n",
  );
  runCommand("npx", ["drizzle-kit", "studio"]);
}

function handleDbCommand(subcommand, options = {}) {
  if (
    !subcommand ||
    subcommand === "--help" ||
    subcommand === "-h"
  ) {
    printDbHelp();
    process.exit(0);
  }

  if (!DB_SUBCOMMANDS.includes(subcommand)) {
    console.error(
      `[Rain] Error: Unknown db subcommand ` +
        `"${stripControlChars(subcommand)}".\n` +
        "  \u2192 Available subcommands: " +
        `${DB_SUBCOMMANDS.join(", ")}\n` +
        '  \u2192 Run "rainjs db --help" ' +
        "for usage information.",
    );
    process.exit(1);
  }

  switch (subcommand) {
    case "init":
      dbInit();
      break;
    case "generate":
      dbGenerate();
      break;
    case "push":
      dbPush();
      break;
    case "migrate":
      dbMigrate();
      break;
    case "apply-local":
      dbApplyLocal();
      break;
    case "seed":
      dbSeed(options);
      break;
    case "studio":
      dbStudio();
      break;
  }
}

module.exports = { handleDbCommand };
