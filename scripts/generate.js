const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");
const ts = require("typescript");

let esbuild;
try {
  esbuild = require("esbuild");
} catch (_esbuildOptional) {
  esbuild = null;
}

const PROJECT_ROOT = process.cwd();

function unwrapExpression(node) {
  if (ts.isSatisfiesExpression(node)) return node.expression;
  if (ts.isAsExpression(node)) return node.expression;
  if (ts.isParenthesizedExpression(node)) return node.expression;
  return node;
}

function extractStringProps(obj, sourceFile, keys) {
  const result = {};
  for (const prop of obj.properties) {
    if (
      !(ts.isPropertyAssignment(prop) && ts.isStringLiteral(prop.initializer))
    )
      continue;
    const name = prop.name.getText(sourceFile);
    if (keys.includes(name)) result[name] = prop.initializer.text;
  }
  return result;
}

function loadBuildConfig() {
  const configPath = path.join(PROJECT_ROOT, "rain.config.ts");
  const defaults = {
    routesDir: "src/routes",
    outDir: ".rainjs",
    frameworkPackage: "@rainfw/core",
  };
  if (!fs.existsSync(configPath)) return defaults;

  const content = fs.readFileSync(configPath, "utf-8");
  const sourceFile = ts.createSourceFile(
    "rain.config.ts",
    content,
    ts.ScriptTarget.Latest,
    true,
  );

  const config = { ...defaults };

  ts.forEachChild(sourceFile, (node) => {
    if (!ts.isExportAssignment(node)) return;
    const obj = unwrapExpression(node.expression);
    if (!ts.isObjectLiteralExpression(obj)) return;
    Object.assign(
      config,
      extractStringProps(obj, sourceFile, [
        "routesDir",
        "outDir",
        "frameworkPackage",
      ]),
    );
  });

  return config;
}

const BUILD_CONFIG = loadBuildConfig();
const ROUTES_DIR = path.join(PROJECT_ROOT, BUILD_CONFIG.routesDir);
const ENTRY_FILE = path.join(PROJECT_ROOT, BUILD_CONFIG.outDir, "entry.ts");
const CONFIG_FILE = path.join(PROJECT_ROOT, "rain.config.ts");

function relativeImportPath(targetPath) {
  const entryDir = path.dirname(ENTRY_FILE);
  let rel = path.relative(entryDir, targetPath).replace(/\\/g, "/");
  if (!rel.startsWith(".")) rel = `./${rel}`;
  return rel;
}

const HTTP_METHODS = [
  "GET",
  "POST",
  "PUT",
  "DELETE",
  "PATCH",
  "HEAD",
  "OPTIONS",
];

