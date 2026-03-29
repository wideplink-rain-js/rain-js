const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  filePathToUrlPath,
  filePathToImportName,
  middlewareImportName,
  getMiddlewaresForRoute,
  detectExportedMethodsFromContent,
  detectMiddlewareExportFromContent,
  pageFilePathToUrlPath,
  pageFilePathToImportName,
  layoutImportName,
  getLayoutsForPage,
  detectDefaultExportFromContent,
  validateNoPageRouteColocation,
  validateNoDuplicateUrls,
  stripRouteGroupSegments,
  detectAllExportsFromContent,
  clientFileToIslandId,
  detectUseClientDirective,
} = require("../scripts/generate");

describe("filePathToUrlPath", () => {
  it("root route", () => {
    assert.strictEqual(filePathToUrlPath("route.ts"), "/");
  });

  it("simple path", () => {
    assert.strictEqual(filePathToUrlPath("user/route.ts"), "/user");
  });

  it("dynamic segment", () => {
    assert.strictEqual(filePathToUrlPath("user/[id]/route.ts"), "/user/:id");
  });

  it("tsx extension", () => {
    assert.strictEqual(filePathToUrlPath("hello/route.tsx"), "/hello");
  });

  it("nested path", () => {
    assert.strictEqual(
      filePathToUrlPath("api/v1/users/route.ts"),
      "/api/v1/users",
    );
  });

  it("multiple dynamic segments", () => {
    assert.strictEqual(
      filePathToUrlPath("user/[id]/post/[postId]/route.ts"),
      "/user/:id/post/:postId",
    );
  });
});

describe("filePathToImportName", () => {
  it("root route", () => {
    assert.strictEqual(filePathToImportName("route.ts"), "route_route");
  });

  it("nested route", () => {
    assert.strictEqual(
      filePathToImportName("user/route.ts"),
      "route_user_route",
    );
  });

  it("dynamic segment", () => {
    assert.strictEqual(
      filePathToImportName("user/[id]/route.ts"),
      "route_user_$id_route",
    );
  });

  it("tsx extension", () => {
    assert.strictEqual(
      filePathToImportName("hello/route.tsx"),
      "route_hello_route",
    );
  });

  it("hyphenated path", () => {
    assert.strictEqual(
      filePathToImportName("my-page/route.ts"),
      "route_my_page_route",
    );
  });
});

describe("middlewareImportName", () => {
  it("root middleware", () => {
    assert.strictEqual(middlewareImportName("_middleware.ts"), "mw_root");
  });

  it("nested middleware", () => {
    assert.strictEqual(middlewareImportName("user/_middleware.ts"), "mw_user");
  });

  it("deep nested middleware", () => {
    assert.strictEqual(
      middlewareImportName("api/v1/_middleware.ts"),
      "mw_api_v1",
    );
  });
});

describe("getMiddlewaresForRoute", () => {
  it("returns root middleware for all routes", () => {
    const result = getMiddlewaresForRoute("user/route.ts", ["_middleware.ts"]);
    assert.deepStrictEqual(result, ["_middleware.ts"]);
  });

  it("returns empty for no middlewares", () => {
    const result = getMiddlewaresForRoute("user/route.ts", []);
    assert.deepStrictEqual(result, []);
  });

  it("returns middlewares in depth order (parent first)", () => {
    const result = getMiddlewaresForRoute("user/[id]/route.ts", [
      "_middleware.ts",
      "user/_middleware.ts",
    ]);
    assert.deepStrictEqual(result, ["_middleware.ts", "user/_middleware.ts"]);
  });

  it("does not return unrelated middleware", () => {
    const result = getMiddlewaresForRoute("user/route.ts", [
      "admin/_middleware.ts",
    ]);
    assert.deepStrictEqual(result, []);
  });

  it("returns root middleware for root route", () => {
    const result = getMiddlewaresForRoute("route.ts", ["_middleware.ts"]);
    assert.deepStrictEqual(result, ["_middleware.ts"]);
  });

  it("returns multiple levels in order", () => {
    const result = getMiddlewaresForRoute("api/v1/users/route.ts", [
      "_middleware.ts",
      "api/_middleware.ts",
      "api/v1/_middleware.ts",
    ]);
    assert.deepStrictEqual(result, [
      "_middleware.ts",
      "api/_middleware.ts",
      "api/v1/_middleware.ts",
    ]);
  });
});

