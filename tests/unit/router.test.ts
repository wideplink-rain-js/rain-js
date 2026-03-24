import { describe, expect, it } from "vitest";
import type { Handler } from "../../src/framework";
import { HttpError } from "../../src/framework";
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
});
