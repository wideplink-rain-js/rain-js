const { buildSync } = require("esbuild");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const { printBanner } = require("../cli/utils/banner");

printBanner();
const {
  generate,
  detectExportedMethodsFromContent,
  detectMiddlewareExportFromContent,
  detectDefaultExportFromContent,
} = require("./generate");

const FRAMEWORK_PATH = path.join(
  __dirname,
  "..",
  "src",
  "framework",
  "index.ts",
);

const CLIENT_HOOKS_PATH = path.join(
  __dirname,
  "..",
  "src",
  "framework",
  "client",
  "hooks.ts",
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

function loadClientHooks() {
  const result = buildSync({
    entryPoints: [CLIENT_HOOKS_PATH],
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

function createDomMock() {
  class MockNode {
    constructor(type) {
      this.nodeType = type;
      this._children = [];
      this.parentNode = null;
      this.textContent = "";
    }
    get childNodes() {
      return this._children;
    }
    get lastChild() {
      return this._children[this._children.length - 1] ?? null;
    }
    appendChild(child) {
      if (child instanceof MockDocumentFragment) {
        for (const c of [...child._children]) {
          this.appendChild(c);
        }
        return child;
      }
      child.parentNode = this;
      this._children.push(child);
      return child;
    }
    removeChild(child) {
      const idx = this._children.indexOf(child);
      if (idx >= 0) this._children.splice(idx, 1);
      child.parentNode = null;
      return child;
    }
    replaceChild(newChild, oldChild) {
      const idx = this._children.indexOf(oldChild);
      if (idx >= 0) {
        this._children[idx] = newChild;
        newChild.parentNode = this;
        oldChild.parentNode = null;
      }
      return oldChild;
    }
    insertBefore(newChild, refChild) {
      if (!refChild) return this.appendChild(newChild);
      const idx = this._children.indexOf(refChild);
      if (idx >= 0) {
        this._children.splice(idx, 0, newChild);
        newChild.parentNode = this;
      }
      return newChild;
    }
  }

  MockNode.TEXT_NODE = 3;
  MockNode.ELEMENT_NODE = 1;

  class MockElement extends MockNode {
    constructor(tag) {
      super(1);
      this.tagName = tag.toUpperCase();
      this._attrs = {};
    }
    setAttribute(k, v) {
      this._attrs[k] = String(v);
    }
    removeAttribute(k) {
      delete this._attrs[k];
    }
    getAttribute(k) {
      return this._attrs[k] ?? null;
    }
    addEventListener() {}
    removeEventListener() {}
    querySelector() {
      return null;
    }
  }

  class MockHTMLElement extends MockElement {}
  class MockHTMLScriptElement extends MockElement {}

  class MockTextNode extends MockNode {
    constructor(text) {
      super(3);
      this.textContent = text;
    }
  }

  class MockDocumentFragment extends MockNode {
    constructor() {
      super(11);
    }
  }

  const mockDocument = {
    createElement(tag) {
      return new MockHTMLElement(tag);
    },
    createTextNode(text) {
      return new MockTextNode(text);
    },
    createDocumentFragment() {
      return new MockDocumentFragment();
    },
    createTreeWalker() {
      return {
        nextNode() {
          return null;
        },
      };
    },
    body: new MockHTMLElement("body"),
  };

  return {
    Node: MockNode,
    Element: MockElement,
    HTMLElement: MockHTMLElement,
    HTMLScriptElement: MockHTMLScriptElement,
    NodeFilter: { SHOW_COMMENT: 128 },
    document: mockDocument,
    DocumentFragment: MockDocumentFragment,
  };
}

function loadClientBundle() {
  const result = buildSync({
    stdin: {
      contents: [
        'export { setCurrentFiber, setScheduleUpdate, useState, useEffect, useRef, useMemo, useCallback, createContext, useContext, flushPendingEffects, cleanupFiberEffects } from "./src/framework/client/hooks";',
        'export { initScheduler, flushSync } from "./src/framework/client/scheduler";',
        'export { reconcile } from "./src/framework/client/reconciler";',
        'export { createDomNode } from "./src/framework/client/dom";',
        'export { createElement, Fragment } from "./src/framework/jsx/createElement";',
      ].join("\n"),
      resolveDir: path.join(__dirname, ".."),
    },
    bundle: true,
    write: false,
    format: "cjs",
    platform: "browser",
    target: "esnext",
  });
  return result.outputFiles[0].text;
}

function evalClientBundle(code) {
  const mock = createDomMock();
  const mod = { exports: {} };
  const fn = new Function(
    "module",
    "exports",
    "require",
    "document",
    "Node",
    "HTMLElement",
    "HTMLScriptElement",
    "Element",
    "NodeFilter",
    "DocumentFragment",
    code,
  );
  fn(
    mod,
    mod.exports,
    require,
    mock.document,
    mock.Node,
    mock.HTMLElement,
    mock.HTMLScriptElement,
    mock.Element,
    mock.NodeFilter,
    mock.DocumentFragment,
  );
  return { exports: mod.exports, mock };
}

function createDummyFiber() {
  return {
    vnode: {
      $$typeof: Symbol.for("rain.element"),
      tag: "div",
      props: {},
      children: [],
    },
    dom: {},
    hooks: [],
    hookIndex: 0,
    childFibers: [],
    parent: null,
  };
}

function benchUseStateInit(hooks) {
  const { setCurrentFiber, useState } = hooks;
  return bench("useState 初期化", () => {
    const fiber = createDummyFiber();
    setCurrentFiber(fiber);
    useState(0);
    setCurrentFiber(null);
  });
}

function benchUseStateRead(hooks) {
  const { setCurrentFiber, useState } = hooks;
  const fiber = createDummyFiber();
  setCurrentFiber(fiber);
  useState(0);
  setCurrentFiber(null);

  return bench("useState 再読み取り", () => {
    fiber.hookIndex = 0;
    setCurrentFiber(fiber);
    useState(0);
    setCurrentFiber(null);
  });
}

function benchUseStateDirectUpdate(hooks) {
  const { setCurrentFiber, useState, setScheduleUpdate } = hooks;
  setScheduleUpdate(() => {});

  const fiber = createDummyFiber();
  setCurrentFiber(fiber);
  const [, setState] = useState(0);
  setCurrentFiber(null);

  return bench("useState 更新 (直値)", () => {
    setState(42);
    fiber.hookIndex = 0;
    setCurrentFiber(fiber);
    useState(0);
    setCurrentFiber(null);
  });
}

function benchUseStateFnUpdate(hooks) {
  const { setCurrentFiber, useState, setScheduleUpdate } = hooks;
  setScheduleUpdate(() => {});

  const fiber = createDummyFiber();
  setCurrentFiber(fiber);
  const [, setState] = useState(0);
  setCurrentFiber(null);

  return bench("useState 更新 (関数)", () => {
    setState((prev) => prev + 1);
    fiber.hookIndex = 0;
    setCurrentFiber(fiber);
    useState(0);
    setCurrentFiber(null);
  });
}

function benchUseEffectInit(hooks) {
  const { setCurrentFiber, useEffect, flushPendingEffects } = hooks;
  return bench("useEffect 初期登録", () => {
    const fiber = createDummyFiber();
    setCurrentFiber(fiber);
    useEffect(() => undefined, []);
    setCurrentFiber(null);
    flushPendingEffects();
  });
}

function benchUseEffectSkip(hooks) {
  const { setCurrentFiber, useEffect } = hooks;
  const fiber = createDummyFiber();
  setCurrentFiber(fiber);
  useEffect(() => undefined, [1, 2, 3]);
  setCurrentFiber(null);

  return bench("useEffect deps 不変", () => {
    fiber.hookIndex = 0;
    setCurrentFiber(fiber);
    useEffect(() => undefined, [1, 2, 3]);
    setCurrentFiber(null);
  });
}

function benchUseEffectDepsChanged(hooks) {
  const { setCurrentFiber, useEffect, flushPendingEffects } = hooks;
  const fiber = createDummyFiber();
  setCurrentFiber(fiber);
  useEffect(() => undefined, [0]);
  setCurrentFiber(null);
  flushPendingEffects();

  let i = 0;
  return bench("useEffect deps 変更", () => {
    i++;
    fiber.hookIndex = 0;
    setCurrentFiber(fiber);
    useEffect(() => undefined, [i]);
    setCurrentFiber(null);
    flushPendingEffects();
  });
}

function benchUseRef(hooks) {
  const { setCurrentFiber, useRef } = hooks;
  const fiber = createDummyFiber();
  setCurrentFiber(fiber);
  useRef(null);
  setCurrentFiber(null);

  return bench("useRef 読み取り", () => {
    fiber.hookIndex = 0;
    setCurrentFiber(fiber);
    useRef(null);
    setCurrentFiber(null);
  });
}

function benchUseMemoHit(hooks) {
  const { setCurrentFiber, useMemo } = hooks;
  const fiber = createDummyFiber();
  setCurrentFiber(fiber);
  useMemo(() => 42, [1, 2]);
  setCurrentFiber(null);

  return bench("useMemo キャッシュヒット", () => {
    fiber.hookIndex = 0;
    setCurrentFiber(fiber);
    useMemo(() => 42, [1, 2]);
    setCurrentFiber(null);
  });
}

function benchUseMemoMiss(hooks) {
  const { setCurrentFiber, useMemo } = hooks;
  const fiber = createDummyFiber();
  setCurrentFiber(fiber);
  useMemo(() => 42, [0]);
  setCurrentFiber(null);

  let i = 0;
  return bench("useMemo 再計算", () => {
    i++;
    fiber.hookIndex = 0;
    setCurrentFiber(fiber);
    useMemo(() => i * 2, [i]);
    setCurrentFiber(null);
  });
}

function benchUseCallbackHit(hooks) {
  const { setCurrentFiber, useCallback } = hooks;
  const fiber = createDummyFiber();
  const cb = () => {};
  setCurrentFiber(fiber);
  useCallback(cb, [1]);
  setCurrentFiber(null);

  return bench("useCallback キャッシュヒット", () => {
    fiber.hookIndex = 0;
    setCurrentFiber(fiber);
    useCallback(cb, [1]);
    setCurrentFiber(null);
  });
}

function benchCreateContextAndUse(hooks) {
  const { setCurrentFiber, createContext, useContext } = hooks;
  const fiber = createDummyFiber();

  return bench("createContext + useContext", () => {
    const ctx = createContext("value");
    setCurrentFiber(fiber);
    useContext(ctx);
    setCurrentFiber(null);
  });
}

function benchHooksScale(hooks, hookCount) {
  const { setCurrentFiber, useState } = hooks;

  const fiber = createDummyFiber();
  setCurrentFiber(fiber);
  for (let i = 0; i < hookCount; i++) {
    useState(i);
  }
  setCurrentFiber(null);

  return bench(`useState × ${hookCount} (再読み取り)`, () => {
    fiber.hookIndex = 0;
    setCurrentFiber(fiber);
    for (let i = 0; i < hookCount; i++) {
      useState(i);
    }
    setCurrentFiber(null);
  });
}

function benchRerender(hooks, hookCount) {
  const {
    setCurrentFiber,
    useState,
    useEffect,
    useMemo,
    useRef,
    setScheduleUpdate,
    flushPendingEffects,
  } = hooks;
  setScheduleUpdate(() => {});

  const fiber = createDummyFiber();

  setCurrentFiber(fiber);
  const [, setState] = useState(0);
  for (let i = 1; i < hookCount; i++) {
    if (i % 3 === 0) useEffect(() => undefined, [i]);
    else if (i % 3 === 1) useRef(null);
    else useMemo(() => i * 2, [i]);
  }
  setCurrentFiber(null);
  flushPendingEffects();

  let counter = 0;

  return bench(`再レンダリング (${hookCount} hooks)`, () => {
    counter++;
    setState(counter);

    fiber.hookIndex = 0;
    setCurrentFiber(fiber);
    useState(0);
    for (let i = 1; i < hookCount; i++) {
      if (i % 3 === 0) useEffect(() => undefined, [i]);
      else if (i % 3 === 1) useRef(null);
      else useMemo(() => i * 2, [i]);
    }
    setCurrentFiber(null);
    flushPendingEffects();
  });
}

function benchFlushEffects(hooks, effectCount) {
  const { setCurrentFiber, useEffect, flushPendingEffects } = hooks;
  const iterations = effectCount >= 1000 ? 1000 : 10000;

  return bench(
    `flushEffects (${effectCount} effects)`,
    () => {
      const fiber = createDummyFiber();
      setCurrentFiber(fiber);
      for (let i = 0; i < effectCount; i++) {
        useEffect(() => undefined, []);
      }
      setCurrentFiber(null);
      flushPendingEffects();
    },
    iterations,
  );
}

function benchReconcilerSimple(client) {
  const {
    createElement,
    createDomNode,
    setCurrentFiber,
    setScheduleUpdate,
    useState,
    reconcile,
  } = client.exports;
  const mockDoc = client.mock.document;
  setScheduleUpdate(() => {});

  const Counter = () => {
    const [count] = useState(0);
    return createElement(
      "div",
      { className: "counter" },
      createElement("span", null, String(count)),
    );
  };

  const container = mockDoc.createElement("div");
  const vnode = createElement(Counter, null);

  const fiber = {
    vnode,
    dom: null,
    hooks: [],
    hookIndex: 0,
    childFibers: [],
    parent: null,
    rendered: null,
  };

  setCurrentFiber(fiber);
  const rendered = Counter({});
  setCurrentFiber(null);

  fiber.dom = createDomNode(rendered);
  container.appendChild(fiber.dom);
  fiber.rendered = rendered;

  const stateHook = fiber.hooks[0];
  let val = 0;

  return bench("reconcile (単純コンポーネント)", () => {
    val++;
    stateHook.queue.push(val);

    fiber.hookIndex = 0;
    setCurrentFiber(fiber);
    const newRendered = Counter({});
    setCurrentFiber(null);

    if (newRendered) {
      reconcile(container, fiber, newRendered);
    }
  });
}

function benchReconcilerList(client, itemCount) {
  const {
    createElement,
    createDomNode,
    setCurrentFiber,
    setScheduleUpdate,
    useState,
    reconcile,
  } = client.exports;
  const mockDoc = client.mock.document;
  setScheduleUpdate(() => {});

  const List = () => {
    const [items] = useState(Array.from({ length: itemCount }, (_, i) => i));
    return createElement(
      "ul",
      null,
      ...items.map((item) =>
        createElement("li", { key: String(item) }, `item-${item}`),
      ),
    );
  };

  const container = mockDoc.createElement("div");
  const vnode = createElement(List, null);

  const fiber = {
    vnode,
    dom: null,
    hooks: [],
    hookIndex: 0,
    childFibers: [],
    parent: null,
    rendered: null,
  };

  setCurrentFiber(fiber);
  const rendered = List({});
  setCurrentFiber(null);

  fiber.dom = createDomNode(rendered);
  container.appendChild(fiber.dom);
  fiber.rendered = rendered;

  const stateHook = fiber.hooks[0];
  let offset = 0;

  return bench(
    `reconcile (リスト ${itemCount}件)`,
    () => {
      offset++;
      stateHook.queue.push(
        Array.from({ length: itemCount }, (_, i) => i + offset),
      );

      fiber.hookIndex = 0;
      setCurrentFiber(fiber);
      const newRendered = List({});
      setCurrentFiber(null);

      if (newRendered) {
        reconcile(container, fiber, newRendered);
      }
    },
    itemCount >= 100 ? 1000 : 10000,
  );
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

function createDummyPageHandler(createElement) {
  return (_ctx) =>
    createElement(
      "div",
      { className: "page" },
      createElement("h1", null, "Hello"),
      createElement("p", null, "content"),
    );
}

function createDummyLayout(createElement, name) {
  return (_ctx, children) =>
    createElement(
      "div",
      { className: `layout-${name}` },
      createElement("header", null, name),
      children,
    );
}

function benchPageRegistration(RainClass, createElement, count) {
  return bench(
    `${count} ページ登録`,
    () => {
      const app = new RainClass();
      const handler = createDummyPageHandler(createElement);
      const layout = createDummyLayout(createElement, "root");
      for (let i = 0; i < count; i++) {
        app.page(`/page${i}`, handler, [layout]);
      }
    },
    1000,
  );
}

function benchPageRendering(RainClass, createElement, layoutCount) {
  const app = new RainClass();
  const handler = createDummyPageHandler(createElement);
  const layouts = Array.from({ length: layoutCount }, (_, i) =>
    createDummyLayout(createElement, `L${i}`),
  );
  app.page("/bench-page", handler, layouts, [], layoutCount > 0);
  const req = createRequest("/bench-page");
  const label =
    layoutCount === 0
      ? "ページレンダリング (レイアウトなし)"
      : `ページレンダリング (${layoutCount}レイアウト)`;
  return bench(label, async () => await app.fetch(req));
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
  console.log = () => undefined;
  console.warn = () => undefined;
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
  const simple = 'export const GET: Handler = (ctx) => new Response("ok");';
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

function benchDetectDefaultExport() {
  const exportDefault =
    "const Page = (ctx) => <h1>Hello</h1>;\nexport default Page;";
  const exportDefaultFunction =
    "export default function Page(ctx) { return <h1>Hello</h1>; }";
  const noDefault = 'export const GET: Handler = (ctx) => new Response("ok");';

  return {
    assignment: () =>
      bench("AST default export 検出 (代入)", () =>
        detectDefaultExportFromContent(exportDefault),
      ),
    functionDecl: () =>
      bench("AST default export 検出 (関数)", () =>
        detectDefaultExportFromContent(exportDefaultFunction),
      ),
    absent: () =>
      bench("AST default export 検出 (なし)", () =>
        detectDefaultExportFromContent(noDefault),
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

  console.log("\n## ページ登録\n");
  const pageRegResults = [
    await benchPageRegistration(Rain, createElement, 10),
    await benchPageRegistration(Rain, createElement, 50),
    await benchPageRegistration(Rain, createElement, 100),
  ];
  printTable(pageRegResults);

  console.log("\n## ページレンダリング (レイアウト数別)\n");
  const pageRenderResults = [
    await benchPageRendering(Rain, createElement, 0),
    await benchPageRendering(Rain, createElement, 1),
    await benchPageRendering(Rain, createElement, 3),
  ];
  printTable(pageRenderResults);

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
  const astDefaultBenches = benchDetectDefaultExport();
  const astResults = [
    await astMethodBenches.simple(),
    await astMethodBenches.multi(),
    await astMethodBenches.reExport(),
    await astMwBench(),
    await astDefaultBenches.assignment(),
    await astDefaultBenches.functionDecl(),
    await astDefaultBenches.absent(),
  ];
  printTable(astResults);

  console.log("\n## クライアント Hooks\n");
  const hooks = loadClientHooks();
  const hookResults = [
    await benchUseStateInit(hooks),
    await benchUseStateRead(hooks),
    await benchUseStateDirectUpdate(hooks),
    await benchUseStateFnUpdate(hooks),
    await benchUseEffectInit(hooks),
    await benchUseEffectSkip(hooks),
    await benchUseEffectDepsChanged(hooks),
    await benchUseRef(hooks),
    await benchUseMemoHit(hooks),
    await benchUseMemoMiss(hooks),
    await benchUseCallbackHit(hooks),
    await benchCreateContextAndUse(hooks),
  ];
  printTable(hookResults);

  console.log("\n## Hooks スケールテスト\n");
  const scaleResults = [
    await benchHooksScale(hooks, 1),
    await benchHooksScale(hooks, 10),
    await benchHooksScale(hooks, 50),
  ];
  printTable(scaleResults);

  console.log("\n## 再レンダリングシミュレーション\n");
  const rerenderResults = [
    await benchRerender(hooks, 5),
    await benchRerender(hooks, 10),
    await benchRerender(hooks, 30),
  ];
  printTable(rerenderResults);

  console.log("\n## flushPendingEffects スケール\n");
  const flushResults = [
    await benchFlushEffects(hooks, 10),
    await benchFlushEffects(hooks, 100),
    await benchFlushEffects(hooks, 1000),
  ];
  printTable(flushResults);

  console.log("\n## Reconciler 統合 (DOM モック)\n");
  const clientCode = loadClientBundle();
  const client = evalClientBundle(clientCode);
  const reconcilerResults = [
    await benchReconcilerSimple(client),
    await benchReconcilerList(client, 10),
    await benchReconcilerList(client, 100),
  ];
  printTable(reconcilerResults);

  console.log(`\n${"=".repeat(60)}`);
  console.log("完了");
}

main().catch(console.error);
