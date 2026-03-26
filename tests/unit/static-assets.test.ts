import { describe, expect, it } from "vitest";
import { createApp } from "../helpers/app";

function createMockAssets(
  files: Record<string, { body: string; contentType: string }>,
) {
  return {
    fetch: (request: Request) => {
      const url = new URL(request.url);
      const file = files[url.pathname];
      if (!file) {
        return new Response("Not Found", { status: 404 });
      }
      return new Response(file.body, {
        status: 200,
        headers: { "content-type": file.contentType },
      });
    },
  };
}

function requestWithAssets(
  app: ReturnType<typeof createApp>,
  path: string,
  assets: ReturnType<typeof createMockAssets>,
  init?: RequestInit,
): Promise<Response> {
  const env = { ASSETS: assets } as unknown as Env;
  return app.fetch(new Request(`http://localhost${path}`, init), env);
}

describe("Static Asset Serving", () => {
  const assets = createMockAssets({
    "/style.css": {
      body: "body { color: red; }",
      contentType: "text/css",
    },
    "/app.js": {
      body: "console.log('hello');",
      contentType: "application/javascript",
    },
    "/favicon.ico": {
      body: "icon-data",
      contentType: "image/x-icon",
    },
  });

  it("serves a static CSS file when no route matches", async () => {
    const app = createApp({ csrf: false });
    const res = await requestWithAssets(app, "/style.css", assets);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("body { color: red; }");
    expect(res.headers.get("content-type")).toBe("text/css");
  });

  it("serves a static JS file when no route matches", async () => {
    const app = createApp({ csrf: false });
    const res = await requestWithAssets(app, "/app.js", assets);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("console.log('hello');");
  });

  it("returns 404 when no route and no static file matches", async () => {
    const app = createApp({ csrf: false });
    const res = await requestWithAssets(app, "/nonexistent.txt", assets);
    expect(res.status).toBe(404);
  });

  it("route handlers take priority over static files", async () => {
    const app = createApp({ csrf: false });
    app.get("/style.css", (ctx) => ctx.text("dynamic"));
    const res = await requestWithAssets(app, "/style.css", assets);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("dynamic");
  });

  it("does not serve static files for POST requests", async () => {
    const app = createApp({ csrf: false });
    const res = await requestWithAssets(app, "/style.css", assets, {
      method: "POST",
    });
    expect(res.status).toBe(404);
  });

  it("serves static files for HEAD requests", async () => {
    const app = createApp({ csrf: false });
    const res = await requestWithAssets(app, "/style.css", assets, {
      method: "HEAD",
    });
    expect(res.status).toBe(200);
  });

  it("works without ASSETS binding (returns 404)", async () => {
    const app = createApp({ csrf: false });
    const res = await app.fetch(new Request("http://localhost/style.css"));
    expect(res.status).toBe(404);
  });

  it("applies security headers to static file responses", async () => {
    const app = createApp({ csrf: false });
    const res = await requestWithAssets(app, "/style.css", assets);
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
  });

  it("handles ASSETS.fetch throwing an error", async () => {
    const brokenAssets = {
      fetch: () => {
        throw new Error("Asset fetch failed");
      },
    };
    const app = createApp({ csrf: false });
    const res = await requestWithAssets(app, "/style.css", brokenAssets);
    expect(res.status).toBe(404);
  });
});
