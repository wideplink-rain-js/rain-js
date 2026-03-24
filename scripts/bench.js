const { buildSync } = require("esbuild");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const {
  generate,
  detectExportedMethodsFromContent,
  detectMiddlewareExportFromContent,
} = require("./generate");

const FRAMEWORK_PATH = path.join(
  __dirname,
  "..",
  "src",
  "framework",
  "index.ts",
);

function loadFramework() {
  const result = buildSync({
    entryPoints: [FRAMEWORK_PATH],
    bundle: true,
    write: false,
    format: "cjs",
    platform: "browser",
    target: "esnext",
    external: ["node:async_hooks"],
  });
  const code = result.outputFiles[0].text;
  const mod = { exports: {} };
  const fn = new Function("module", "exports", "require", code);
  fn(mod, mod.exports, require);
  return mod.exports;
}

function createDummyHandler() {
  return (_ctx) => new Response("ok");
}

function generateRoutes(app, count) {
  for (let i = 0; i < count; i++) {
    app.get(`/route${i}/path`, createDummyHandler());
  }
}

function generateDynamicRoutes(app, count, paramCount) {
  for (let i = 0; i < count; i++) {
    const segments = Array.from(
      { length: paramCount },
      (_, j) => `:p${j}`,
    ).join("/");
    app.get(`/dyn${i}/${segments}`, createDummyHandler());
  }
}

function createRequest(urlPath) {
  return new Request(`http://localhost${urlPath}`);
}

async function bench(label, fn, iterations = 10000) {
  await fn();
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    await fn();
  }
  const elapsed = performance.now() - start;
  const perOp = (elapsed / iterations).toFixed(4);
  return { label, iterations, totalMs: elapsed.toFixed(2), perOpMs: perOp };
}

function benchRouteRegistration(RainClass, routeCount) {
  return bench(
    `${routeCount} ルート登録`,
    () => {
      const app = new RainClass();
      generateRoutes(app, routeCount);
    },
    1000,
  );
}

function benchStaticRouting(RainClass, routeCount) {
  const app = new RainClass();
  generateRoutes(app, routeCount);
  const req = createRequest(`/route${routeCount - 1}/path`);
  return bench(
    `静的マッチ (最悪, ${routeCount} ルート)`,
    async () => await app.fetch(req),
  );
}

function benchDynamicRouting(RainClass, routeCount, paramCount) {
  const app = new RainClass();
  generateDynamicRoutes(app, routeCount, paramCount);
  const segments = Array.from({ length: paramCount }, (_, j) => `v${j}`).join(
    "/",
  );
  const req = createRequest(`/dyn${routeCount - 1}/${segments}`);
  return bench(
    `動的マッチ (${paramCount} パラメータ, ${routeCount} ルート)`,
    async () => await app.fetch(req),
  );
}

function benchNotFound(RainClass, routeCount) {
  const app = new RainClass();
  generateRoutes(app, routeCount);
  const req = createRequest("/nonexistent/path");
  return bench(
    `404 ミス (${routeCount} ルート)`,
    async () => await app.fetch(req),
  );
}

function benchCreateElement(createElement, Fragment) {
  const simpleEl = () => createElement("div", { className: "box" }, "hello");
  const nestedEl = () =>
    createElement(
      "div",
      { id: "root" },
      createElement("h1", null, "title"),
      createElement("p", { className: "text" }, "body"),
      createElement(
        "ul",
        null,
        ...Array.from({ length: 10 }, (_, i) =>
          createElement("li", { key: String(i) }, `item ${i}`),
        ),
      ),
    );
  const fragmentEl = () =>
    createElement(
      Fragment,
      null,
      createElement("span", null, "a"),
      createElement("span", null, "b"),
      createElement("span", null, "c"),
    );

  return {
    simple: () => bench("createElement (単純)", simpleEl),
    nested: () => bench("createElement (ネスト)", nestedEl),
    fragment: () => bench("createElement (Fragment)", fragmentEl),
  };
}

