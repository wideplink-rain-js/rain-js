const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");
const ts = require("typescript");
const { printBanner } = require("../cli/utils/banner");

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

function detectUseServerDirective(content) {
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
    firstStatement.expression.text === "use server"
  );
}

function hasUseServerInBody(body) {
  if (!body?.statements || body.statements.length === 0) return false;
  const first = body.statements[0];
  if (!first) return false;
  return (
    ts.isExpressionStatement(first) &&
    ts.isStringLiteral(first.expression) &&
    first.expression.text === "use server"
  );
}

function hasAsyncModifier(node) {
  const modifiers = ts.canHaveModifiers(node)
    ? ts.getModifiers(node)
    : undefined;
  return modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) ?? false;
}

function extractFromFunctionDecl(stmt, fileLevel) {
  if (!(ts.isFunctionDeclaration(stmt) && stmt.name)) return null;
  const isExported = hasExportKeyword(stmt);
  if (fileLevel && isExported) {
    return {
      name: stmt.name.text,
      isExported: true,
      isAsync: hasAsyncModifier(stmt),
    };
  }
  if (hasUseServerInBody(stmt.body)) {
    return {
      name: stmt.name.text,
      isExported,
      isAsync: hasAsyncModifier(stmt),
    };
  }
  return null;
}

function isServerFunctionInit(init) {
  return ts.isArrowFunction(init) || ts.isFunctionExpression(init);
}

function extractFromVariableStmt(stmt, fileLevel) {
  if (!ts.isVariableStatement(stmt)) return [];
  const stmtExported = hasExportKeyword(stmt);
  const results = [];
  for (const decl of stmt.declarationList.declarations) {
    if (!(decl.name && ts.isIdentifier(decl.name))) continue;
    const init = decl.initializer;
    if (!(init && isServerFunctionInit(init))) continue;

    const isServer = fileLevel
      ? stmtExported
      : ts.isBlock(init.body) && hasUseServerInBody(init.body);

    if (isServer) {
      results.push({
        name: decl.name.text,
        isExported: stmtExported,
        isAsync: hasAsyncModifier(init),
      });
    }
  }
  return results;
}

function extractServerFunctionsFromContent(content) {
  const sourceFile = ts.createSourceFile(
    "file.tsx",
    content,
    ts.ScriptTarget.Latest,
    true,
  );
  const fileLevel = detectUseServerDirective(content);
  const results = [];

  ts.forEachChild(sourceFile, (stmt) => {
    const funcResult = extractFromFunctionDecl(stmt, fileLevel);
    if (funcResult) results.push(funcResult);
    results.push(...extractFromVariableStmt(stmt, fileLevel));
  });

  return results;
}

const RESERVED_FILE_NAMES = new Set([
  "route.ts",
  "route.tsx",
  "page.ts",
  "page.tsx",
  "layout.ts",
  "layout.tsx",
  "_middleware.ts",
]);

function isServerActionFile(fullPath, name) {
  if (name.startsWith("_type-test")) return false;
  if (RESERVED_FILE_NAMES.has(name)) return false;
  const content = fs.readFileSync(fullPath, "utf-8");
  if (!content.includes("use server")) return false;
  const functions = extractServerFunctionsFromContent(content);
  return functions.some((f) => f.isExported);
}

function getServerActionFiles(dir, base = "") {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.join(base, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".rainjs") continue;
      files.push(...getServerActionFiles(fullPath, relativePath));
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      if (isServerActionFile(fullPath, entry.name)) {
        files.push(relativePath);
      }
    }
  }

  return files;
}