describe("detectExportedMethodsFromContent", () => {
  it("detects export const GET", () => {
    const content = 'export const GET: Handler = (ctx) => new Response("ok");';
    assert.deepStrictEqual(detectExportedMethodsFromContent(content), ["GET"]);
  });

  it("detects export function POST", () => {
    const content =
      "export function POST(ctx) {" + ' return new Response("ok"); }';
    assert.deepStrictEqual(detectExportedMethodsFromContent(content), ["POST"]);
  });

  it("detects export async function PUT", () => {
    const content =
      "export async function PUT(ctx) {" + ' return new Response("ok"); }';
    assert.deepStrictEqual(detectExportedMethodsFromContent(content), ["PUT"]);
  });

  it("detects export { GET } (re-export)", () => {
    const content = 'const GET = () => new Response("ok");\nexport { GET };';
    assert.deepStrictEqual(detectExportedMethodsFromContent(content), ["GET"]);
  });

  it("detects export { handler as GET } (renamed export)", () => {
    const content =
      'const handler = () => new Response("ok");\n' +
      "export { handler as GET };";
    assert.deepStrictEqual(detectExportedMethodsFromContent(content), ["GET"]);
  });

  it("detects multiple methods", () => {
    const content =
      'export const GET: Handler = (ctx) => new Response("ok");\n' +
      'export const POST: Handler = (ctx) => new Response("ok");';
    assert.deepStrictEqual(detectExportedMethodsFromContent(content), [
      "GET",
      "POST",
    ]);
  });

  it("ignores non-HTTP exports", () => {
    const content = "export const handler = () => {};";
    assert.deepStrictEqual(detectExportedMethodsFromContent(content), []);
  });

  it("detects PATCH, HEAD, OPTIONS", () => {
    const content =
      "export const PATCH = () => {};\n" +
      "export const HEAD = () => {};\n" +
      "export const OPTIONS = () => {};";
    assert.deepStrictEqual(detectExportedMethodsFromContent(content), [
      "PATCH",
      "HEAD",
      "OPTIONS",
    ]);
  });

  it("detects DELETE", () => {
    const content = 'export const DELETE = () => new Response("");';
    assert.deepStrictEqual(detectExportedMethodsFromContent(content), [
      "DELETE",
    ]);
  });

  it("detects multiple methods in named export", () => {
    const content =
      'const GET = () => new Response("");\n' +
      'const POST = () => new Response("");\n' +
      "export { GET, POST };";
    assert.deepStrictEqual(detectExportedMethodsFromContent(content), [
      "GET",
      "POST",
    ]);
  });

  it("detects mixed export styles", () => {
    const content =
      'export const GET: Handler = (ctx) => new Response("");\n' +
      'const handler = () => new Response("");\n' +
      "export { handler as POST };";
    assert.deepStrictEqual(detectExportedMethodsFromContent(content), [
      "GET",
      "POST",
    ]);
  });

  it("returns empty for empty content", () => {
    assert.deepStrictEqual(detectExportedMethodsFromContent(""), []);
  });
});

