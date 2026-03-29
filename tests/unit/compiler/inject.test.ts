import { describe, expect, it } from "vitest";
import type { ScriptDescriptor } from "../../../src/framework/compiler/inject";
import { injectScripts } from "../../../src/framework/compiler/inject";

describe("injectScripts", () => {
  it("returns html unchanged when scripts array is empty", () => {
    const html = "<html><body><p>Hello</p></body></html>";
    expect(injectScripts(html, [])).toBe(html);
  });

  it("injects a single script before </body>", () => {
    const html = "<html><body><p>Hello</p></body></html>";
    const scripts: ScriptDescriptor[] = [{ src: "/_rain/island-abc.js" }];
    const result = injectScripts(html, scripts);
    expect(result).toContain(
      '<script type="module" src="/_rain/island-abc.js"></script>',
    );
    expect(result.indexOf("</script>")).toBeLessThan(result.indexOf("</body>"));
  });

  it("injects multiple scripts before </body>", () => {
    const html = "<html><body></body></html>";
    const scripts: ScriptDescriptor[] = [
      { src: "/_rain/island-a.js" },
      { src: "/_rain/island-b.js" },
    ];
    const result = injectScripts(html, scripts);
    expect(result).toContain("island-a.js");
    expect(result).toContain("island-b.js");
  });

  it("includes nonce attribute when provided", () => {
    const html = "<html><body></body></html>";
    const scripts: ScriptDescriptor[] = [
      { src: "/_rain/island.js", nonce: "abc123" },
    ];
    const result = injectScripts(html, scripts);
    expect(result).toContain('nonce="abc123"');
  });

  it("escapes src attribute to prevent XSS", () => {
    const html = "<html><body></body></html>";
    const scripts: ScriptDescriptor[] = [{ src: '"><img onerror=alert(1)>' }];
    const result = injectScripts(html, scripts);
    expect(result).not.toContain('src=""><img');
    expect(result).toContain("&quot;");
    expect(result).toContain("&gt;");
  });

  it("escapes nonce attribute", () => {
    const html = "<html><body></body></html>";
    const scripts: ScriptDescriptor[] = [
      { src: "/test.js", nonce: '"><script>alert(1)</script>' },
    ];
    const result = injectScripts(html, scripts);
    expect(result).not.toContain("<script>alert(1)");
    expect(result).toContain("&lt;script&gt;");
  });

  it("appends to end when no </body> tag exists", () => {
    const html = "<div>content</div>";
    const scripts: ScriptDescriptor[] = [{ src: "/_rain/island.js" }];
    const result = injectScripts(html, scripts);
    expect(result).toContain("<div>content</div>");
    expect(result).toContain("island.js");
  });
});