function generateActionId(filePath, functionName) {
  const input = `${filePath.replace(/\\/g, "/")}:${functionName}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function serverActionImportName(filePath) {
  return (
    "sa_" +
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

function ensureRelativeImport(importPath) {
  return importPath.startsWith(".") ? importPath : `./${importPath}`;
}

function buildIslandImportLines(index, file, srcDir, entryDir) {
  const fullPath = path.join(srcDir, file);
  const content = fs.readFileSync(fullPath, "utf-8");
  const { named, hasDefault } = detectAllExportsFromContent(content);
  const islandId = clientFileToIslandId(file);

  const importPath = path
    .relative(entryDir, path.join(srcDir, file.replace(/\.tsx?$/, "")))
    .replace(/\\/g, "/");
  const safeImport = ensureRelativeImport(importPath);

  const specifiers = [];
  if (hasDefault) specifiers.push(`default as _d${index}`);
  for (const name of named) specifiers.push(`${name} as _n${index}_${name}`);
  if (specifiers.length === 0) return [];

  const lines = [];
  lines.push(`import { ${specifiers.join(", ")} } from "${safeImport}";`);
  if (hasDefault) {
    lines.push(`registerIsland("${islandId}:default", _d${index});`);
  }
  for (const name of named) {
    lines.push(`registerIsland("${islandId}:${name}", _n${index}_${name});`);
  }
  return lines;
}

function resolveClientRuntimeImport(fwPkg) {
  if (fwPkg.startsWith(".") || fwPkg.startsWith("/")) {
    const entryDir = path.join(PROJECT_ROOT, BUILD_CONFIG.outDir);
    const runtimePath = path
      .relative(entryDir, path.join(PROJECT_ROOT, fwPkg, "client/runtime"))
      .replace(/\\/g, "/");
    return ensureRelativeImport(runtimePath);
  }
  return `${fwPkg}/client/runtime`;
}

function generateClientEntrySource(clientFiles, srcDir, fwPkg) {
  const entryDir = path.join(PROJECT_ROOT, BUILD_CONFIG.outDir);
  const runtimeImport = resolveClientRuntimeImport(fwPkg);

  const lines = [];
  lines.push(
    `import { registerIsland, startHydration } from "${runtimeImport}";`,
  );

  for (let i = 0; i < clientFiles.length; i++) {
    lines.push(...buildIslandImportLines(i, clientFiles[i], srcDir, entryDir));
  }

  lines.push("startHydration();");
  lines.push("");

  return lines.join("\n");
}

function buildClientEsbuildAliases(fwPkg) {
  if (fwPkg.startsWith(".") || fwPkg.startsWith("/")) {
    const clientDir = path.resolve(PROJECT_ROOT, fwPkg, "client");
    return {
      "@rainfw/core/jsx-runtime": path.join(clientDir, "jsx-runtime.ts"),
      "@rainfw/core/client/runtime": path.join(clientDir, "runtime.ts"),
      "@rainfw/core/client/jsx-runtime": path.join(clientDir, "jsx-runtime.ts"),
    };
  }
  return {};
}

function copyDirSync(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function copyPublicToStatic() {
  const publicDir = path.join(PROJECT_ROOT, "public");
  const staticDir = path.join(PROJECT_ROOT, BUILD_CONFIG.outDir, "static");
  if (!fs.existsSync(publicDir)) return;
  copyDirSync(publicDir, staticDir);
}

function bundleClientFilesSync(clientFiles, srcDir, fwPkg) {
  if (clientFiles.length === 0) return [];
  if (!esbuild) {
    console.warn(
      "[Rain] Warning: esbuild not found.\n" +
        "  → Install esbuild to enable client bundling: npm install -D esbuild\n" +
        "  → Client-side components will not be bundled.",
    );
    return [];
  }

  const staticDir = path.join(PROJECT_ROOT, BUILD_CONFIG.outDir, "static");
  const outDir = path.join(staticDir, "_rain");
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  for (const file of fs.readdirSync(outDir)) {
    if (file.startsWith("island-") || file.startsWith("rain-client-")) {
      fs.unlinkSync(path.join(outDir, file));
    }
  }

  const entrySource = generateClientEntrySource(clientFiles, srcDir, fwPkg);
  const entryDir = path.join(PROJECT_ROOT, BUILD_CONFIG.outDir);
  if (!fs.existsSync(entryDir)) {
    fs.mkdirSync(entryDir, { recursive: true });
  }
  const clientEntryPath = path.join(entryDir, "client-entry.ts");
  fs.writeFileSync(clientEntryPath, entrySource);

  const result = esbuild.buildSync({
    entryPoints: [clientEntryPath],
    outdir: outDir,
    bundle: true,
    minify: true,
    format: "esm",
    metafile: true,
    entryNames: "rain-client-[hash]",
    write: true,
    treeShaking: true,
    platform: "browser",
    target: ["es2022"],
    jsx: "automatic",
    jsxImportSource: "@rainfw/core",
    alias: buildClientEsbuildAliases(fwPkg),
    loader: { ".ts": "ts", ".tsx": "tsx" },
  });

  const scripts = [];
  for (const [outPath, meta] of Object.entries(result.metafile.outputs)) {
    if (meta.entryPoint) {
      const relPath = path.relative(staticDir, outPath);
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

function collectAllExportedNames(node) {
  if (ts.isVariableStatement(node)) {
    return node.declarationList.declarations
      .filter((d) => ts.isIdentifier(d.name))
      .map((d) => d.name.text);
  }
  if (
    (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) &&
    node.name
  ) {
    return [node.name.text];
  }
  return [];
}

function collectAllNamedExports(node) {
  if (
    !(
      ts.isExportDeclaration(node) &&
      node.exportClause &&
      ts.isNamedExports(node.exportClause)
    )
  ) {
    return [];
  }
  return node.exportClause.elements.map((el) => el.name.text);
}

function detectAllExportsFromContent(content) {
  const sourceFile = ts.createSourceFile(
    "file.tsx",
    content,
    ts.ScriptTarget.Latest,
    true,
  );
  const named = [];
  let hasDefault = false;

  ts.forEachChild(sourceFile, (node) => {
    if (ts.isExportAssignment(node) && !node.isExportEquals) {
      hasDefault = true;
      return;
    }
    if (hasExportKeyword(node)) {
      const modifiers = ts.canHaveModifiers(node)
        ? ts.getModifiers(node)
        : undefined;
      if (modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)) {
        hasDefault = true;
      } else {
        named.push(...collectAllExportedNames(node));
      }
    }
    named.push(...collectAllNamedExports(node));
  });

  return { named, hasDefault };
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

function processServerActions(
  serverActionFiles,
  srcDir,
  frameworkImport,
  imports,
  registrations,
) {
  if (serverActionFiles.length === 0) return;

  imports.push(`import { markAsServerAction } from "${frameworkImport}";`);

  for (const file of serverActionFiles) {
    const fullPath = path.join(srcDir, file);
    const content = fs.readFileSync(fullPath, "utf-8");
    const functions = extractServerFunctionsFromContent(content);
    const exportedFunctions = functions.filter((f) => f.isExported);

    if (exportedFunctions.length === 0) continue;

    const importName = serverActionImportName(file);
    const importPath = relativeImportPath(
      path.join(srcDir, file.replace(/\.tsx?$/, "")),
    );

    const importSpecifiers = exportedFunctions
      .map((f) => `${f.name} as ${importName}_${f.name}`)
      .join(", ");
    imports.push(`import { ${importSpecifiers} } from "${importPath}";`);

    const relFromRoot = path.join("src", file).replace(/\\/g, "/");

    for (const fn of exportedFunctions) {
      const actionId = generateActionId(relFromRoot, fn.name);
      registrations.push(
        `markAsServerAction("${actionId}", ${importName}_${fn.name});`,
      );
      registrations.push(
        `app.registerAction("${actionId}", ${importName}_${fn.name});`,
      );
    }
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
  const fwPkg = BUILD_CONFIG.frameworkPackage;
  const clientScripts = bundleClientFilesSync(clientFiles, srcDir, fwPkg);

  if (!fs.existsSync(ENTRY_FILE)) return;

  let content = fs.readFileSync(ENTRY_FILE, "utf-8");
  const hasConfig = fs.existsSync(CONFIG_FILE);
  const appInit = buildAppInitLine(clientScripts, hasConfig);
  content = content.replace(/^const app = new Rain\(.*\);$/m, appInit);

  const islandStart = "// [rain:islands:start]";
  const islandEnd = "// [rain:islands:end]";
  const startIdx = content.indexOf(islandStart);
  const endIdx = content.indexOf(islandEnd);
  if (startIdx !== -1 && endIdx !== -1) {
    const frameworkImport =
      fwPkg.startsWith(".") || fwPkg.startsWith("/")
        ? relativeImportPath(path.join(PROJECT_ROOT, fwPkg))
        : fwPkg;
    const newIslandLines = generateIslandMarkLines(
      clientFiles,
      srcDir,
      frameworkImport,
    );
    const newBlock =
      newIslandLines.length > 0
        ? `${islandStart}\n${newIslandLines.join("\n")}\n${islandEnd}`
        : `${islandStart}\n${islandEnd}`;
    content =
      content.slice(0, startIdx) +
      newBlock +
      content.slice(endIdx + islandEnd.length);
  }

  fs.writeFileSync(ENTRY_FILE, content);

  const clientMsg =
    clientFiles.length > 0 ? `${clientFiles.length} client` : "0 client";
  console.log(`[gen:client] ${clientMsg} -> .rainjs/entry.ts`);
}

function clientFileToIslandId(relPath) {
  return relPath
    .replace(/\\/g, "/")
    .replace(/\.tsx?$/, "")
    .replace(/[^a-zA-Z0-9_/]/g, "_");
}

function generateIslandMarkLines(clientFiles, srcDir, fwImport) {
  const entryDir = path.dirname(ENTRY_FILE);
  const lines = [];

  if (clientFiles.length === 0) return lines;

  lines.push(`import { markAsIsland } from "${fwImport}";`);

  for (let i = 0; i < clientFiles.length; i++) {
    const cf = clientFiles[i];
    const fullPath = path.join(srcDir, cf);
    const content = fs.readFileSync(fullPath, "utf-8");
    const { named, hasDefault } = detectAllExportsFromContent(content);
    const islandId = clientFileToIslandId(cf);

    const importPath = path
      .relative(entryDir, path.join(srcDir, cf.replace(/\.tsx?$/, "")))
      .replace(/\\/g, "/");
    const safeImport = ensureRelativeImport(importPath);

    const specifiers = [];
    if (hasDefault) specifiers.push(`default as _island${i}`);
    for (const name of named) specifiers.push(`${name} as _island${i}_${name}`);
    if (specifiers.length === 0) continue;

    lines.push(`import { ${specifiers.join(", ")} } from "${safeImport}";`);
    if (hasDefault) {
      lines.push(`markAsIsland("${islandId}:default", _island${i});`);
    }
    for (const name of named) {
      lines.push(`markAsIsland("${islandId}:${name}", _island${i}_${name});`);
    }
  }

  return lines;
}

function cleanupLegacyIslandArtifacts() {
  const islandDir = path.join(PROJECT_ROOT, BUILD_CONFIG.outDir, "islands");
  if (fs.existsSync(islandDir)) {
    fs.rmSync(islandDir, { recursive: true, force: true });
  }

  const wranglerPath = path.join(PROJECT_ROOT, "wrangler.toml");
  if (!fs.existsSync(wranglerPath)) return;

  let content = fs.readFileSync(wranglerPath, "utf-8");
  const markerStart = "# [rain:alias:start]";
  const markerEnd = "# [rain:alias:end]";
  const startIdx = content.indexOf(markerStart);
  const endIdx = content.indexOf(markerEnd);
  if (startIdx !== -1 && endIdx !== -1) {
    content =
      content.slice(0, startIdx).trimEnd() +
      "\n" +
      content.slice(endIdx + markerEnd.length).trimStart();
    fs.writeFileSync(wranglerPath, content);
  }
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
  const serverActionFiles = getServerActionFiles(srcDir);
  const clientFiles = getClientFiles(srcDir);
  const hasConfig = fs.existsSync(CONFIG_FILE);
  const fwPkg = BUILD_CONFIG.frameworkPackage;
  copyPublicToStatic();
  const clientScripts = bundleClientFilesSync(clientFiles, srcDir, fwPkg);
  const frameworkImport =
    fwPkg.startsWith(".") || fwPkg.startsWith("/")
      ? relativeImportPath(path.join(PROJECT_ROOT, fwPkg))
      : fwPkg;

  cleanupLegacyIslandArtifacts();
  const islandMarkLines = generateIslandMarkLines(
    clientFiles,
    srcDir,
    frameworkImport,
  );

  processServerActions(
    serverActionFiles,
    srcDir,
    frameworkImport,
    imports,
    registrations,
  );

  const headerImports = [`import { Rain } from "${frameworkImport}";`];
  if (hasConfig) {
    const configPath = relativeImportPath(
      path.join(PROJECT_ROOT, "rain.config"),
    );
    headerImports.push(`import config from "${configPath}";`);
  }

  const appInit = buildAppInitLine(clientScripts, hasConfig);

  const islandBlock =
    islandMarkLines.length > 0
      ? ["// [rain:islands:start]", ...islandMarkLines, "// [rain:islands:end]"]
      : ["// [rain:islands:start]", "// [rain:islands:end]"];

  const content = [
    ...headerImports,
    ...islandBlock,
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
  const actionMsg =
    serverActionFiles.length > 0 ? `, ${serverActionFiles.length} action` : "";
  console.log(
    `[gen] ${total} route(s) (${files.length} api, ${pageFiles.length} page, ${layoutFiles.length} layout${clientMsg}${actionMsg}) -> .rainjs/entry.ts`,
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
  getServerActionFiles,
  getMiddlewaresForRoute,
  getLayoutsForPage,
  filePathToUrlPath,
  filePathToImportName,
  pageFilePathToUrlPath,
  pageFilePathToImportName,
  middlewareImportName,
  layoutImportName,
  serverActionImportName,
  detectExportedMethods,
  detectExportedMethodsFromContent,
  detectMiddlewareExport,
  detectMiddlewareExportFromContent,
  detectDefaultExport,
  detectDefaultExportFromContent,
  detectUseClientDirective,
  detectUseServerDirective,
  detectAllExportsFromContent,
  extractServerFunctionsFromContent,
  generateActionId,
  generateIslandMarkLines,
  cleanupLegacyIslandArtifacts,
  clientFileToIslandId,
  bundleClientFilesSync,
  generateClientEntrySource,
  copyPublicToStatic,
  validateNoPageRouteColocation,
  validateNoDuplicateUrls,
  stripRouteGroupSegments,
  ROUTES_DIR,
  ENTRY_FILE,
  HTTP_METHODS,
};

if (require.main === module) {
  printBanner();
  generate();
}