describe("detectMiddlewareExportFromContent", () => {
  it("detects export const onRequest", () => {
    const content =
      "export const onRequest: Middleware = " +
      "async (ctx, next) => { return await next(); };";
    assert.strictEqual(detectMiddlewareExportFromContent(content), true);
  });

  it("detects export function onRequest", () => {
    const content =
      "export function onRequest(ctx, next)" + " { return next(); }";
    assert.strictEqual(detectMiddlewareExportFromContent(content), true);
  });

  it("detects export async function onRequest", () => {
    const content =
      "export async function onRequest(ctx, next)" +
      " { return await next(); }";
    assert.strictEqual(detectMiddlewareExportFromContent(content), true);
  });

  it("detects export { onRequest } (re-export)", () => {
    const content =
      "const onRequest = async (ctx, next) => next();\n" +
      "export { onRequest };";
    assert.strictEqual(detectMiddlewareExportFromContent(content), true);
  });

  it("detects export { handler as onRequest } (renamed)", () => {
    const content =
      "const handler = async (ctx, next) => next();\n" +
      "export { handler as onRequest };";
    assert.strictEqual(detectMiddlewareExportFromContent(content), true);
  });

  it("returns false when no onRequest", () => {
    const content = "export const GET = () => {};";
    assert.strictEqual(detectMiddlewareExportFromContent(content), false);
  });

  it("returns false for empty content", () => {
    assert.strictEqual(detectMiddlewareExportFromContent(""), false);
  });
});

describe("pageFilePathToUrlPath", () => {
  it("root page", () => {
    assert.strictEqual(pageFilePathToUrlPath("page.tsx"), "/");
  });

  it("simple path", () => {
    assert.strictEqual(pageFilePathToUrlPath("hello/page.tsx"), "/hello");
  });

  it("dynamic segment", () => {
    assert.strictEqual(
      pageFilePathToUrlPath("user/[id]/page.tsx"),
      "/user/:id",
    );
  });

  it("nested path", () => {
    assert.strictEqual(
      pageFilePathToUrlPath("admin/settings/page.tsx"),
      "/admin/settings",
    );
  });

  it("ts extension", () => {
    assert.strictEqual(pageFilePathToUrlPath("hello/page.ts"), "/hello");
  });
});

describe("pageFilePathToImportName", () => {
  it("root page", () => {
    assert.strictEqual(pageFilePathToImportName("page.tsx"), "page_page");
  });

  it("nested page", () => {
    assert.strictEqual(
      pageFilePathToImportName("hello/page.tsx"),
      "page_hello_page",
    );
  });

  it("dynamic segment", () => {
    assert.strictEqual(
      pageFilePathToImportName("user/[id]/page.tsx"),
      "page_user_$id_page",
    );
  });
});

describe("layoutImportName", () => {
  it("root layout", () => {
    assert.strictEqual(layoutImportName("layout.tsx"), "layout_root");
  });

  it("nested layout", () => {
    assert.strictEqual(layoutImportName("admin/layout.tsx"), "layout_admin");
  });

  it("deep nested layout", () => {
    assert.strictEqual(
      layoutImportName("admin/settings/layout.tsx"),
      "layout_admin_settings",
    );
  });
});

describe("getLayoutsForPage", () => {
  it("returns root layout for all pages", () => {
    const result = getLayoutsForPage("hello/page.tsx", ["layout.tsx"]);
    assert.deepStrictEqual(result, ["layout.tsx"]);
  });

  it("returns empty for no layouts", () => {
    const result = getLayoutsForPage("hello/page.tsx", []);
    assert.deepStrictEqual(result, []);
  });

  it("returns layouts in depth order (parent first)", () => {
    const result = getLayoutsForPage("admin/settings/page.tsx", [
      "layout.tsx",
      "admin/layout.tsx",
    ]);
    assert.deepStrictEqual(result, ["layout.tsx", "admin/layout.tsx"]);
  });

  it("does not return unrelated layout", () => {
    const result = getLayoutsForPage("hello/page.tsx", ["admin/layout.tsx"]);
    assert.deepStrictEqual(result, []);
  });

  it("returns root layout for root page", () => {
    const result = getLayoutsForPage("page.tsx", ["layout.tsx"]);
    assert.deepStrictEqual(result, ["layout.tsx"]);
  });
});

