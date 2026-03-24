import { describe, expect, it } from "vitest";
import type { Middleware } from "../../src/framework";
import { createApp, request } from "../helpers/app";

describe("Middleware", () => {
  it("executes before handler", async () => {
    const app = createApp({ csrf: false });
    const order: string[] = [];

    const mw: Middleware = async (_ctx, next) => {
      order.push("mw:before");
      const res = await next();
      order.push("mw:after");
      return res;
    };

    app.use(mw);
    app.get("/", (ctx) => {
      order.push("handler");
      return ctx.text("ok");
    });

    await request(app, "/");
    expect(order).toEqual(["mw:before", "handler", "mw:after"]);
  });

  it("executes global middlewares in order", async () => {
    const app = createApp({ csrf: false });
    const order: string[] = [];

    const mw1: Middleware = async (_ctx, next) => {
      order.push("1:before");
      const res = await next();
      order.push("1:after");
      return res;
    };

    const mw2: Middleware = async (_ctx, next) => {
      order.push("2:before");
      const res = await next();
      order.push("2:after");
      return res;
    };

    app.use(mw1, mw2);
    app.get("/", (ctx) => {
      order.push("handler");
      return ctx.text("ok");
    });

    await request(app, "/");
    expect(order).toEqual([
      "1:before",
      "2:before",
      "handler",
      "2:after",
      "1:after",
    ]);
  });

  it("combines global and route middlewares", async () => {
    const app = createApp({ csrf: false });
    const order: string[] = [];

    const globalMw: Middleware = (_ctx, next) => {
      order.push("global");
      return next();
    };

    const routeMw: Middleware = (_ctx, next) => {
      order.push("route");
      return next();
    };

    app.use(globalMw);
    app.get(
      "/",
      (ctx) => {
        order.push("handler");
        return ctx.text("ok");
      },
      [routeMw],
    );

    await request(app, "/");
    expect(order).toEqual(["global", "route", "handler"]);
  });

  it("can modify the response", async () => {
    const app = createApp({ csrf: false });

    const addHeader: Middleware = async (_ctx, next) => {
      const res = await next();
      res.headers.set("X-Custom", "added");
      return res;
    };

    app.use(addHeader);
    app.get("/", (ctx) => ctx.text("ok"));

    const res = await request(app, "/");
    expect(res.headers.get("X-Custom")).toBe("added");
  });

  it("can short-circuit without calling next", async () => {
    const app = createApp({ csrf: false });

    const guard: Middleware = () => new Response("blocked", { status: 403 });

    app.use(guard);
    app.get("/", (ctx) => ctx.text("ok"));

    const res = await request(app, "/");
    expect(res.status).toBe(403);
    expect(await res.text()).toBe("blocked");
  });

  it("rejects multiple next() calls", async () => {
    const app = createApp({ csrf: false });

    const bad: Middleware = async (_ctx, next) => {
      await next();
      return next();
    };

    app.use(bad);
    app.get("/", (ctx) => ctx.text("ok"));

    const res = await request(app, "/");
    expect(res.status).toBe(500);
  });

  it("can access and modify state", async () => {
    const app = createApp({ csrf: false });

    const setter: Middleware = (ctx, next) => {
      ctx.state.set("userId", "42");
      return next();
    };

    app.use(setter);
    app.get("/", (ctx) => ctx.text(String(ctx.state.get("userId") ?? "")));

    const res = await request(app, "/");
    expect(await res.text()).toBe("42");
  });
});
