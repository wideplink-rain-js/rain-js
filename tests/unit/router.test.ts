import { describe, expect, it } from "vitest";
import type { Handler, LayoutHandler, PageHandler } from "../../src/framework";
import { createElement, HttpError } from "../../src/framework";
import { createApp, request } from "../helpers/app";

const ok: Handler = (ctx) => ctx.text("ok");

describe("Rain Router", () => {
  describe("basic routing", () => {
    it("matches a GET route", async () => {
      const app = createApp({ csrf: false });
      app.get("/", ok);
      const res = await request(app, "/");
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("ok");
    });

    it("returns 404 for unknown paths", async () => {
      const app = createApp({ csrf: false });
      app.get("/", ok);
      const res = await request(app, "/unknown");
      expect(res.status).toBe(404);
    });

    it("returns 405 for wrong method", async () => {
      const app = createApp({ csrf: false });
      app.get("/only-get", ok);
      const res = await request(app, "/only-get", { method: "POST" });
      expect(res.status).toBe(405);
    });

    it("supports multiple methods on same path", async () => {
      const app = createApp({ csrf: false });
      app.get("/multi", (ctx) => ctx.text("GET"));
      app.post("/multi", (ctx) => ctx.text("POST"));

      const getRes = await request(app, "/multi");
      expect(await getRes.text()).toBe("GET");

      const postRes = await request(app, "/multi", { method: "POST" });
      expect(await postRes.text()).toBe("POST");
    });
  });

  describe("dynamic routes", () => {
    it("extracts a single parameter", async () => {
      const app = createApp({ csrf: false });
      app.get("/user/:id", (ctx) => ctx.text(ctx.params["id"] ?? ""));
      const res = await request(app, "/user/42");
      expect(await res.text()).toBe("42");
    });

    it("extracts multiple parameters", async () => {
      const app = createApp({ csrf: false });
      app.get("/user/:userId/post/:postId", (ctx) =>
        ctx.json({
          userId: ctx.params["userId"],
          postId: ctx.params["postId"],
        }),
      );
      const res = await request(app, "/user/1/post/99");
      expect(await res.json()).toEqual({ userId: "1", postId: "99" });
    });

    it("decodes URI-encoded parameters", async () => {
      const app = createApp({ csrf: false });
      app.get("/search/:query", (ctx) => ctx.text(ctx.params["query"] ?? ""));
      const res = await request(app, "/search/hello%20world");
      expect(await res.text()).toBe("hello world");
    });

    it("throws on duplicate parameter names", () => {
      const app = createApp({ csrf: false });
      expect(() => {
        app.get("/user/:id/post/:id", ok);
      }).toThrow("Duplicate parameter name");
    });
  });

  describe("HTTP methods", () => {
    it("supports POST", async () => {
      const app = createApp({ csrf: false });
      app.post("/test", ok);
      const res = await request(app, "/test", { method: "POST" });
      expect(res.status).toBe(200);
    });

    it("supports PUT", async () => {
      const app = createApp({ csrf: false });
      app.put("/test", ok);
      const res = await request(app, "/test", { method: "PUT" });
      expect(res.status).toBe(200);
    });

    it("supports DELETE", async () => {
      const app = createApp({ csrf: false });
      app.delete("/test", ok);
      const res = await request(app, "/test", { method: "DELETE" });
      expect(res.status).toBe(200);
    });

    it("supports PATCH", async () => {
      const app = createApp({ csrf: false });
      app.patch("/test", ok);
      const res = await request(app, "/test", { method: "PATCH" });
      expect(res.status).toBe(200);
    });

    it("supports HEAD", async () => {
      const app = createApp({ csrf: false });
      app.head("/test", ok);
      const res = await request(app, "/test", { method: "HEAD" });
      expect(res.status).toBe(200);
    });

    it("supports OPTIONS", async () => {
      const app = createApp({ csrf: false });
      app.options("/test", ok);
      const res = await request(app, "/test", { method: "OPTIONS" });
      expect(res.status).toBe(200);
    });
  });

  describe("error handling", () => {
    it("returns 500 for thrown errors", async () => {
      const app = createApp({ csrf: false });
      app.get("/error", () => {
        throw new Error("boom");
      });
      const res = await request(app, "/error");
      expect(res.status).toBe(500);
    });

    it("uses custom error handler", async () => {
      const app = createApp({ csrf: false });
      app.onError(() => new Response("custom error", { status: 503 }));
      app.get("/error", () => {
        throw new Error("boom");
      });
      const res = await request(app, "/error");
      expect(res.status).toBe(503);
      expect(await res.text()).toBe("custom error");
    });

    it("returns HttpError status", async () => {
      const app = createApp({ csrf: false });
      app.get("/not-found", () => {
        throw new HttpError(404, "resource not found");
      });
      const res = await request(app, "/not-found");
      expect(res.status).toBe(404);
      expect(await res.text()).toBe("resource not found");
    });

    it("catches failing error handler", async () => {
      const app = createApp({ csrf: false });
      app.onError(() => {
        throw new Error("handler also failed");
      });
      app.get("/error", () => {
        throw new Error("boom");
      });
      const res = await request(app, "/error");
      expect(res.status).toBe(500);
    });
  });

  describe("page rendering", () => {
    const simplePage: PageHandler = () =>
      createElement("h1", null, "Hello Page");

    it("renders a page as HTML", async () => {
      const app = createApp({ csrf: false });
      app.page("/hello", simplePage);
      const res = await request(app, "/hello");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("text/html; charset=UTF-8");
      expect(await res.text()).toBe("<h1>Hello Page</h1>");
    });

    it("applies layout to page", async () => {
      const app = createApp({ csrf: false });
      const layout: LayoutHandler = (_ctx, children) =>
        createElement("html", null, createElement("body", null, children));
      app.page("/hello", simplePage, [layout]);
      const res = await request(app, "/hello");
      const html = await res.text();
      expect(html).toBe("<html><body><h1>Hello Page</h1></body></html>");
    });

    it("applies nested layouts parent-to-child", async () => {
      const app = createApp({ csrf: false });
      const rootLayout: LayoutHandler = (_ctx, children) =>
        createElement("html", null, children);
      const innerLayout: LayoutHandler = (_ctx, children) =>
        createElement("main", null, children);
      app.page("/hello", simplePage, [rootLayout, innerLayout]);
      const res = await request(app, "/hello");
      const html = await res.text();
      expect(html).toBe("<html><main><h1>Hello Page</h1></main></html>");
    });

    it("prepends DOCTYPE when doctype flag is true", async () => {
      const app = createApp({ csrf: false });
      const layout: LayoutHandler = (_ctx, children) =>
        createElement("html", null, children);
      app.page("/hello", simplePage, [layout], [], true);
      const res = await request(app, "/hello");
      const html = await res.text();
      expect(html).toMatch(/^<!DOCTYPE html>\n<html>/);
    });

    it("does not prepend DOCTYPE when flag is false", async () => {
      const app = createApp({ csrf: false });
      app.page("/hello", simplePage, [], [], false);
      const res = await request(app, "/hello");
      const html = await res.text();
      expect(html).not.toContain("<!DOCTYPE");
    });

    it("registers page as GET method", async () => {
      const app = createApp({ csrf: false });
      app.page("/hello", simplePage);
      const res = await request(app, "/hello", { method: "POST" });
      expect(res.status).toBe(405);
    });

    it("applies middleware to page", async () => {
      const app = createApp({ csrf: false });
      let middlewareRan = false;
      app.page(
        "/hello",
        simplePage,
        [],
        [
          async (_ctx, next) => {
            middlewareRan = true;
            return await next();
          },
        ],
      );
      await request(app, "/hello");
      expect(middlewareRan).toBe(true);
    });

    it("supports dynamic params in pages", async () => {
      const app = createApp({ csrf: false });
      const userPage: PageHandler = (ctx) =>
        createElement("h1", null, `User ${ctx.params["id"]}`);
      app.page("/user/:id", userPage);
      const res = await request(app, "/user/42");
      expect(await res.text()).toBe("<h1>User 42</h1>");
    });

    it("supports async page handlers", async () => {
      const app = createApp({ csrf: false });
      const asyncPage: PageHandler = async () =>
        createElement("h1", null, "Async");
      app.page("/async", asyncPage);
      const res = await request(app, "/async");
      expect(await res.text()).toBe("<h1>Async</h1>");
    });

    it("supports async layout handlers", async () => {
      const app = createApp({ csrf: false });
      const asyncLayout: LayoutHandler = async (_ctx, children) =>
        createElement("div", null, children);
      app.page("/hello", simplePage, [asyncLayout]);
      const res = await request(app, "/hello");
      expect(await res.text()).toBe("<div><h1>Hello Page</h1></div>");
    });

    it("reports layout depth on layout error", async () => {
      const app = createApp({ csrf: false });
      const goodLayout: LayoutHandler = (_ctx, children) =>
        createElement("html", null, children);
      const badLayout: LayoutHandler = () => {
        throw new Error("broken layout");
      };
      app.page("/hello", simplePage, [goodLayout, badLayout]);
      const res = await request(app, "/hello");
      expect(res.status).toBe(500);
    });

    it("includes depth info in layout error message", async () => {
      const app = createApp({ csrf: false });
      const badLayout: LayoutHandler = () => {
        throw new Error("broken");
      };
      const errors: unknown[] = [];
      app.onError((error) => {
        errors.push(error);
        return new Response("error", { status: 500 });
      });
      app.page("/hello", simplePage, [badLayout]);
      await request(app, "/hello");
      expect(errors).toHaveLength(1);
      const err = errors[0] as Error;
      expect(err.message).toContain("Layout error at depth 1/1");
      expect(err.message).toContain("/hello");
      expect(err.cause).toBeInstanceOf(Error);
      expect((err.cause as Error).message).toBe("broken");
    });

    it("identifies correct depth in nested layout error", async () => {
      const app = createApp({ csrf: false });
      const outerLayout: LayoutHandler = (_ctx, children) =>
        createElement("html", null, children);
      const innerLayout: LayoutHandler = () => {
        throw new Error("inner broken");
      };
      const errors: unknown[] = [];
      app.onError((error) => {
        errors.push(error);
        return new Response("error", { status: 500 });
      });
      app.page("/hello", simplePage, [outerLayout, innerLayout]);
      await request(app, "/hello");
      expect(errors).toHaveLength(1);
      const err = errors[0] as Error;
      expect(err.message).toContain("Layout error at depth 1/2");
      expect((err.cause as Error).message).toBe("inner broken");
    });
  });

  describe("HEAD fallback to GET", () => {
    it("falls back to GET handler for HEAD requests", async () => {
      const app = createApp({ csrf: false });
      app.get("/resource", (ctx) => ctx.json({ ok: true }));
      const res = await request(app, "/resource", { method: "HEAD" });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe(
        "application/json; charset=UTF-8",
      );
    });

    it("returns empty body for HEAD fallback", async () => {
      const app = createApp({ csrf: false });
      app.get("/resource", (ctx) => ctx.text("hello"));
      const res = await request(app, "/resource", { method: "HEAD" });
      expect(await res.text()).toBe("");
    });

    it("prefers explicit HEAD handler over GET", async () => {
      const app = createApp({ csrf: false });
      app.get("/resource", (ctx) => ctx.text("get"));
      app.head("/resource", () => {
        return new Response(null, {
          status: 204,
          headers: { "x-head": "explicit" },
        });
      });
      const res = await request(app, "/resource", { method: "HEAD" });
      expect(res.status).toBe(204);
      expect(res.headers.get("x-head")).toBe("explicit");
    });

    it("returns 405 for HEAD when no GET exists", async () => {
      const app = createApp({ csrf: false });
      app.post("/only-post", (ctx) => ctx.text("post"));
      const res = await request(app, "/only-post", { method: "HEAD" });
      expect(res.status).toBe(405);
    });

    it("works with dynamic routes", async () => {
      const app = createApp({ csrf: false });
      app.get("/user/:id", (ctx) => ctx.json({ id: ctx.params["id"] }));
      const res = await request(app, "/user/42", { method: "HEAD" });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe(
        "application/json; charset=UTF-8",
      );
      expect(await res.text()).toBe("");
    });
  });
});
