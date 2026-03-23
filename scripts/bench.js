const { buildSync } = require("esbuild");
const path = require("node:path");
const { performance } = require("node:perf_hooks");

const FRAMEWORK_PATH = path.join(__dirname, "..", "src", "framework", "index.ts");

function loadFramework() {
  const result = buildSync({
    entryPoints: [FRAMEWORK_PATH],
    bundle: true,
    write: false,
    format: "cjs",
    platform: "browser",
    target: "esnext",
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

function benchBundleSize() {
  const result = buildSync({
    entryPoints: [FRAMEWORK_PATH],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "esnext",
    minify: true,
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

  const { Rain } = loadFramework();

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

  console.log(`\n${"=".repeat(60)}`);
  console.log("完了");
}

main().catch(console.error);
