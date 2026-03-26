import { describe, expect, it } from "vitest";
import { Context, HttpError } from "../../src/framework";

describe("Context cookie methods", () => {
  function createCtx(cookieHeader?: string): Context {
    const headers = new Headers();
    if (cookieHeader) {
      headers.set("cookie", cookieHeader);
    }
    return new Context(new Request("http://localhost/test", { headers }), {});
  }

  describe("cookie()", () => {
    it("reads a cookie from the request", () => {
      const ctx = createCtx("session=abc123; theme=dark");
      expect(ctx.cookie("session")).toBe("abc123");
      expect(ctx.cookie("theme")).toBe("dark");
    });

    it("returns undefined for missing cookie", () => {
      const ctx = createCtx("session=abc123");
      expect(ctx.cookie("missing")).toBeUndefined();
    });

    it("returns undefined when no cookie header", () => {
      const ctx = createCtx();
      expect(ctx.cookie("any")).toBeUndefined();
    });
  });

  describe("setCookie()", () => {
    it("adds a pending cookie", () => {
      const ctx = createCtx();
      ctx.setCookie("name", "value");
      expect(ctx.getPendingCookies().length).toBe(1);
      expect(ctx.getPendingCookies()[0]).toContain("name=value");
    });

    it("sets secure defaults", () => {
      const ctx = createCtx();
      ctx.setCookie("name", "value");
      const cookie = ctx.getPendingCookies()[0] as string;
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toContain("Secure");
      expect(cookie).toContain("SameSite=Lax");
    });

    it("accumulates multiple cookies", () => {
      const ctx = createCtx();
      ctx.setCookie("a", "1");
      ctx.setCookie("b", "2");
      expect(ctx.getPendingCookies().length).toBe(2);
    });
  });

  describe("deleteCookie()", () => {
    it("sets Max-Age=0", () => {
      const ctx = createCtx();
      ctx.deleteCookie("name");
      const cookie = ctx.getPendingCookies()[0] as string;
      expect(cookie).toContain("Max-Age=0");
      expect(cookie).toContain("name=");
    });
  });
});

describe("Context parseJsonWith()", () => {
  function createJsonCtx(body: unknown): Context {
    return new Context(
      new Request("http://localhost/test", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      }),
      {},
    );
  }

  const stringSchema = {
    parse(data: unknown): { title: string } {
      const obj = data as Record<string, unknown>;
      if (
        typeof data === "object" &&
        data !== null &&
        "title" in data &&
        typeof obj["title"] === "string"
      ) {
        return { title: obj["title"] as string };
      }
      throw new Error("Validation failed: title required");
    },
  };

  it("returns validated data", async () => {
    const ctx = createJsonCtx({ title: "Test" });
    const result = await ctx.parseJsonWith(stringSchema);
    expect(result["title"]).toBe("Test");
  });

  it("throws 422 for invalid data", async () => {
    const ctx = createJsonCtx({ name: "wrong" });
    try {
      await ctx.parseJsonWith(stringSchema);
      expect.unreachable("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      expect((error as HttpError).status).toBe(422);
    }
  });
});

describe("Context parseFormDataWith()", () => {
  function createFormCtx(data: Record<string, string>): Context {
    const body = new URLSearchParams(data).toString();
    return new Context(
      new Request("http://localhost/test", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
        },
        body,
      }),
      {},
    );
  }

  const formSchema = {
    parse(data: unknown): { title: string } {
      const obj = data as Record<string, unknown>;
      if (typeof obj["title"] === "string") {
        return { title: obj["title"] };
      }
      throw new Error("title is required");
    },
  };

  it("returns validated form data", async () => {
    const ctx = createFormCtx({ title: "Hello" });
    const result = await ctx.parseFormDataWith(formSchema);
    expect(result["title"]).toBe("Hello");
  });

  it("throws 422 for invalid form data", async () => {
    const ctx = createFormCtx({ name: "wrong" });
    try {
      await ctx.parseFormDataWith(formSchema);
      expect.unreachable("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      expect((error as HttpError).status).toBe(422);
    }
  });
});
