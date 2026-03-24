import { describe, expect, it } from "vitest";
import type { CorsOptions } from "../../../src/framework/middleware/cors";
import { cors } from "../../../src/framework/middleware/cors";
import { createApp, request } from "../../helpers/app";

function corsRequest(
  app: ReturnType<typeof createApp>,
  path: string,
  origin: string,
  init?: RequestInit,
): Promise<Response> {
  return request(app, path, {
    ...init,
    headers: { Origin: origin, ...init?.headers },
  });
}

function preflightRequest(
  app: ReturnType<typeof createApp>,
  path: string,
  origin: string,
  requestMethod: string,
  requestHeaders?: string,
): Promise<Response> {
  const headers: Record<string, string> = {
    Origin: origin,
    "Access-Control-Request-Method": requestMethod,
  };
  if (requestHeaders) {
    headers["Access-Control-Request-Headers"] = requestHeaders;
  }
  return request(app, path, { method: "OPTIONS", headers });
}

function setupApp(options: CorsOptions) {
  const app = createApp({ csrf: false });
  app.use(cors(options));
  app.get("/", (ctx) => ctx.text("ok"));
  app.post("/", (ctx) => ctx.text("posted"));
  return app;
}

describe("CORS Middleware", () => {
  describe("origin validation", () => {
    it("allows matching string origin", async () => {
      const app = setupApp({ origin: "https://example.com" });
      const res = await corsRequest(app, "/", "https://example.com");
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
        "https://example.com",
      );
    });

    it("rejects non-matching string origin", async () => {
      const app = setupApp({ origin: "https://example.com" });
      const res = await corsRequest(app, "/", "https://evil.com");
      expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    });

    it("allows matching origin from array", async () => {
      const app = setupApp({
        origin: ["https://a.com", "https://b.com"],
      });
      const res = await corsRequest(app, "/", "https://b.com");
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
        "https://b.com",
      );
    });

    it("rejects non-matching origin from array", async () => {
      const app = setupApp({
        origin: ["https://a.com", "https://b.com"],
      });
      const res = await corsRequest(app, "/", "https://evil.com");
      expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    });

    it("allows wildcard origin", async () => {
      const app = setupApp({ origin: "*" });
      const res = await corsRequest(app, "/", "https://anything.com");
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    });

    it("allows origin via function", async () => {
      const app = setupApp({
        origin: (o) => o.endsWith(".example.com"),
      });
      const res = await corsRequest(app, "/", "https://sub.example.com");
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
        "https://sub.example.com",
      );
    });

    it("rejects origin via function returning false", async () => {
      const app = setupApp({
        origin: (o) => o.endsWith(".example.com"),
      });
      const res = await corsRequest(app, "/", "https://evil.com");
      expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    });
  });

  describe("no Origin header", () => {
    it("passes through without CORS headers", async () => {
      const app = setupApp({ origin: "*" });
      const res = await request(app, "/");
      expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
      expect(await res.text()).toBe("ok");
    });
  });

  describe("preflight (OPTIONS)", () => {
    it("returns 204 for valid preflight", async () => {
      const app = setupApp({ origin: "https://example.com" });
      const res = await preflightRequest(
        app,
        "/",
        "https://example.com",
        "POST",
      );
      expect(res.status).toBe(204);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
        "https://example.com",
      );
    });

    it("includes default methods in preflight", async () => {
      const app = setupApp({ origin: "https://example.com" });
      const res = await preflightRequest(
        app,
        "/",
        "https://example.com",
        "GET",
      );
      expect(res.headers.get("Access-Control-Allow-Methods")).toBe(
        "GET, HEAD, POST",
      );
    });

    it("includes custom methods in preflight", async () => {
      const app = setupApp({
        origin: "https://example.com",
        methods: ["GET", "PUT", "DELETE"],
      });
      const res = await preflightRequest(
        app,
        "/",
        "https://example.com",
        "PUT",
      );
      expect(res.headers.get("Access-Control-Allow-Methods")).toBe(
        "GET, PUT, DELETE",
      );
    });

    it("reflects request headers when allowHeaders not set", async () => {
      const app = setupApp({ origin: "https://example.com" });
      const res = await preflightRequest(
        app,
        "/",
        "https://example.com",
        "POST",
        "Authorization, Content-Type",
      );
      expect(res.headers.get("Access-Control-Allow-Headers")).toBe(
        "Authorization, Content-Type",
      );
    });

    it("uses explicit allowHeaders", async () => {
      const app = setupApp({
        origin: "https://example.com",
        allowHeaders: ["X-Custom"],
      });
      const res = await preflightRequest(
        app,
        "/",
        "https://example.com",
        "POST",
        "Authorization",
      );
      expect(res.headers.get("Access-Control-Allow-Headers")).toBe("X-Custom");
    });

    it("sets Max-Age with default value", async () => {
      const app = setupApp({ origin: "https://example.com" });
      const res = await preflightRequest(
        app,
        "/",
        "https://example.com",
        "POST",
      );
      expect(res.headers.get("Access-Control-Max-Age")).toBe("86400");
    });

    it("sets custom Max-Age", async () => {
      const app = setupApp({
        origin: "https://example.com",
        maxAge: 3600,
      });
      const res = await preflightRequest(
        app,
        "/",
        "https://example.com",
        "POST",
      );
      expect(res.headers.get("Access-Control-Max-Age")).toBe("3600");
    });

    it("rejects preflight from non-allowed origin", async () => {
      const app = setupApp({ origin: "https://example.com" });
      const res = await preflightRequest(app, "/", "https://evil.com", "POST");
      expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    });
  });

  describe("credentials", () => {
    it("sets credentials header when enabled", async () => {
      const app = setupApp({
        origin: "https://example.com",
        credentials: true,
      });
      const res = await corsRequest(app, "/", "https://example.com");
      expect(res.headers.get("Access-Control-Allow-Credentials")).toBe("true");
    });

    it("does not set credentials header by default", async () => {
      const app = setupApp({ origin: "https://example.com" });
      const res = await corsRequest(app, "/", "https://example.com");
      expect(res.headers.get("Access-Control-Allow-Credentials")).toBeNull();
    });

    it("throws on wildcard origin with credentials", () => {
      expect(() => cors({ origin: "*", credentials: true })).toThrow(
        "CORS misconfiguration",
      );
    });
  });

  describe("expose headers", () => {
    it("sets Expose-Headers", async () => {
      const app = setupApp({
        origin: "https://example.com",
        exposeHeaders: ["X-Request-Id", "X-Total-Count"],
      });
      const res = await corsRequest(app, "/", "https://example.com");
      expect(res.headers.get("Access-Control-Expose-Headers")).toBe(
        "X-Request-Id, X-Total-Count",
      );
    });

    it("does not set Expose-Headers by default", async () => {
      const app = setupApp({ origin: "https://example.com" });
      const res = await corsRequest(app, "/", "https://example.com");
      expect(res.headers.get("Access-Control-Expose-Headers")).toBeNull();
    });
  });

  describe("Vary header", () => {
    it("sets Vary: Origin for specific origin", async () => {
      const app = setupApp({ origin: "https://example.com" });
      const res = await corsRequest(app, "/", "https://example.com");
      expect(res.headers.get("Vary")).toContain("Origin");
    });

    it("does not set Vary for wildcard origin", async () => {
      const app = setupApp({ origin: "*" });
      const res = await corsRequest(app, "/", "https://example.com");
      const vary = res.headers.get("Vary");
      expect(vary === null || !vary.includes("Origin")).toBe(true);
    });
  });

  describe("actual request flow", () => {
    it("passes through handler response with CORS headers", async () => {
      const app = setupApp({ origin: "https://example.com" });
      const res = await corsRequest(app, "/", "https://example.com");
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("ok");
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
        "https://example.com",
      );
    });

    it("preserves existing response headers", async () => {
      const app = createApp({ csrf: false });
      app.use(cors({ origin: "https://example.com" }));
      app.get(
        "/",
        (_ctx) =>
          new Response("ok", {
            headers: { "X-Custom": "keep" },
          }),
      );
      const res = await corsRequest(app, "/", "https://example.com");
      expect(res.headers.get("X-Custom")).toBe("keep");
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
        "https://example.com",
      );
    });
  });

  describe("preflight credentials", () => {
    it("sets credentials on preflight", async () => {
      const app = setupApp({
        origin: "https://example.com",
        credentials: true,
      });
      const res = await preflightRequest(
        app,
        "/",
        "https://example.com",
        "POST",
      );
      expect(res.status).toBe(204);
      expect(res.headers.get("Access-Control-Allow-Credentials")).toBe("true");
    });
  });

  describe("405 Method Not Allowed with CORS", () => {
    it("adds CORS headers to 405 response", async () => {
      const app = createApp({ csrf: false });
      app.use(cors({ origin: "https://example.com" }));
      app.get("/only-get", (ctx) => ctx.text("ok"));

      const res = await corsRequest(app, "/only-get", "https://example.com", {
        method: "DELETE",
      });
      expect(res.status).toBe(405);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
        "https://example.com",
      );
    });

    it("omits CORS headers on 405 for disallowed origin", async () => {
      const app = createApp({ csrf: false });
      app.use(cors({ origin: "https://example.com" }));
      app.get("/only-get", (ctx) => ctx.text("ok"));

      const res = await corsRequest(app, "/only-get", "https://evil.com", {
        method: "DELETE",
      });
      expect(res.status).toBe(405);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    });

    it("handles preflight for path with limited methods", async () => {
      const app = createApp({ csrf: false });
      app.use(cors({ origin: "https://example.com" }));
      app.get("/only-get", (ctx) => ctx.text("ok"));

      const res = await preflightRequest(
        app,
        "/only-get",
        "https://example.com",
        "DELETE",
      );
      expect(res.status).toBe(204);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
        "https://example.com",
      );
    });

    it("includes credentials on 405 when configured", async () => {
      const app = createApp({ csrf: false });
      app.use(cors({ origin: "https://example.com", credentials: true }));
      app.get("/only-get", (ctx) => ctx.text("ok"));

      const res = await corsRequest(app, "/only-get", "https://example.com", {
        method: "DELETE",
      });
      expect(res.status).toBe(405);
      expect(res.headers.get("Access-Control-Allow-Credentials")).toBe("true");
    });
  });
});
