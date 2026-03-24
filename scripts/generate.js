const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");
const ts = require("typescript");

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
  const defaults = { routesDir: "src/routes", outDir: ".rainjs" };
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
      extractStringProps(obj, sourceFile, ["routesDir", "outDir"]),
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

function middlewarePathToDir(filePath) {
  return filePath
    .replace(/\\/g, "/")
    .replace(/_middleware\.ts$/, "")
    .replace(/\/$/, "");
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
  let urlPath = filePath.replace(/\.tsx?$/, "");
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
      .replace(/\.tsx?$/, "")
      .replace(/\\/g, "_")
      .replace(/\//g, "_")
      .replace(/\[/g, "$")
      .replace(/\]/g, "")
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
  const imports = [];
  const registrations = [];

  const importedMiddlewares = new Set();
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
    importedMiddlewares.add(name);
  }

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

  const hasConfig = fs.existsSync(CONFIG_FILE);
  const frameworkPath = relativeImportPath(
    path.join(PROJECT_ROOT, "src", "framework"),
  );

  const headerImports = [`import { Rain } from "${frameworkPath}";`];
  if (hasConfig) {
    const configPath = relativeImportPath(
      path.join(PROJECT_ROOT, "rain.config"),
    );
    headerImports.push(`import config from "${configPath}";`);
  }

  const appInit = hasConfig
    ? "const app = new Rain(config);"
    : "const app = new Rain();";

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
  console.log(`[gen] ${files.length} route(s) -> .rainjs/entry.ts`);
}

module.exports = {
  generate,
  loadBuildConfig,
  getRouteFiles,
  getMiddlewareFiles,
  getMiddlewaresForRoute,
  filePathToUrlPath,
  filePathToImportName,
  middlewareImportName,
  detectExportedMethods,
  detectExportedMethodsFromContent,
  detectMiddlewareExport,
  detectMiddlewareExportFromContent,
  ROUTES_DIR,
  ENTRY_FILE,
  HTTP_METHODS,
};

if (require.main === module) {
  generate();
}
