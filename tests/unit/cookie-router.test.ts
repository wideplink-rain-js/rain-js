import { describe, expect, it } from "vitest";
import type { Handler } from "../../src/framework";
import { createApp, request } from "../helpers/app";

describe("Router cookie integration", () => {
  it("attaches Set-Cookie headers from ctx.setCookie", async () => {
    const app = createApp({ csrf: false });
    const handler: Handler = (ctx) => {
      ctx.setCookie("token", "abc123", { maxAge: 3600 });
      return ctx.text("ok");
    };
    app.get("/test", handler);

    const res = await request(app, "/test");
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("Set-Cookie");
    expect(setCookie).toContain("token=abc123");
    expect(setCookie).toContain("Max-Age=3600");
  });

  it("attaches multiple Set-Cookie headers", async () => {
    const app = createApp({ csrf: false });
    const handler: Handler = (ctx) => {
      ctx.setCookie("a", "1");
      ctx.setCookie("b", "2");
      return ctx.text("ok");
    };
    app.get("/multi", handler);

    const res = await request(app, "/multi");
    const all = res.headers.getSetCookie();
    expect(all.length).toBe(2);
  });

  it("does not modify response when no cookies set", async () => {
    const app = createApp({ csrf: false });
    const handler: Handler = (ctx) => {
      return ctx.text("ok");
    };
    app.get("/no-cookie", handler);

    const res = await request(app, "/no-cookie");
    expect(res.headers.has("Set-Cookie")).toBe(false);
  });
});
