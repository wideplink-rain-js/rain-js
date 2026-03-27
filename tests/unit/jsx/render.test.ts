import { describe, expect, it } from "vitest";
import {
  createElement,
  Fragment,
  renderToString,
} from "../../../src/framework/jsx";

describe("renderToString", () => {
  it("renders a simple element", () => {
    const el = createElement("div", null, "hello");
    expect(renderToString(el)).toBe("<div>hello</div>");
  });

  it("renders attributes", () => {
    const el = createElement("a", { href: "/test" }, "link");
    expect(renderToString(el)).toBe('<a href="/test">link</a>');
  });

  it("renders className as class", () => {
    const el = createElement("div", { className: "box" });
    expect(renderToString(el)).toBe('<div class="box"></div>');
  });

  it("renders void elements", () => {
    const el = createElement("br", null);
    expect(renderToString(el)).toBe("<br>");
  });

  it("renders void elements with attributes", () => {
    const el = createElement("img", { src: "/logo.png", alt: "logo" });
    expect(renderToString(el)).toBe('<img src="/logo.png" alt="logo">');
  });

  it("renders boolean attributes", () => {
    const el = createElement("input", {
      disabled: true,
      type: "text",
    });
    expect(renderToString(el)).toBe('<input disabled type="text">');
  });

  it("omits false boolean attributes", () => {
    const el = createElement("input", {
      disabled: false,
      type: "text",
    });
    expect(renderToString(el)).toBe('<input type="text">');
  });

  it("renders style objects", () => {
    const el = createElement("div", {
      style: { backgroundColor: "red", fontSize: 16 },
    });
    expect(renderToString(el)).toBe(
      '<div style="background-color:red;font-size:16px"></div>',
    );
  });

  it("renders nested elements", () => {
    const el = createElement("div", null, createElement("span", null, "inner"));
    expect(renderToString(el)).toBe("<div><span>inner</span></div>");
  });

  it("renders fragments", () => {
    const el = createElement(
      Fragment,
      null,
      createElement("li", null, "a"),
      createElement("li", null, "b"),
    );
    expect(renderToString(el)).toBe("<li>a</li><li>b</li>");
  });

  it("escapes text content", () => {
    const el = createElement("div", null, "<script>alert(1)</script>");
    expect(renderToString(el)).toBe(
      "<div>&lt;script&gt;alert(1)&lt;/script&gt;</div>",
    );
  });

  it("escapes attribute values", () => {
    const el = createElement("a", { href: '"><script>' });
    expect(renderToString(el)).toBe('<a href="&quot;&gt;&lt;script&gt;"></a>');
  });

  it("renders dangerouslySetInnerHTML", () => {
    const el = createElement("div", {
      dangerouslySetInnerHTML: { __html: "<b>raw</b>" },
    });
    expect(renderToString(el)).toBe("<div><b>raw</b></div>");
  });

  it("renders components", () => {
    const Greeting = (props: Record<string, unknown>) =>
      createElement("h1", null, `Hello ${String(props["name"])}`);
    const el = createElement(Greeting, { name: "World" });
    expect(renderToString(el)).toBe("<h1>Hello World</h1>");
  });

  it("skips null and undefined children", () => {
    const el = createElement("div", null, null, "text", undefined);
    expect(renderToString(el)).toBe("<div>text</div>");
  });

  it("skips boolean children", () => {
    const el = createElement("div", null, true, "text", false);
    expect(renderToString(el)).toBe("<div>text</div>");
  });

  it("renders number children", () => {
    const el = createElement("span", null, 42);
    expect(renderToString(el)).toBe("<span>42</span>");
  });

  it("omits null and undefined attributes", () => {
    const el = createElement("div", {
      id: "test",
      className: null,
      title: undefined,
    });
    expect(renderToString(el)).toBe('<div id="test"></div>');
  });

  it("does not escape text inside script tags", () => {
    const el = createElement(
      "script",
      null,
      "const fn = (x) => x + 1;",
    );
    expect(renderToString(el)).toBe(
      "<script>const fn = (x) => x + 1;</script>",
    );
  });

  it("does not escape text inside style tags", () => {
    const el = createElement(
      "style",
      null,
      "div > p { color: red; }",
    );
    expect(renderToString(el)).toBe(
      "<style>div > p { color: red; }</style>",
    );
  });

  it("renders script with attributes", () => {
    const el = createElement(
      "script",
      { type: "module" },
      'import { foo } from "./bar.js";',
    );
    expect(renderToString(el)).toBe(
      '<script type="module">import { foo } from "./bar.js";</script>',
    );
  });

  it("sanitizes closing tag injection in script", () => {
    const el = createElement(
      "script",
      null,
      '</script><script>alert(1)</script><script>',
    );
    expect(renderToString(el)).not.toContain("</script><script>");
    expect(renderToString(el)).toBe(
      "<script><\\/script><script>alert(1)<\\/script><script></script>",
    );
  });

  it("sanitizes closing tag injection in style", () => {
    const el = createElement(
      "style",
      null,
      "</style><script>alert(1)</script><style>",
    );
    expect(renderToString(el)).not.toContain("</style><script>");
    expect(renderToString(el)).toBe(
      "<style><\\/style><script>alert(1)</script><style></style>",
    );
  });

  it("handles template literals in script", () => {
    const code = `
  const fn = (x) => x + 1;
  const s = 'hello';
  if (x > 0 && y < 10) {}
`;
    const el = createElement("script", null, code);
    expect(renderToString(el)).toBe(`<script>${code}</script>`);
  });

  it("still escapes text in normal elements", () => {
    const el = createElement("div", null, "<script>alert(1)</script>");
    expect(renderToString(el)).toBe(
      "<div>&lt;script&gt;alert(1)&lt;/script&gt;</div>",
    );
  });
});
