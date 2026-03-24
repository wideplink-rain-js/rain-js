import { describe, expect, it } from "vitest";
import { Context, createElement } from "../../src/framework";

describe("Context", () => {
  function createCtx(
    url = "http://localhost/test?key=value",
    init?: RequestInit,
  ): Context {
    return new Context(new Request(url, init), {});
  }

  describe("getters", () => {
    it("returns the URL", () => {
      const ctx = createCtx();
      expect(ctx.url.pathname).toBe("/test");
    });

    it("returns the path", () => {
      const ctx = createCtx();
      expect(ctx.path).toBe("/test");
    });

    it("returns the method", () => {
      const ctx = createCtx("http://localhost/", { method: "POST" });
      expect(ctx.method).toBe("POST");
    });

    it("returns query params", () => {
      const ctx = createCtx();
      expect(ctx.query.get("key")).toBe("value");
    });

    it("returns a header", () => {
      const ctx = createCtx("http://localhost/", {
        headers: { "X-Custom": "test" },
      });
      expect(ctx.header("X-Custom")).toBe("test");
    });

    it("returns null for missing header", () => {
      const ctx = createCtx();
      expect(ctx.header("X-Missing")).toBeNull();
    });

    it("exposes params", () => {
      const ctx = new Context(new Request("http://localhost/"), { id: "42" });
      expect(ctx.params["id"]).toBe("42");
    });

    it("provides state map", () => {
      const ctx = createCtx();
      ctx.state.set("key", "value");
      expect(ctx.state.get("key")).toBe("value");
    });
  });

  describe("json()", () => {
    it("returns JSON response with correct headers", () => {
      const ctx = createCtx();
      const res = ctx.json({ hello: "world" });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe(
        "application/json; charset=UTF-8",
      );
    });

    it("serializes body correctly", async () => {
      const ctx = createCtx();
      const res = ctx.json({ a: 1 });
      expect(await res.json()).toEqual({ a: 1 });
    });

    it("accepts custom status", () => {
      const ctx = createCtx();
      const res = ctx.json({ error: "not found" }, 404);
      expect(res.status).toBe(404);
    });

    it("throws on non-serializable data", () => {
      const ctx = createCtx();
      const circular: Record<string, unknown> = {};
      circular["self"] = circular;
      expect(() => ctx.json(circular)).toThrow("ctx.json()");
    });
  });

  describe("html()", () => {
    it("returns HTML response with correct headers", () => {
      const ctx = createCtx();
      const res = ctx.html("<h1>Hello</h1>");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("text/html; charset=UTF-8");
    });

    it("accepts custom status", () => {
      const ctx = createCtx();
      const res = ctx.html("<p>Not Found</p>", 404);
      expect(res.status).toBe(404);
    });

    it("renders RainElement to HTML", async () => {
      const ctx = createCtx();
      const el = createElement("div", null, "test");
      const res = ctx.html(el);
      expect(await res.text()).toBe("<div>test</div>");
    });
  });

  describe("text()", () => {
    it("returns text response with correct headers", async () => {
      const ctx = createCtx();
      const res = ctx.text("hello");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("text/plain; charset=UTF-8");
      expect(await res.text()).toBe("hello");
    });
  });

  describe("redirect()", () => {
    it("redirects to a local path", () => {
      const ctx = createCtx();
      const res = ctx.redirect("/other");
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/other");
    });

    it("uses custom status code", () => {
      const ctx = createCtx();
      const res = ctx.redirect("/other", 301);
      expect(res.status).toBe(301);
    });

    it("blocks external redirects by default", () => {
      const ctx = createCtx();
      expect(() => ctx.redirect("https://evil.com")).toThrow("external URL");
    });

    it("allows external redirects when opted in", () => {
      const ctx = createCtx();
      const res = ctx.redirect("https://example.com", 302, {
        allowExternal: true,
      });
      expect(res.status).toBe(302);
    });
  });
});
