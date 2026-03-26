import { describe, expect, it, vi } from "vitest";
import { Context } from "../../../src/framework";
import { getSession, session } from "../../../src/framework/middleware/session";

function createMockKv(): KVNamespace {
  const store = new Map<string, string>();
  return {
    get: vi.fn((key: string) => {
      const val = store.get(key);
      return Promise.resolve(val ? JSON.parse(val) : null);
    }),
    put: vi.fn((key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve();
    }),
    delete: vi.fn((key: string) => {
      store.delete(key);
      return Promise.resolve();
    }),
    list: vi.fn(),
    getWithMetadata: vi.fn(),
  } as unknown as KVNamespace;
}

function createCtx(
  cookieHeader?: string,
  env?: Record<string, unknown>,
): Context {
  const headers = new Headers();
  if (cookieHeader) {
    headers.set("cookie", cookieHeader);
  }
  return new Context(
    new Request("http://localhost/test", { headers }),
    {},
    (env ?? {}) as unknown as Env,
  );
}

describe("session middleware", () => {
  it("creates a new session", async () => {
    const kv = createMockKv();
    const mw = session({ kvBinding: "SESSIONS" });
    const ctx = createCtx(undefined, { SESSIONS: kv });

    const handler = vi.fn((handlerCtx: Context) => {
      const s = getSession(handlerCtx);
      s.set("user", "alice");
      return new Response("ok");
    });

    await mw(ctx, async () => handler(ctx));

    expect(handler).toHaveBeenCalled();
    expect(kv.put).toHaveBeenCalled();

    const pending = ctx.getPendingCookies();
    expect(pending.length).toBe(1);
    expect(pending[0]).toContain("__rain_session=");
  });

  it("loads an existing session", async () => {
    const kv = createMockKv();
    const sessionId = "a".repeat(64);

    await (
      kv as unknown as { put: (k: string, v: string) => Promise<void> }
    ).put(`session:${sessionId}`, JSON.stringify({ user: "bob" }));

    const mw = session({ kvBinding: "SESSIONS" });
    const ctx = createCtx(`__rain_session=${sessionId}`, { SESSIONS: kv });

    let userData: unknown;
    const handler = vi.fn((handlerCtx: Context) => {
      const s = getSession(handlerCtx);
      userData = s.get("user");
      return new Response("ok");
    });

    await mw(ctx, async () => handler(ctx));

    expect(userData).toBe("bob");
    expect(ctx.getPendingCookies().length).toBe(0);
  });

  it("throws when KV binding is missing", async () => {
    const mw = session({ kvBinding: "SESSIONS" });
    const ctx = createCtx(undefined, {});

    await expect(mw(ctx, async () => new Response("ok"))).rejects.toThrow(
      'KV binding "SESSIONS" not found',
    );
  });

  it("throws when session is not initialized", () => {
    const ctx = createCtx();
    expect(() => getSession(ctx)).toThrow("Session not found");
  });
});

describe("Session flash messages", () => {
  it("stores and retrieves a flash message", async () => {
    const kv = createMockKv();
    const mw = session({ kvBinding: "SESSIONS" });
    const ctx = createCtx(undefined, { SESSIONS: kv });

    let flashValue: unknown;
    await mw(ctx, () => {
      const s = getSession(ctx);
      s.flash("message", "Item created");
      flashValue = s.flash("message");
      return Promise.resolve(new Response("ok"));
    });

    expect(flashValue).toBe("Item created");
  });

  it("flash value is cleared after read", async () => {
    const kv = createMockKv();
    const mw = session({ kvBinding: "SESSIONS" });
    const ctx = createCtx(undefined, { SESSIONS: kv });

    let secondRead: unknown;
    await mw(ctx, () => {
      const s = getSession(ctx);
      s.flash("msg", "hello");
      s.flash("msg");
      secondRead = s.flash("msg");
      return Promise.resolve(new Response("ok"));
    });

    expect(secondRead).toBeUndefined();
  });
});