describe("detectDefaultExportFromContent", () => {
  it("detects export default function", () => {
    const content = "export default function Page() { return null; }";
    assert.strictEqual(detectDefaultExportFromContent(content), true);
  });

  it("detects export default assignment", () => {
    const content = "const Page = () => null;\nexport default Page;";
    assert.strictEqual(detectDefaultExportFromContent(content), true);
  });

  it("detects export default class", () => {
    const content = "export default class Page {}";
    assert.strictEqual(detectDefaultExportFromContent(content), true);
  });

  it("returns false for named exports only", () => {
    const content = "export const GET = () => {};";
    assert.strictEqual(detectDefaultExportFromContent(content), false);
  });

  it("returns false for empty content", () => {
    assert.strictEqual(detectDefaultExportFromContent(""), false);
  });

  it("detects export default arrow function", () => {
    const content = "export default () => null";
    assert.strictEqual(detectDefaultExportFromContent(content), true);
  });

  it("detects export default arrow function with params", () => {
    const content = "export default (ctx) => ctx.params";
    assert.strictEqual(detectDefaultExportFromContent(content), true);
  });
});

describe("validateNoPageRouteColocation", () => {
  it("returns empty for no conflicts", () => {
    const errors = validateNoPageRouteColocation(
      ["user/route.ts"],
      ["hello/page.tsx"],
    );
    assert.deepStrictEqual(errors, []);
  });

  it("returns error for same directory", () => {
    const errors = validateNoPageRouteColocation(
      ["hello/route.ts"],
      ["hello/page.tsx"],
    );
    assert.strictEqual(errors.length, 1);
    assert.ok(errors[0].includes("cannot coexist"));
  });

  it("returns error for root directory conflict", () => {
    const errors = validateNoPageRouteColocation(["route.ts"], ["page.tsx"]);
    assert.strictEqual(errors.length, 1);
  });

  it("allows different directories", () => {
    const errors = validateNoPageRouteColocation(
      ["api/route.ts", "user/route.ts"],
      ["hello/page.tsx", "about/page.tsx"],
    );
    assert.deepStrictEqual(errors, []);
  });

  it("detects URL-level conflict across route groups", () => {
    const errors = validateNoPageRouteColocation(
      ["(api)/users/route.ts"],
      ["(pages)/users/page.tsx"],
    );
    assert.strictEqual(errors.length, 1);
    assert.ok(errors[0].includes("resolve to the same URL path"));
  });

  it("allows route groups with different URLs", () => {
    const errors = validateNoPageRouteColocation(
      ["(api)/data/route.ts"],
      ["(pages)/home/page.tsx"],
    );
    assert.deepStrictEqual(errors, []);
  });
});

describe("stripRouteGroupSegments", () => {
  it("strips single route group", () => {
    assert.strictEqual(
      stripRouteGroupSegments("(admin)/users/route"),
      "users/route",
    );
  });

  it("strips multiple route groups", () => {
    assert.strictEqual(
      stripRouteGroupSegments("(admin)/(settings)/profile/page"),
      "profile/page",
    );
  });

  it("strips nested route group", () => {
    assert.strictEqual(
      stripRouteGroupSegments("users/(admin)/route"),
      "users/route",
    );
  });

  it("preserves path without route groups", () => {
    assert.strictEqual(stripRouteGroupSegments("users/route"), "users/route");
  });

  it("preserves dynamic segments", () => {
    assert.strictEqual(
      stripRouteGroupSegments("(admin)/users/[id]/route"),
      "users/[id]/route",
    );
  });

  it("returns filename when only group prefix", () => {
    assert.strictEqual(stripRouteGroupSegments("(group)/route"), "route");
  });

  it("does not strip partial parens", () => {
    assert.strictEqual(
      stripRouteGroupSegments("(broken/route"),
      "(broken/route",
    );
  });
});

