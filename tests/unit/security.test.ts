import { describe, expect, it } from "vitest";
import type { Handler } from "../../src/framework";
import { createApp, request } from "../helpers/app";

const ok: Handler = (ctx) => ctx.text("ok");

describe("Security", () => {
  describe("default security headers", () => {
    it("adds security headers to responses", async () => {
      const app = createApp({ csrf: false });
      app.get("/", ok);
      const res = await request(app, "/");
      expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(res.headers.get("X-Frame-Options")).toBe("DENY");
      expect(res.headers.get("Referrer-Policy")).toBe(
        "strict-origin-when-cross-origin",
      );
      expect(res.headers.get("X-XSS-Protection")).toBe("0");
    });

    it("allows disabling security headers", async () => {
      const app = createApp({
        csrf: false,
        securityHeaders: false,
      });
      app.get("/", ok);
      const res = await request(app, "/");
      expect(res.headers.get("X-Content-Type-Options")).toBeNull();
    });

    it("allows custom security headers", async () => {
      const app = createApp({
        csrf: false,
        securityHeaders: { "X-Custom": "value" },
      });
      app.get("/", ok);
      const res = await request(app, "/");
      expect(res.headers.get("X-Custom")).toBe("value");
      expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    });

    it("does not overwrite response-set headers", async () => {
      const app = createApp({ csrf: false });
      app.get(
        "/",
        () =>
          new Response("ok", {
            headers: { "X-Frame-Options": "SAMEORIGIN" },
          }),
      );
      const res = await request(app, "/");
      expect(res.headers.get("X-Frame-Options")).toBe("SAMEORIGIN");
    });
  });

  describe("CSRF protection", () => {
    it("is enabled by default", async () => {
      const app = createApp();
      app.post("/submit", ok);
      const res = await request(app, "/submit", {
        method: "POST",
        headers: { Origin: "https://evil.com" },
      });
      expect(res.status).toBe(403);
    });

    it("allows same-origin POST", async () => {
      const app = createApp();
      app.post("/submit", ok);
      const res = await request(app, "/submit", {
        method: "POST",
        headers: { Origin: "http://localhost" },
      });
      expect(res.status).toBe(200);
    });

    it("allows GET requests regardless of origin", async () => {
      const app = createApp();
      app.get("/data", ok);
      const res = await request(app, "/data", {
        headers: { Origin: "https://other.com" },
      });
      expect(res.status).toBe(200);
    });

    it("can be disabled", async () => {
      const app = createApp({ csrf: false });
      app.post("/submit", ok);
      const res = await request(app, "/submit", {
        method: "POST",
        headers: { Origin: "https://evil.com" },
      });
      expect(res.status).toBe(200);
    });

    it("checks Referer when Origin is absent", async () => {
      const app = createApp();
      app.post("/submit", ok);
      const res = await request(app, "/submit", {
        method: "POST",
        headers: { Referer: "https://evil.com/page" },
      });
      expect(res.status).toBe(403);
    });

    it("blocks PUT from different origin", async () => {
      const app = createApp();
      app.put("/update", ok);
      const res = await request(app, "/update", {
        method: "PUT",
        headers: { Origin: "https://evil.com" },
      });
      expect(res.status).toBe(403);
    });

    it("blocks DELETE from different origin", async () => {
      const app = createApp();
      app.delete("/remove", ok);
      const res = await request(app, "/remove", {
        method: "DELETE",
        headers: { Origin: "https://evil.com" },
      });
      expect(res.status).toBe(403);
    });

    it("allows POST without Origin or Referer", async () => {
      const app = createApp();
      app.post("/submit", ok);
      const res = await request(app, "/submit", { method: "POST" });
      expect(res.status).toBe(200);
    });
  });
});
