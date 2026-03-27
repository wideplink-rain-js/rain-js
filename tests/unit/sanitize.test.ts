import { describe, expect, it } from "vitest";

const { stripControlChars } = await import("../../cli/utils/sanitize");

describe("stripControlChars", () => {
  it("returns normal ASCII string unchanged", () => {
    expect(stripControlChars("hello world")).toBe("hello world");
  });

  it("strips NULL byte", () => {
    expect(stripControlChars("hello\x00world")).toBe("helloworld");
  });

  it("strips bell character", () => {
    expect(stripControlChars("hello\x07world")).toBe("helloworld");
  });

  it("strips escape character", () => {
    expect(stripControlChars("hello\x1bworld")).toBe("helloworld");
  });

  it("strips DEL character", () => {
    expect(stripControlChars("hello\x7fworld")).toBe("helloworld");
  });

  it("preserves tab, newline, and carriage return", () => {
    expect(stripControlChars("hello\tworld\nfoo\rbar")).toBe(
      "hello\tworld\nfoo\rbar",
    );
  });

  it("strips only control chars from mixed string", () => {
    expect(stripControlChars("a\x00b\x07c\x1bd\x7fe")).toBe("abcde");
  });

  it("returns empty string for empty input", () => {
    expect(stripControlChars("")).toBe("");
  });

  it("returns empty string for non-string input", () => {
    expect(stripControlChars(undefined)).toBe("");
    expect(stripControlChars(null)).toBe("");
    expect(stripControlChars(42)).toBe("");
  });

  it("returns Japanese string unchanged", () => {
    expect(stripControlChars("こんにちは世界")).toBe("こんにちは世界");
  });
});