function benchRenderToString(createElement, _Fragment, renderToString) {
  const simpleTree = createElement("div", { className: "box" }, "hello");
  const deepTree = Array.from({ length: 20 }).reduce(
    (child) => createElement("div", null, child),
    createElement("span", null, "leaf"),
  );
  const wideTree = createElement(
    "table",
    null,
    createElement(
      "tbody",
      null,
      ...Array.from({ length: 50 }, (_, i) =>
        createElement(
          "tr",
          null,
          createElement("td", null, `cell-${i}-0`),
          createElement("td", null, `cell-${i}-1`),
          createElement("td", null, `cell-${i}-2`),
        ),
      ),
    ),
  );
  const Component = (props) =>
    createElement(
      "div",
      { className: "component" },
      createElement("h2", null, props.title),
      createElement("p", null, props.children),
    );
  const componentTree = createElement(Component, { title: "Hello" }, "world");

  return {
    simple: () =>
      bench("renderToString (単純)", () => renderToString(simpleTree)),
    deep: () =>
      bench("renderToString (深いネスト, 20層)", () =>
        renderToString(deepTree),
      ),
    wide: () =>
      bench("renderToString (50行テーブル)", () => renderToString(wideTree)),
    component: () =>
      bench("renderToString (コンポーネント)", () =>
        renderToString(componentTree),
      ),
  };
}

function benchEscapeHtml(escapeHtml) {
  const noEscape = "Hello World 1234567890 abcdefg";
  const lightEscape = 'Hello <b>World</b> & "Rain.js"';
  const heavyEscape =
    '<script>alert("xss")</script>&<div class="a">\'test\'</div>';

  return {
    none: () =>
      bench("escapeHtml (エスケープなし)", () => escapeHtml(noEscape)),
    light: () => bench("escapeHtml (軽度)", () => escapeHtml(lightEscape)),
    heavy: () => bench("escapeHtml (重度)", () => escapeHtml(heavyEscape)),
  };
}

function withSilentConsole(fn) {
  const origLog = console.log;
  const origWarn = console.warn;
  console.log = () => {};
  console.warn = () => {};
  try {
    return fn();
  } finally {
    console.log = origLog;
    console.warn = origWarn;
  }
}

function benchBuild() {
  return bench("ビルド (generate)", () => withSilentConsole(generate), 100);
}

function benchDetectExportedMethods() {
  const simple =
    'export const GET: Handler = (ctx) => new Response("ok");';
  const multi =
    'export const GET: Handler = (ctx) => new Response("ok");\n' +
    'export const POST: Handler = (ctx) => new Response("ok");\n' +
    'export const PUT: Handler = (ctx) => new Response("ok");\n' +
    'export const DELETE: Handler = (ctx) => new Response("ok");\n' +
    'export const PATCH: Handler = (ctx) => new Response("ok");';
  const reExport =
    'const GET = () => new Response("");\n' +
    'const POST = () => new Response("");\n' +
    "export { GET, POST };";

  return {
    simple: () =>
      bench("AST メソッド検出 (単一)", () =>
        detectExportedMethodsFromContent(simple),
      ),
    multi: () =>
      bench("AST メソッド検出 (5メソッド)", () =>
        detectExportedMethodsFromContent(multi),
      ),
    reExport: () =>
      bench("AST メソッド検出 (re-export)", () =>
        detectExportedMethodsFromContent(reExport),
      ),
  };
}

function benchDetectMiddlewareExport() {
  const content =
    "export const onRequest: Middleware = " +
    "async (ctx, next) => { return await next(); };";
  return () =>
    bench("AST ミドルウェア検出", () =>
      detectMiddlewareExportFromContent(content),
    );
}

function benchBundleSize() {
  const result = buildSync({
    entryPoints: [FRAMEWORK_PATH],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "esnext",
    minify: true,
    external: ["node:async_hooks"],
  });
  const minified = result.outputFiles[0].text;
  const { gzipSync } = require("node:zlib");
  const gzipped = gzipSync(Buffer.from(minified));
  return {
    raw: `${minified.length} バイト`,
    gzip: `${gzipped.length} バイト`,
  };
}