describe("filePathToUrlPath (route groups)", () => {
  it("strips route group from path", () => {
    assert.strictEqual(filePathToUrlPath("(api)/users/route.ts"), "/users");
  });

  it("strips nested route groups", () => {
    assert.strictEqual(
      filePathToUrlPath("(api)/(v1)/users/route.ts"),
      "/users",
    );
  });

  it("strips group at root level", () => {
    assert.strictEqual(filePathToUrlPath("(api)/route.ts"), "/");
  });

  it("preserves dynamic segments with groups", () => {
    assert.strictEqual(
      filePathToUrlPath("(api)/user/[id]/route.ts"),
      "/user/:id",
    );
  });

  it("strips mid-path group", () => {
    assert.strictEqual(
      filePathToUrlPath("user/(admin)/[id]/route.ts"),
      "/user/:id",
    );
  });
});

describe("pageFilePathToUrlPath (route groups)", () => {
  it("strips route group from page path", () => {
    assert.strictEqual(
      pageFilePathToUrlPath("(pages)/hello/page.tsx"),
      "/hello",
    );
  });

  it("strips group at root level", () => {
    assert.strictEqual(pageFilePathToUrlPath("(marketing)/page.tsx"), "/");
  });

  it("strips nested groups", () => {
    assert.strictEqual(
      pageFilePathToUrlPath("(admin)/(settings)/profile/page.tsx"),
      "/profile",
    );
  });
});

describe("filePathToImportName (route groups)", () => {
  it("strips parens from import name", () => {
    assert.strictEqual(
      filePathToImportName("(api)/users/route.ts"),
      "route_api_users_route",
    );
  });

  it("handles nested groups", () => {
    assert.strictEqual(
      filePathToImportName("(api)/(v1)/users/route.ts"),
      "route_api_v1_users_route",
    );
  });
});

describe("pageFilePathToImportName (route groups)", () => {
  it("strips parens from page import name", () => {
    assert.strictEqual(
      pageFilePathToImportName("(pages)/hello/page.tsx"),
      "page_pages_hello_page",
    );
  });
});

describe("middlewareImportName (route groups)", () => {
  it("strips parens from middleware name", () => {
    assert.strictEqual(
      middlewareImportName("(admin)/_middleware.ts"),
      "mw_admin",
    );
  });

  it("handles nested group path", () => {
    assert.strictEqual(
      middlewareImportName("(admin)/settings/_middleware.ts"),
      "mw_admin_settings",
    );
  });
});

describe("layoutImportName (route groups)", () => {
  it("strips parens from layout name", () => {
    assert.strictEqual(layoutImportName("(admin)/layout.tsx"), "layout_admin");
  });

  it("handles nested group path", () => {
    assert.strictEqual(
      layoutImportName("(admin)/settings/layout.tsx"),
      "layout_admin_settings",
    );
  });
});

describe("getMiddlewaresForRoute (route groups)", () => {
  it("matches middleware within same group", () => {
    const result = getMiddlewaresForRoute("(admin)/users/route.ts", [
      "(admin)/_middleware.ts",
    ]);
    assert.deepStrictEqual(result, ["(admin)/_middleware.ts"]);
  });

  it("does not match middleware from different group", () => {
    const result = getMiddlewaresForRoute("(public)/home/route.ts", [
      "(admin)/_middleware.ts",
    ]);
    assert.deepStrictEqual(result, []);
  });

  it("matches root middleware for grouped routes", () => {
    const result = getMiddlewaresForRoute("(admin)/users/route.ts", [
      "_middleware.ts",
    ]);
    assert.deepStrictEqual(result, ["_middleware.ts"]);
  });

  it("matches root and group middleware in order", () => {
    const result = getMiddlewaresForRoute("(admin)/users/route.ts", [
      "_middleware.ts",
      "(admin)/_middleware.ts",
    ]);
    assert.deepStrictEqual(result, [
      "_middleware.ts",
      "(admin)/_middleware.ts",
    ]);
  });
});

describe("getLayoutsForPage (route groups)", () => {
  it("matches layout within same group", () => {
    const result = getLayoutsForPage("(admin)/dashboard/page.tsx", [
      "(admin)/layout.tsx",
    ]);
    assert.deepStrictEqual(result, ["(admin)/layout.tsx"]);
  });

  it("does not match layout from different group", () => {
    const result = getLayoutsForPage("(public)/home/page.tsx", [
      "(admin)/layout.tsx",
    ]);
    assert.deepStrictEqual(result, []);
  });

  it("matches root and group layout in order", () => {
    const result = getLayoutsForPage("(admin)/dashboard/page.tsx", [
      "layout.tsx",
      "(admin)/layout.tsx",
    ]);
    assert.deepStrictEqual(result, ["layout.tsx", "(admin)/layout.tsx"]);
  });
});

