const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  filePathToUrlPath,
  filePathToImportName,
  middlewareImportName,
  getMiddlewaresForRoute,
  detectExportedMethodsFromContent,
  detectMiddlewareExportFromContent,
} = require("../scripts/generate");

describe("filePathToUrlPath", () => {
  it("root route", () => {
    assert.strictEqual(filePathToUrlPath("route.ts"), "/");
  });

  it("simple path", () => {
    assert.strictEqual(filePathToUrlPath("user/route.ts"), "/user");
  });

  it("dynamic segment", () => {
    assert.strictEqual(
      filePathToUrlPath("user/[id]/route.ts"),
      "/user/:id",
    );
  });

  it("tsx extension", () => {
    assert.strictEqual(
      filePathToUrlPath("hello/route.tsx"),
      "/hello",
    );
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
    assert.strictEqual(
      filePathToImportName("route.ts"),
      "route_route",
    );
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
    assert.strictEqual(
      middlewareImportName("_middleware.ts"),
      "mw_root",
    );
  });

  it("nested middleware", () => {
    assert.strictEqual(
      middlewareImportName("user/_middleware.ts"),
      "mw_user_",
    );
  });

  it("deep nested middleware", () => {
    assert.strictEqual(
      middlewareImportName("api/v1/_middleware.ts"),
      "mw_api_v1_",
    );
  });
});

describe("getMiddlewaresForRoute", () => {
  it("returns root middleware for all routes", () => {
    const result = getMiddlewaresForRoute("user/route.ts", [
      "_middleware.ts",
    ]);
    assert.deepStrictEqual(result, ["_middleware.ts"]);
  });

  it("returns empty for no middlewares", () => {
    const result = getMiddlewaresForRoute("user/route.ts", []);
    assert.deepStrictEqual(result, []);
  });

  it("returns middlewares in depth order (parent first)", () => {
    const result = getMiddlewaresForRoute(
      "user/[id]/route.ts",
      ["user/_middleware.ts", "_middleware.ts"],
    );
    assert.deepStrictEqual(result, [
      "_middleware.ts",
      "user/_middleware.ts",
    ]);
  });

  it("does not return unrelated middleware", () => {
    const result = getMiddlewaresForRoute("user/route.ts", [
      "admin/_middleware.ts",
    ]);
    assert.deepStrictEqual(result, []);
  });

  it("returns root middleware for root route", () => {
    const result = getMiddlewaresForRoute("route.ts", [
      "_middleware.ts",
    ]);
    assert.deepStrictEqual(result, ["_middleware.ts"]);
  });

  it("returns multiple levels in order", () => {
    const result = getMiddlewaresForRoute(
      "api/v1/users/route.ts",
      [
        "api/v1/_middleware.ts",
        "_middleware.ts",
        "api/_middleware.ts",
      ],
    );
    assert.deepStrictEqual(result, [
      "_middleware.ts",
      "api/_middleware.ts",
      "api/v1/_middleware.ts",
    ]);
  });
});

