import { describe, expect, it } from "vitest";
import {
  createElement,
  Fragment,
  markAsIsland,
  markAsServerAction,
  renderToString,
} from "../../../src/framework/jsx";

describe("renderToString", () => {
  it("renders a simple element", () => {
    const el = createElement("div", null, "hello");
    expect(renderToString(el).html).toBe("<div>hello</div>");
  });

  it("renders attributes", () => {
    const el = createElement("a", { href: "/test" }, "link");
    expect(renderToString(el).html).toBe('<a href="/test">link</a>');
  });

  it("renders className as class", () => {
    const el = createElement("div", { className: "box" });
    expect(renderToString(el).html).toBe('<div class="box"></div>');
  });

  it("renders void elements", () => {
    const el = createElement("br", null);
    expect(renderToString(el).html).toBe("<br>");
  });

  it("renders void elements with attributes", () => {
    const el = createElement("img", { src: "/logo.png", alt: "logo" });
    expect(renderToString(el).html).toBe('<img src="/logo.png" alt="logo">');
  });

  it("renders boolean attributes", () => {
    const el = createElement("input", {
      disabled: true,
      type: "text",
    });
    expect(renderToString(el).html).toBe('<input disabled type="text">');
  });

  it("omits false boolean attributes", () => {
    const el = createElement("input", {
      disabled: false,
      type: "text",
    });
    expect(renderToString(el).html).toBe('<input type="text">');
  });

  it("renders style objects", () => {
    const el = createElement("div", {
      style: { backgroundColor: "red", fontSize: 16 },
    });
    expect(renderToString(el).html).toBe(
      '<div style="background-color:red;font-size:16px"></div>',
    );
  });

  it("renders nested elements", () => {
    const el = createElement("div", null, createElement("span", null, "inner"));
    expect(renderToString(el).html).toBe("<div><span>inner</span></div>");
  });

  it("renders fragments", () => {
    const el = createElement(
      Fragment,
      null,
      createElement("li", null, "a"),
      createElement("li", null, "b"),
    );
    expect(renderToString(el).html).toBe("<li>a</li><li>b</li>");
  });

  it("escapes text content", () => {
    const el = createElement("div", null, "<script>alert(1)</script>");
    expect(renderToString(el).html).toBe(
      "<div>&lt;script&gt;alert(1)&lt;/script&gt;</div>",
    );
  });

  it("escapes attribute values", () => {
    const el = createElement("a", { href: '"><script>' });
    expect(renderToString(el).html).toBe(
      '<a href="&quot;&gt;&lt;script&gt;"></a>',
    );
  });

  it("renders dangerouslySetInnerHTML", () => {
    const el = createElement("div", {
      dangerouslySetInnerHTML: { __html: "<b>raw</b>" },
    });
    expect(renderToString(el).html).toBe("<div><b>raw</b></div>");
  });

  it("renders components", () => {
    const Greeting = (props: Record<string, unknown>) =>
      createElement("h1", null, `Hello ${String(props["name"])}`);
    const el = createElement(Greeting, { name: "World" });
    expect(renderToString(el).html).toBe("<h1>Hello World</h1>");
  });

  it("skips null and undefined children", () => {
    const el = createElement("div", null, null, "text", undefined);
    expect(renderToString(el).html).toBe("<div>text</div>");
  });

  it("skips boolean children", () => {
    const el = createElement("div", null, true, "text", false);
    expect(renderToString(el).html).toBe("<div>text</div>");
  });

  it("renders number children", () => {
    const el = createElement("span", null, 42);
    expect(renderToString(el).html).toBe("<span>42</span>");
  });

  it("omits null and undefined attributes", () => {
    const el = createElement("div", {
      id: "test",
      className: null,
      title: undefined,
    });
    expect(renderToString(el).html).toBe('<div id="test"></div>');
  });

  it("does not escape text inside script tags", () => {
    const el = createElement("script", null, "const fn = (x) => x + 1;");
    expect(renderToString(el).html).toBe(
      "<script>const fn = (x) => x + 1;</script>",
    );
  });

  it("does not escape text inside style tags", () => {
    const el = createElement("style", null, "div > p { color: red; }");
    expect(renderToString(el).html).toBe(
      "<style>div > p { color: red; }</style>",
    );
  });

  it("renders script with attributes", () => {
    const el = createElement(
      "script",
      { type: "module" },
      'import { foo } from "./bar.js";',
    );
    expect(renderToString(el).html).toBe(
      '<script type="module">import { foo } from "./bar.js";</script>',
    );
  });

  it("sanitizes closing tag injection in script", () => {
    const el = createElement(
      "script",
      null,
      "</script><script>alert(1)</script><script>",
    );
    expect(renderToString(el).html).not.toContain("</script><script>");
    expect(renderToString(el).html).toBe(
      "<script><\\/script><script>alert(1)<\\/script><script></script>",
    );
  });

  it("sanitizes closing tag injection in style", () => {
    const el = createElement(
      "style",
      null,
      "</style><script>alert(1)</script><style>",
    );
    expect(renderToString(el).html).not.toContain("</style><script>");
    expect(renderToString(el).html).toBe(
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
    expect(renderToString(el).html).toBe(`<script>${code}</script>`);
  });

  it("still escapes text in normal elements", () => {
    const el = createElement("div", null, "<script>alert(1)</script>");
    expect(renderToString(el).html).toBe(
      "<div>&lt;script&gt;alert(1)&lt;/script&gt;</div>",
    );
  });
});

describe("hydration markers", () => {
  it("wraps island component with markers", () => {
    const Counter = markAsIsland("Counter", () =>
      createElement("button", null, "0"),
    );
    const el = createElement(Counter, null);
    const { html } = renderToString(el);
    expect(html).toContain("<!--$rain-island:0:Counter-->");
    expect(html).toContain("<!--/$rain-island:0-->");
    expect(html).toContain("<button>0</button>");
  });

  it("serializes props as JSON in script tag", () => {
    const Greeting = markAsIsland("Greeting", (props) =>
      createElement("span", null, String(props["name"])),
    );
    const el = createElement(Greeting, { name: "Alice" });
    const { html } = renderToString(el);
    expect(html).toContain(
      '<script type="application/json" data-rain-props="0">',
    );
    expect(html).toContain('"name":"Alice"');
  });

  it("excludes function props from serialization", () => {
    const Btn = markAsIsland("Btn", () =>
      createElement("button", null, "click"),
    );
    const handler = () => undefined;
    const el = createElement(Btn, { onClick: handler, label: "ok" });
    const { html } = renderToString(el);
    expect(html).not.toContain("onClick");
    expect(html).toContain('"label":"ok"');
  });

  it("assigns sequential indices to multiple islands", () => {
    const A = markAsIsland("A", () => createElement("div", null, "a"));
    const B = markAsIsland("B", () => createElement("div", null, "b"));
    const el = createElement(
      Fragment,
      null,
      createElement(A, null),
      createElement(B, null),
    );
    const { html } = renderToString(el);
    expect(html).toContain("<!--$rain-island:0:A-->");
    expect(html).toContain("<!--$rain-island:1:B-->");
  });

  it("resets island counter on each renderToString call", () => {
    const C = markAsIsland("C", () => createElement("p", null, "c"));
    renderToString(createElement(C, null));
    const { html } = renderToString(createElement(C, null));
    expect(html).toContain("<!--$rain-island:0:C-->");
  });

  it("escapes script closing tag in props JSON", () => {
    const X = markAsIsland("X", () => createElement("div", null, "x"));
    const el = createElement(X, { text: "</script>" });
    const { html } = renderToString(el);
    expect(html).not.toContain("</script>{");
    expect(html).toContain("<\\/script>");
  });

  it("renders island children as normal HTML", () => {
    const Card = markAsIsland("Card", () =>
      createElement(
        "div",
        { className: "card" },
        createElement("h2", null, "Title"),
        createElement("p", null, "Body"),
      ),
    );
    const el = createElement(Card, null);
    const { html } = renderToString(el);
    expect(html).toContain('<div class="card">');
    expect(html).toContain("<h2>Title</h2>");
    expect(html).toContain("<p>Body</p>");
  });

  it("throws descriptive error on circular props", () => {
    const Comp = markAsIsland("Circular", () =>
      createElement("div", null, "ok"),
    );
    const circular: Record<string, unknown> = { a: 1 };
    circular["self"] = circular;
    const el = createElement(Comp, circular);
    expect(() => renderToString(el)).toThrow("Circular");
  });
});

describe("server action form rendering", () => {
  it("converts server action function to action URL", () => {
    const action = markAsServerAction("addUser", () => undefined);
    const el = createElement(
      "form",
      { action },
      createElement("input", { name: "name" }),
    );
    const { html } = renderToString(el);
    expect(html).toContain('action="/_rain/action/addUser"');
    expect(html).toContain('method="POST"');
    expect(html).toContain('<input name="name">');
  });

  it("preserves explicit method attribute", () => {
    const action = markAsServerAction("test", () => undefined);
    const el = createElement("form", {
      action,
      method: "POST",
    });
    const { html } = renderToString(el);
    expect(html).toContain('method="POST"');
  });

  it("includes CSRF hidden input when token is active", () => {
    const action = markAsServerAction("csrf-test", () => undefined);
    const el = createElement(
      "form",
      { action },
      createElement("input", { name: "data" }),
    );
    const { html, csrfUsed } = renderToString(el, {
      csrfToken: "test-token-123",
    });
    expect(csrfUsed).toBe(true);
    expect(html).toContain('name="_rain_csrf"');
    expect(html).toContain('value="test-token-123"');
  });

  it("reports no server action when none rendered", () => {
    const el = createElement("div", null, "hello");
    const { csrfUsed } = renderToString(el, { csrfToken: "unused-token" });
    expect(csrfUsed).toBe(false);
  });

  it("escapes action ID in URL", () => {
    const action = markAsServerAction(
      "<script>alert(1)</script>",
      () => undefined,
    );
    const el = createElement("form", { action });
    const { html } = renderToString(el);
    expect(html).not.toContain("<script>alert(1)");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapes CSRF token value", () => {
    const action = markAsServerAction("xss", () => undefined);
    const el = createElement("form", { action });
    const { html } = renderToString(el, {
      csrfToken: '"><img onerror=alert(1)>',
    });
    expect(html).not.toContain('"><img onerror=alert(1)>');
    expect(html).toContain("&quot;");
  });

  it("renders normal form without server action unchanged", () => {
    const el = createElement(
      "form",
      { action: "/submit", method: "POST" },
      createElement("input", { name: "q" }),
    );
    const { html } = renderToString(el);
    expect(html).toContain('action="/submit"');
    expect(html).toContain('method="POST"');
  });

  it("SSR renders island with function component", () => {
    const Counter = markAsIsland("Counter", () => {
      return createElement("button", null, "Count: 0");
    });
    const el = createElement("div", null, createElement(Counter, null));
    const { html } = renderToString(el);
    expect(html).toContain("<!--$rain-island:0:Counter-->");
    expect(html).toContain("Count: 0");
    expect(html).toContain("<!--/$rain-island:0-->");
  });

  it("SSR renders island with props", () => {
    const Greeting = markAsIsland(
      "Greeting",
      (props: Record<string, unknown>) => {
        const name = props["name"] as string;
        return createElement("span", null, `Hello ${name}`);
      },
    );
    const el = createElement(Greeting, { name: "World" });
    const { html } = renderToString(el);
    expect(html).toContain("Hello World");
    expect(html).toContain("data-rain-props");
  });
});