describe("validateNoDuplicateUrls", () => {
  it("returns empty for unique URLs", () => {
    const errors = validateNoDuplicateUrls(
      ["(api)/users/route.ts", "(api)/posts/route.ts"],
      ["(pages)/home/page.tsx", "(pages)/about/page.tsx"],
    );
    assert.deepStrictEqual(errors, []);
  });

  it("detects duplicate route URLs across groups", () => {
    const errors = validateNoDuplicateUrls(
      ["(api)/users/route.ts", "(admin)/users/route.ts"],
      [],
    );
    assert.strictEqual(errors.length, 1);
    assert.ok(errors[0].includes("multiple route files"));
  });

  it("detects duplicate page URLs across groups", () => {
    const errors = validateNoDuplicateUrls(
      [],
      ["(admin)/dashboard/page.tsx", "(public)/dashboard/page.tsx"],
    );
    assert.strictEqual(errors.length, 1);
    assert.ok(errors[0].includes("multiple page files"));
  });

  it("allows same URL in route and page (caught by colocation)", () => {
    const errors = validateNoDuplicateUrls(
      ["(api)/users/route.ts"],
      ["(pages)/users/page.tsx"],
    );
    assert.deepStrictEqual(errors, []);
  });
});

describe("detectAllExportsFromContent", () => {
  it("detects named exports", () => {
    const result = detectAllExportsFromContent(
      "export function Counter() { return null; }\nexport const Label = () => null;",
    );
    assert.deepStrictEqual(result.named, ["Counter", "Label"]);
    assert.strictEqual(result.hasDefault, false);
  });

  it("detects default export", () => {
    const result = detectAllExportsFromContent(
      "export default function App() { return null; }",
    );
    assert.deepStrictEqual(result.named, []);
    assert.strictEqual(result.hasDefault, true);
  });

  it("detects both default and named exports", () => {
    const result = detectAllExportsFromContent(
      "export function Counter() {}\nexport default function App() {}",
    );
    assert.deepStrictEqual(result.named, ["Counter"]);
    assert.strictEqual(result.hasDefault, true);
  });

  it("detects export assignment", () => {
    const result = detectAllExportsFromContent(
      "const App = () => null;\nexport default App;",
    );
    assert.strictEqual(result.hasDefault, true);
  });

  it("detects re-exports via export declaration", () => {
    const result = detectAllExportsFromContent(
      'export { Foo, Bar } from "./other";',
    );
    assert.deepStrictEqual(result.named, ["Foo", "Bar"]);
  });
});

describe("clientFileToIslandId", () => {
  it("converts path to island id", () => {
    assert.strictEqual(
      clientFileToIslandId("components/Counter.tsx"),
      "components/Counter",
    );
  });

  it("handles nested paths", () => {
    assert.strictEqual(
      clientFileToIslandId("routes/todo/TodoList.tsx"),
      "routes/todo/TodoList",
    );
  });

  it("normalizes backslashes", () => {
    assert.strictEqual(
      clientFileToIslandId("components\\Counter.ts"),
      "components/Counter",
    );
  });
});

describe("detectUseClientDirective", () => {
  it("detects use client at file start", () => {
    assert.strictEqual(
      detectUseClientDirective('"use client";\nexport function Counter() {}'),
      true,
    );
  });

  it("returns false for non-directive", () => {
    assert.strictEqual(
      detectUseClientDirective("export function Counter() {}"),
      false,
    );
  });

  it("returns false for use server", () => {
    assert.strictEqual(
      detectUseClientDirective('"use server";\nexport function action() {}'),
      false,
    );
  });
});