describe("detectExportedMethodsFromContent", () => {
  it("detects export const GET", () => {
    const content =
      'export const GET: Handler = (ctx) => new Response("ok");';
    assert.deepStrictEqual(
      detectExportedMethodsFromContent(content),
      ["GET"],
    );
  });

  it("detects export function POST", () => {
    const content =
      "export function POST(ctx) {" +
      ' return new Response("ok"); }';
    assert.deepStrictEqual(
      detectExportedMethodsFromContent(content),
      ["POST"],
    );
  });

  it("detects export async function PUT", () => {
    const content =
      "export async function PUT(ctx) {" +
      ' return new Response("ok"); }';
    assert.deepStrictEqual(
      detectExportedMethodsFromContent(content),
      ["PUT"],
    );
  });

  it("detects export { GET } (re-export)", () => {
    const content =
      'const GET = () => new Response("ok");\nexport { GET };';
    assert.deepStrictEqual(
      detectExportedMethodsFromContent(content),
      ["GET"],
    );
  });

  it("detects export { handler as GET } (renamed export)", () => {
    const content =
      'const handler = () => new Response("ok");\n' +
      "export { handler as GET };";
    assert.deepStrictEqual(
      detectExportedMethodsFromContent(content),
      ["GET"],
    );
  });

  it("detects multiple methods", () => {
    const content =
      'export const GET: Handler = (ctx) => new Response("ok");\n' +
      'export const POST: Handler = (ctx) => new Response("ok");';
    assert.deepStrictEqual(
      detectExportedMethodsFromContent(content),
      ["GET", "POST"],
    );
  });

  it("ignores non-HTTP exports", () => {
    const content = "export const handler = () => {};";
    assert.deepStrictEqual(
      detectExportedMethodsFromContent(content),
      [],
    );
  });

  it("detects PATCH, HEAD, OPTIONS", () => {
    const content =
      "export const PATCH = () => {};\n" +
      "export const HEAD = () => {};\n" +
      "export const OPTIONS = () => {};";
    assert.deepStrictEqual(
      detectExportedMethodsFromContent(content),
      ["PATCH", "HEAD", "OPTIONS"],
    );
  });

  it("detects DELETE", () => {
    const content = 'export const DELETE = () => new Response("");';
    assert.deepStrictEqual(
      detectExportedMethodsFromContent(content),
      ["DELETE"],
    );
  });

  it("detects multiple methods in named export", () => {
    const content =
      'const GET = () => new Response("");\n' +
      'const POST = () => new Response("");\n' +
      "export { GET, POST };";
    assert.deepStrictEqual(
      detectExportedMethodsFromContent(content),
      ["GET", "POST"],
    );
  });

  it("detects mixed export styles", () => {
    const content =
      'export const GET: Handler = (ctx) => new Response("");\n' +
      'const handler = () => new Response("");\n' +
      "export { handler as POST };";
    assert.deepStrictEqual(
      detectExportedMethodsFromContent(content),
      ["GET", "POST"],
    );
  });

  it("returns empty for empty content", () => {
    assert.deepStrictEqual(
      detectExportedMethodsFromContent(""),
      [],
    );
  });
});

describe("detectMiddlewareExportFromContent", () => {
  it("detects export const onRequest", () => {
    const content =
      "export const onRequest: Middleware = " +
      "async (ctx, next) => { return await next(); };";
    assert.strictEqual(
      detectMiddlewareExportFromContent(content),
      true,
    );
  });

  it("detects export function onRequest", () => {
    const content =
      "export function onRequest(ctx, next)" +
      " { return next(); }";
    assert.strictEqual(
      detectMiddlewareExportFromContent(content),
      true,
    );
  });

  it("detects export async function onRequest", () => {
    const content =
      "export async function onRequest(ctx, next)" +
      " { return await next(); }";
    assert.strictEqual(
      detectMiddlewareExportFromContent(content),
      true,
    );
  });

  it("detects export { onRequest } (re-export)", () => {
    const content =
      "const onRequest = async (ctx, next) => next();\n" +
      "export { onRequest };";
    assert.strictEqual(
      detectMiddlewareExportFromContent(content),
      true,
    );
  });

  it("detects export { handler as onRequest } (renamed)", () => {
    const content =
      "const handler = async (ctx, next) => next();\n" +
      "export { handler as onRequest };";
    assert.strictEqual(
      detectMiddlewareExportFromContent(content),
      true,
    );
  });

  it("returns false when no onRequest", () => {
    const content = "export const GET = () => {};";
    assert.strictEqual(
      detectMiddlewareExportFromContent(content),
      false,
    );
  });

  it("returns false for empty content", () => {
    assert.strictEqual(
      detectMiddlewareExportFromContent(""),
      false,
    );
  });
});
