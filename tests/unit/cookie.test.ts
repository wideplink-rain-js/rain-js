import { describe, expect, it } from "vitest";
import { parseCookies, serializeCookie } from "../../src/framework/cookie";

describe("parseCookies", () => {
  it("returns empty map for null header", () => {
    const cookies = parseCookies(null);
    expect(cookies.size).toBe(0);
  });

  it("parses a single cookie", () => {
    const cookies = parseCookies("name=value");
    expect(cookies.get("name")).toBe("value");
  });

  it("parses multiple cookies", () => {
    const cookies = parseCookies("a=1; b=2; c=3");
    expect(cookies.get("a")).toBe("1");
    expect(cookies.get("b")).toBe("2");
    expect(cookies.get("c")).toBe("3");
  });

  it("decodes URI-encoded values", () => {
    const cookies = parseCookies("name=hello%20world");
    expect(cookies.get("name")).toBe("hello world");
  });

  it("handles cookies with = in value", () => {
    const cookies = parseCookies("token=abc=def");
    expect(cookies.get("token")).toBe("abc=def");
  });

  it("trims whitespace", () => {
    const cookies = parseCookies("  name  =  value  ");
    expect(cookies.get("name")).toBe("value");
  });

  it("skips entries without =", () => {
    const cookies = parseCookies("invalid; name=value");
    expect(cookies.size).toBe(1);
    expect(cookies.get("name")).toBe("value");
  });
});

describe("serializeCookie", () => {
  it("serializes with secure defaults", () => {
    const result = serializeCookie("name", "value");
    expect(result).toContain("name=value");
    expect(result).toContain("HttpOnly");
    expect(result).toContain("Secure");
    expect(result).toContain("SameSite=Lax");
    expect(result).toContain("Path=/");
  });

  it("includes Max-Age when specified", () => {
    const result = serializeCookie("s", "v", { maxAge: 3600 });
    expect(result).toContain("Max-Age=3600");
  });

  it("includes Expires when specified", () => {
    const date = new Date("2026-12-31T00:00:00Z");
    const result = serializeCookie("s", "v", {
      expires: date,
    });
    expect(result).toContain(`Expires=${date.toUTCString()}`);
  });

  it("includes Domain when specified", () => {
    const result = serializeCookie("s", "v", {
      domain: "example.com",
    });
    expect(result).toContain("Domain=example.com");
  });

  it("URI-encodes the value", () => {
    const result = serializeCookie("name", "a&b");
    expect(result).toContain("name=a%26b");
  });

  it("throws for SameSite=None without Secure", () => {
    expect(() =>
      serializeCookie("s", "v", {
        sameSite: "None",
        secure: false,
      }),
    ).toThrow("SameSite=None must also set Secure=true");
  });

  it("throws for empty cookie name", () => {
    expect(() => serializeCookie("", "v")).toThrow(
      "Cookie name must not be empty",
    );
  });

  it("throws for invalid cookie name characters", () => {
    expect(() => serializeCookie("a b", "v")).toThrow("invalid characters");
  });

  it("allows SameSite=None with Secure", () => {
    const result = serializeCookie("s", "v", {
      sameSite: "None",
      secure: true,
    });
    expect(result).toContain("SameSite=None");
    expect(result).toContain("Secure");
  });

  it("can disable HttpOnly", () => {
    const result = serializeCookie("s", "v", {
      httpOnly: false,
    });
    expect(result).not.toContain("HttpOnly");
  });
});