function getRouteFiles(dir, base = "") {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.join(base, entry.name);

    if (entry.isDirectory()) {
      files.push(...getRouteFiles(fullPath, relativePath));
    } else if (entry.name === "route.ts" || entry.name === "route.tsx") {
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

function getPageFiles(dir, base = "") {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.join(base, entry.name);

    if (entry.isDirectory()) {
      files.push(...getPageFiles(fullPath, relativePath));
    } else if (entry.name === "page.ts" || entry.name === "page.tsx") {
      files.push(relativePath);
    }
  }

  return files;
}

function getLayoutFiles(dir, base = "") {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.join(base, entry.name);

    if (entry.isDirectory()) {
      files.push(...getLayoutFiles(fullPath, relativePath));
    } else if (entry.name === "layout.ts" || entry.name === "layout.tsx") {
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

function detectUseClientDirective(content) {
  const sourceFile = ts.createSourceFile(
    "file.tsx",
    content,
    ts.ScriptTarget.Latest,
    true,
  );
  const firstStatement = sourceFile.statements[0];
  if (!firstStatement) return false;
  return (
    ts.isExpressionStatement(firstStatement) &&
    ts.isStringLiteral(firstStatement.expression) &&
    firstStatement.expression.text === "use client"
  );
}

function getClientFiles(dir, base = "") {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.join(base, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".rainjs") continue;
      files.push(...getClientFiles(fullPath, relativePath));
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      const content = fs.readFileSync(fullPath, "utf-8");
      if (detectUseClientDirective(content)) {
        files.push(relativePath);
      }
    }
  }

  return files;
}

function bundleClientFilesSync(clientFiles, srcDir) {
  if (clientFiles.length === 0) return [];
  if (!esbuild) {
    console.warn(
      "[Rain] Warning: esbuild not found.\n" +
        "  → Install esbuild to enable client bundling: npm install -D esbuild\n" +
        "  → Client-side components will not be bundled.",
    );
    return [];
  }

  const outDir = path.join(PROJECT_ROOT, "public", "_rain");
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  for (const file of fs.readdirSync(outDir)) {
    if (file.startsWith("island-")) {
      fs.unlinkSync(path.join(outDir, file));
    }
  }

  const entryPoints = clientFiles.map((f) => path.join(srcDir, f));

  const result = esbuild.buildSync({
    entryPoints,
    outdir: outDir,
    bundle: true,
    minify: true,
    format: "esm",
    metafile: true,
    entryNames: "island-[hash]",
    write: true,
    treeShaking: true,
    platform: "browser",
    target: ["es2022"],
    jsx: "automatic",
    jsxImportSource: "@rainfw/core",
    alias: {
      "@rainfw/core/jsx-runtime": path.resolve(
        PROJECT_ROOT,
        "src/framework/client/jsx-runtime.ts",
      ),
    },
    loader: { ".ts": "ts", ".tsx": "tsx" },
  });

  const publicDir = path.join(PROJECT_ROOT, "public");
  const scripts = [];
  for (const [outPath, meta] of Object.entries(result.metafile.outputs)) {
    if (meta.entryPoint) {
      const relPath = path.relative(publicDir, outPath);
      scripts.push(`/${relPath.replace(/\\/g, "/")}`);
    }
  }

  return scripts;
}

function stripRouteGroupSegments(filePath) {
  return filePath
    .split("/")
    .filter((segment) => !/^\(.+\)$/.test(segment))
    .join("/");
}

function routePathToDir(filePath) {
  return filePath
    .replace(/\\/g, "/")
    .replace(/route\.tsx?$/, "")
    .replace(/\/$/, "");
}

function middlewareImportName(filePath) {
  const base = filePath
    .replace(/_middleware\.ts$/, "")
    .replace(/\\/g, "_")
    .replace(/\//g, "_")
    .replace(/\[/g, "$")
    .replace(/\]/g, "")
    .replace(/[()]/g, "")
    .replace(/-/g, "_")
    .replace(/_+$/, "");
  return `mw_${base || "root"}`;
}

function pageFilePathToDir(filePath) {
  return filePath
    .replace(/\\/g, "/")
    .replace(/page\.tsx?$/, "")
    .replace(/\/$/, "");
}

function layoutPathToDir(filePath) {
  return filePath
    .replace(/\\/g, "/")
    .replace(/layout\.tsx?$/, "")
    .replace(/\/$/, "");
}

function pageFilePathToUrlPath(filePath) {
  let urlPath = filePath.replace(/\.tsx?$/, "");
  urlPath = urlPath.replace(/\\/g, "/");
  urlPath = stripRouteGroupSegments(urlPath);
  urlPath = urlPath.replace(/\[([^\]]+)\]/g, ":$1");
  urlPath = urlPath.replace(/\/page$/, "");
  if (urlPath === "page") urlPath = "";
  return `/${urlPath}`;
}

function pageFilePathToImportName(filePath) {
  return (
    "page_" +
    filePath
      .replace(/\.tsx?$/, "")
      .replace(/\\/g, "_")
      .replace(/\//g, "_")
      .replace(/\[/g, "$")
      .replace(/\]/g, "")
      .replace(/[()]/g, "")
      .replace(/-/g, "_")
  );
}

function layoutImportName(filePath) {
  const base = filePath
    .replace(/layout\.tsx?$/, "")
    .replace(/\\/g, "_")
    .replace(/\//g, "_")
    .replace(/\[/g, "$")
    .replace(/\]/g, "")
    .replace(/[()]/g, "")
    .replace(/-/g, "_")
    .replace(/_+$/, "");
  return `layout_${base || "root"}`;
}

function getLayoutsForPage(pageFile, layoutFiles) {
  const pageDir = pageFilePathToDir(pageFile);
  const applicable = [];

  for (const lf of layoutFiles) {
    const lfDir = layoutPathToDir(lf);
    if (lfDir === "" || pageDir === lfDir || pageDir.startsWith(`${lfDir}/`)) {
      applicable.push(lf);
    }
  }

  return applicable;
}

function detectDefaultExportFromContent(content) {
  const sourceFile = ts.createSourceFile(
    "page.tsx",
    content,
    ts.ScriptTarget.Latest,
    true,
  );
  let found = false;

  ts.forEachChild(sourceFile, (node) => {
    if (ts.isExportAssignment(node) && !node.isExportEquals) {
      found = true;
    }
    if (
      (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) &&
      hasExportKeyword(node)
    ) {
      const modifiers = ts.canHaveModifiers(node)
        ? ts.getModifiers(node)
        : undefined;
      if (modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)) {
        found = true;
      }
    }
  });

  return found;
}

function detectDefaultExport(filePath) {
  const content = fs.readFileSync(filePath, "utf-8");
  return detectDefaultExportFromContent(content);
}

function validateNoPageRouteColocation(routeFiles, pageFiles) {
  const routeDirs = new Set(routeFiles.map((f) => routePathToDir(f)));
  const errors = [];

  for (const pageFile of pageFiles) {
    const pageDir = pageFilePathToDir(pageFile);
    if (routeDirs.has(pageDir)) {
      const relDir = pageDir || "(root)";
      errors.push(
        `[Rain] Error: page and route files cannot coexist in the same directory: ${relDir}\n` +
          "  → Use page.tsx for pages (returns JSX) or route.ts for API endpoints (returns Response), not both.\n" +
          "  → Move one of them to a different directory.",
      );
    }
  }

  const routeUrlMap = new Map();
  for (const f of routeFiles) {
    routeUrlMap.set(filePathToUrlPath(f), f);
  }
  for (const pageFile of pageFiles) {
    const url = pageFilePathToUrlPath(pageFile);
    const conflicting = routeUrlMap.get(url);
    if (conflicting) {
      const pageDir = pageFilePathToDir(pageFile);
      if (!routeDirs.has(pageDir)) {
        errors.push(
          `[Rain] Error: page "${pageFile}" and route "${conflicting}" resolve to the same URL path "${url}":\n` +
            "  → This conflict occurs because route group folders are stripped from URLs.\n" +
            "  → Move one of them to a different URL path.",
        );
      }
    }
  }

  return errors;
}

function validateNoDuplicateUrls(routeFiles, pageFiles) {
  const errors = [];

  const routeUrlMap = new Map();
  for (const f of routeFiles) {
    const url = filePathToUrlPath(f);
    if (routeUrlMap.has(url)) {
      errors.push(
        `[Rain] Error: multiple route files resolve to the same URL path "${url}":\n` +
          `  → ${routeUrlMap.get(url)}\n` +
          `  → ${f}\n` +
          "  → Route group folders are stripped from URLs.\n" +
          "  → Rename one of the routes to avoid the conflict.",
      );
    } else {
      routeUrlMap.set(url, f);
    }
  }

  const pageUrlMap = new Map();
  for (const f of pageFiles) {
    const url = pageFilePathToUrlPath(f);
    if (pageUrlMap.has(url)) {
      errors.push(
        `[Rain] Error: multiple page files resolve to the same URL path "${url}":\n` +
          `  → ${pageUrlMap.get(url)}\n` +
          `  → ${f}\n` +
          "  → Route group folders are stripped from URLs.\n" +
          "  → Rename one of the pages to avoid the conflict.",
      );
    } else {
      pageUrlMap.set(url, f);
    }
  }

  return errors;
}

function getMiddlewaresForRoute(routeFile, middlewareFiles) {
  const isPage = /page\.tsx?$/.test(routeFile);
  const routeDir = isPage
    ? pageFilePathToDir(routeFile)
    : routePathToDir(routeFile);
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

  return applicable;
}

function filePathToUrlPath(filePath) {
  let urlPath = filePath.replace(/\.tsx?$/, "");
  urlPath = urlPath.replace(/\\/g, "/");
  urlPath = stripRouteGroupSegments(urlPath);
  urlPath = urlPath.replace(/\[([^\]]+)\]/g, ":$1");
  urlPath = urlPath.replace(/\/route$/, "");
  if (urlPath === "route") urlPath = "";
  return `/${urlPath}`;
}

function filePathToImportName(filePath) {
  return (
    "route_" +
    filePath
      .replace(/\.tsx?$/, "")
      .replace(/\\/g, "_")
      .replace(/\//g, "_")
      .replace(/\[/g, "$")
      .replace(/\]/g, "")
      .replace(/[()]/g, "")
      .replace(/-/g, "_")
  );
}

function hasExportKeyword(node) {
  const modifiers = ts.canHaveModifiers(node)
    ? ts.getModifiers(node)
    : undefined;
  return (
    modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false
  );
}

function collectFromExportedDeclaration(node, targets) {
  if (ts.isVariableStatement(node)) {
    return node.declarationList.declarations
      .filter((d) => ts.isIdentifier(d.name) && targets.has(d.name.text))
      .map((d) => d.name.text);
  }
  if (
    ts.isFunctionDeclaration(node) &&
    node.name &&
    targets.has(node.name.text)
  ) {
    return [node.name.text];
  }
  return [];
}

function collectFromNamedExports(node, targets) {
  if (
    !(
      ts.isExportDeclaration(node) &&
      node.exportClause &&
      ts.isNamedExports(node.exportClause)
    )
  ) {
    return [];
  }
  return node.exportClause.elements
    .filter((el) => targets.has(el.name.text))
    .map((el) => el.name.text);
}

function detectExportedNamesFromContent(content, targetNames) {
  const sourceFile = ts.createSourceFile(
    "route.ts",
    content,
    ts.ScriptTarget.Latest,
    true,
  );
  const targets = new Set(targetNames);
  const found = [];

  ts.forEachChild(sourceFile, (node) => {
    if (hasExportKeyword(node)) {
      found.push(...collectFromExportedDeclaration(node, targets));
    }
    found.push(...collectFromNamedExports(node, targets));
  });

  return found;
}

function detectExportedMethodsFromContent(content) {
  return detectExportedNamesFromContent(content, HTTP_METHODS);
}

function detectExportedMethods(filePath) {
  const content = fs.readFileSync(filePath, "utf-8");
  return detectExportedMethodsFromContent(content);
}

function detectMiddlewareExportFromContent(content) {
  return detectExportedNamesFromContent(content, ["onRequest"]).length > 0;
}

function detectMiddlewareExport(filePath) {
  const content = fs.readFileSync(filePath, "utf-8");
  return detectMiddlewareExportFromContent(content);
}

function processMiddlewares(middlewareFiles, imports) {
  for (const mwFile of middlewareFiles) {
    const fullMwPath = path.join(ROUTES_DIR, mwFile);
    const relMwPath = `${BUILD_CONFIG.routesDir}/${mwFile.replace(/\\/g, "/")}`;
    if (!detectMiddlewareExport(fullMwPath)) {
      console.error(
        `[Rain] No "onRequest" export found in ${relMwPath}. ` +
          'Middleware files must export "onRequest". Example:\n' +
          "  export const onRequest: Middleware = async (ctx, next) => { ... }",
      );
      continue;
    }
    const name = middlewareImportName(mwFile);
    const importPath = relativeImportPath(
      path.join(ROUTES_DIR, mwFile.replace(/\.tsx?$/, "")),
    );
    imports.push(`import { onRequest as ${name} } from "${importPath}";`);
  }
}

function processRoutes(files, middlewareFiles, imports, registrations) {
  for (const file of files) {
    const importName = filePathToImportName(file);
    const urlPath = filePathToUrlPath(file);
    const importPath = relativeImportPath(
      path.join(ROUTES_DIR, file.replace(/\.tsx?$/, "")),
    );
    const fullPath = path.join(ROUTES_DIR, file);

    const methods = detectExportedMethods(fullPath);
    if (methods.length === 0) {
      const relPath = `${BUILD_CONFIG.routesDir}/${file.replace(/\\/g, "/")}`;
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
}

function processLayouts(layoutFiles, imports) {
  for (const lf of layoutFiles) {
    const fullLfPath = path.join(ROUTES_DIR, lf);
    const relLfPath = `${BUILD_CONFIG.routesDir}/${lf.replace(/\\/g, "/")}`;
    if (!detectDefaultExport(fullLfPath)) {
      console.error(
        `[Rain] No default export found in ${relLfPath}. ` +
          "Layout files must use default export. Example:\n" +
          "  export default function RootLayout(ctx, children) { ... }",
      );
      continue;
    }
    const name = layoutImportName(lf);
    const importPath = relativeImportPath(
      path.join(ROUTES_DIR, lf.replace(/\.tsx?$/, "")),
    );
    imports.push(`import ${name} from "${importPath}";`);
  }
}

function processPages(
  pageFiles,
  layoutFiles,
  middlewareFiles,
  hasRootLayout,
  imports,
  registrations,
) {
  for (const pageFile of pageFiles) {
    const fullPagePath = path.join(ROUTES_DIR, pageFile);
    const relPagePath = `${BUILD_CONFIG.routesDir}/${pageFile.replace(/\\/g, "/")}`;
    if (!detectDefaultExport(fullPagePath)) {
      console.error(
        `[Rain] No default export found in ${relPagePath}. ` +
          "Page files must use default export. Example:\n" +
          "  export default function Page(ctx) { return <h1>Hello</h1>; }",
      );
      continue;
    }
    const importName = pageFilePathToImportName(pageFile);
    const urlPath = pageFilePathToUrlPath(pageFile);
    const importPath = relativeImportPath(
      path.join(ROUTES_DIR, pageFile.replace(/\.tsx?$/, "")),
    );
    imports.push(`import ${importName} from "${importPath}";`);

    const applicableLayouts = getLayoutsForPage(pageFile, layoutFiles);
    const layoutNames = applicableLayouts.map((f) => layoutImportName(f));
    const layoutArrayStr =
      layoutNames.length > 0 ? `[${layoutNames.join(", ")}]` : "[]";

    const applicableMw = getMiddlewaresForRoute(pageFile, middlewareFiles);
    const mwNames = applicableMw.map((mf) => middlewareImportName(mf));
    const mwArrayStr = mwNames.length > 0 ? `[${mwNames.join(", ")}]` : "[]";

    const doctype = hasRootLayout ? "true" : "false";

    registrations.push(
      `app.page("${urlPath}", ${importName}, ${layoutArrayStr}, ${mwArrayStr}, ${doctype});`,
    );
  }
}

function validateCompatibilityFlags() {
  const wranglerPath = path.join(PROJECT_ROOT, "wrangler.toml");
  if (!fs.existsSync(wranglerPath)) return;

  const content = fs.readFileSync(wranglerPath, "utf-8");
  const flagsMatch = content.match(/compatibility_flags\s*=\s*\[([^\]]*)\]/);
  const flags = flagsMatch
    ? (flagsMatch[1].match(/"([^"]+)"/g) || []).map((s) => s.replace(/"/g, ""))
    : [];

  if (!(flags.includes("nodejs_compat") || flags.includes("nodejs_als"))) {
    console.error(
      "[Rain] Error: Missing required compatibility flag.\n" +
        '  → Rain.js requires "nodejs_compat" in your wrangler.toml.\n' +
        "  → Add the following to your wrangler.toml:\n\n" +
        '    compatibility_flags = ["nodejs_compat"]\n\n' +
        "  → Without this flag, the Workers runtime will fail with:\n" +
        '    "No such module node:async_hooks"\n' +
        "  → See: https://developers.cloudflare.com/workers/" +
        "configuration/compatibility-flags/" +
        "#nodejs-compatibility-flag",
    );
    process.exit(1);
  }
}

function buildAppInitLine(clientScripts, hasConfig) {
  if (hasConfig) {
    return clientScripts.length > 0
      ? `const app = new Rain({ ...config, clientScripts: ${JSON.stringify(clientScripts)} });`
      : "const app = new Rain(config);";
  }
  return clientScripts.length > 0
    ? `const app = new Rain({ clientScripts: ${JSON.stringify(clientScripts)} });`
    : "const app = new Rain();";
}

function regenerateClient() {
  const srcDir = path.join(PROJECT_ROOT, "src");
  const clientFiles = getClientFiles(srcDir);
  const clientScripts = bundleClientFilesSync(clientFiles, srcDir);

  if (!fs.existsSync(ENTRY_FILE)) return;

  const content = fs.readFileSync(ENTRY_FILE, "utf-8");
  const hasConfig = fs.existsSync(CONFIG_FILE);
  const appInit = buildAppInitLine(clientScripts, hasConfig);
  const updated = content.replace(/^const app = new Rain\(.*\);$/m, appInit);
  if (updated !== content) {
    fs.writeFileSync(ENTRY_FILE, updated);
  }

  const clientMsg =
    clientFiles.length > 0 ? `${clientFiles.length} client` : "0 client";
  console.log(`[gen:client] ${clientMsg} -> .rainjs/entry.ts`);
}

function generate() {
  if (!fs.existsSync(ROUTES_DIR)) {
    console.error(
      "[Rain] Error: src/routes/ directory not found.\n" +
        `  → Current directory: ${PROJECT_ROOT}\n` +
        "  → Ensure you are running this command from a Rain.js project root.\n" +
        "  → Or create the directory: mkdir -p src/routes",
    );
    process.exit(1);
  }

  validateCompatibilityFlags();

  try {
    execSync("npx wrangler types", {
      cwd: PROJECT_ROOT,
      stdio: "pipe",
      timeout: 30_000,
    });
  } catch (_wranglerTypesOptional) {
    console.warn(
      "[Rain] Warning: wrangler types failed.\n" +
        '  → This is optional but recommended. Run "npx wrangler types" manually to debug.',
    );
  }

  const dir = path.dirname(ENTRY_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const files = getRouteFiles(ROUTES_DIR);
  const middlewareFiles = getMiddlewareFiles(ROUTES_DIR);
  const pageFiles = getPageFiles(ROUTES_DIR);
  const layoutFiles = getLayoutFiles(ROUTES_DIR);

  const depthSortComparator = (a, b) =>
    a.split(/[\\/]/).length - b.split(/[\\/]/).length;
  layoutFiles.sort(depthSortComparator);
  middlewareFiles.sort(depthSortComparator);
  const imports = [];
  const registrations = [];

  const colocationErrors = validateNoPageRouteColocation(files, pageFiles);
  for (const err of colocationErrors) {
    console.error(err);
    process.exit(1);
  }

  const duplicateErrors = validateNoDuplicateUrls(files, pageFiles);
  for (const err of duplicateErrors) {
    console.error(err);
    process.exit(1);
  }

  const hasRootLayout = layoutFiles.some((f) => layoutPathToDir(f) === "");

  processMiddlewares(middlewareFiles, imports);
  processRoutes(files, middlewareFiles, imports, registrations);
  processLayouts(layoutFiles, imports);
  processPages(
    pageFiles,
    layoutFiles,
    middlewareFiles,
    hasRootLayout,
    imports,
    registrations,
  );

  const srcDir = path.join(PROJECT_ROOT, "src");
  const clientFiles = getClientFiles(srcDir);
  const clientScripts = bundleClientFilesSync(clientFiles, srcDir);

  const hasConfig = fs.existsSync(CONFIG_FILE);
  const fwPkg = BUILD_CONFIG.frameworkPackage;
  const frameworkImport =
    fwPkg.startsWith(".") || fwPkg.startsWith("/")
      ? relativeImportPath(path.join(PROJECT_ROOT, fwPkg))
      : fwPkg;

  const headerImports = [`import { Rain } from "${frameworkImport}";`];
  if (hasConfig) {
    const configPath = relativeImportPath(
      path.join(PROJECT_ROOT, "rain.config"),
    );
    headerImports.push(`import config from "${configPath}";`);
  }

  const appInit = buildAppInitLine(clientScripts, hasConfig);

  const content = [
    ...headerImports,
    ...imports,
    "",
    appInit,
    "",
    ...registrations,
    "",
    "export default app;",
    "",
  ].join("\n");

  fs.writeFileSync(ENTRY_FILE, content);
  const total = files.length + pageFiles.length;
  const clientMsg =
    clientFiles.length > 0 ? `, ${clientFiles.length} client` : "";
  console.log(
    `[gen] ${total} route(s) (${files.length} api, ${pageFiles.length} page, ${layoutFiles.length} layout${clientMsg}) -> .rainjs/entry.ts`,
  );
}

module.exports = {
  generate,
  regenerateClient,
  loadBuildConfig,
  getRouteFiles,
  getMiddlewareFiles,
  getPageFiles,
  getLayoutFiles,
  getClientFiles,
  getMiddlewaresForRoute,
  getLayoutsForPage,
  filePathToUrlPath,
  filePathToImportName,
  pageFilePathToUrlPath,
  pageFilePathToImportName,
  middlewareImportName,
  layoutImportName,
  detectExportedMethods,
  detectExportedMethodsFromContent,
  detectMiddlewareExport,
  detectMiddlewareExportFromContent,
  detectDefaultExport,
  detectDefaultExportFromContent,
  detectUseClientDirective,
  bundleClientFilesSync,
  validateNoPageRouteColocation,
  validateNoDuplicateUrls,
  stripRouteGroupSegments,
  ROUTES_DIR,
  ENTRY_FILE,
  HTTP_METHODS,
};

if (require.main === module) {
  generate();
}