function getDisplayWidth(str) {
  let width = 0;
  for (const ch of str) {
    const code = ch.codePointAt(0);
    if (
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe10 && code <= 0xfe6f) ||
      (code >= 0xff01 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x20000 && code <= 0x2fffd) ||
      (code >= 0x30000 && code <= 0x3fffd)
    ) {
      width += 2;
    } else {
      width += 1;
    }
  }
  return width;
}

function padEnd(str, width) {
  const diff = width - getDisplayWidth(str);
  return diff > 0 ? str + " ".repeat(diff) : str;
}

function printTable(results) {
  const labelWidth = Math.max(
    6,
    ...results.map((r) => getDisplayWidth(r.label)),
  );

  const header = [
    padEnd("テスト", labelWidth),
    "反復回数".padStart(10),
    "合計(ms)".padStart(10),
    "1回あたり(ms)".padStart(14),
  ].join("  ");

  const separator = "-".repeat(getDisplayWidth(header));

  console.log(header);
  console.log(separator);
  for (const r of results) {
    console.log(
      [
        padEnd(r.label, labelWidth),
        String(r.iterations).padStart(10),
        r.totalMs.padStart(10),
        r.perOpMs.padStart(14),
      ].join("  "),
    );
  }
}

async function main() {
  console.log("Rain.js パフォーマンスベンチマーク");
  console.log(`Node ${process.version} | ${process.platform} ${process.arch}`);
  console.log("=".repeat(60));

  const { Rain, createElement, Fragment, renderToString, escapeHtml } =
    loadFramework();

  console.log("\n## バンドルサイズ\n");
  const size = benchBundleSize();
  console.log(`  圧縮前: ${size.raw}`);
  console.log(`  gzip:   ${size.gzip}`);

  console.log("\n## ルート登録\n");
  const regResults = [
    await benchRouteRegistration(Rain, 10),
    await benchRouteRegistration(Rain, 50),
    await benchRouteRegistration(Rain, 100),
  ];
  printTable(regResults);

  console.log("\n## 静的ルートマッチング (最悪ケース: 末尾ルート)\n");
  const staticResults = [
    await benchStaticRouting(Rain, 10),
    await benchStaticRouting(Rain, 50),
    await benchStaticRouting(Rain, 100),
  ];
  printTable(staticResults);

  console.log("\n## 動的ルートマッチング\n");
  const dynResults = [
    await benchDynamicRouting(Rain, 50, 1),
    await benchDynamicRouting(Rain, 50, 3),
    await benchDynamicRouting(Rain, 50, 5),
  ];
  printTable(dynResults);

  console.log("\n## 404 該当なし (全ルート走査)\n");
  const notFoundResults = [
    await benchNotFound(Rain, 10),
    await benchNotFound(Rain, 50),
    await benchNotFound(Rain, 100),
  ];
  printTable(notFoundResults);

  console.log("\n## JSX createElement\n");
  const createElBenches = benchCreateElement(createElement, Fragment);
  const createElResults = [
    await createElBenches.simple(),
    await createElBenches.nested(),
    await createElBenches.fragment(),
  ];
  printTable(createElResults);

  console.log("\n## JSX renderToString\n");
  const renderBenches = benchRenderToString(
    createElement,
    Fragment,
    renderToString,
  );
  const renderResults = [
    await renderBenches.simple(),
    await renderBenches.deep(),
    await renderBenches.wide(),
    await renderBenches.component(),
  ];
  printTable(renderResults);

  console.log("\n## HTML エスケープ\n");
  const escapeBenches = benchEscapeHtml(escapeHtml);
  const escapeResults = [
    await escapeBenches.none(),
    await escapeBenches.light(),
    await escapeBenches.heavy(),
  ];
  printTable(escapeResults);

  console.log("\n## ビルド (generate)\n");
  const buildResults = [await benchBuild()];
  printTable(buildResults);

  console.log("\n## TypeScript AST パース\n");
  const astMethodBenches = benchDetectExportedMethods();
  const astMwBench = benchDetectMiddlewareExport();
  const astResults = [
    await astMethodBenches.simple(),
    await astMethodBenches.multi(),
    await astMethodBenches.reExport(),
    await astMwBench(),
  ];
  printTable(astResults);

  console.log(`\n${"=".repeat(60)}`);
  console.log("完了");
}

main().catch(console.error);
