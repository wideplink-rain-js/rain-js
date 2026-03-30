import { describe, expect, it } from "vitest";
import { applyProps, createDomNode } from "../../../src/framework/client/dom";
import { createElement, Fragment } from "../../../src/framework/jsx";

// @vitest-environment jsdom

describe("createDomNode", () => {
  it("creates a simple element", () => {
    const vnode = createElement("div", null);
    const node = createDomNode(vnode) as HTMLElement;
    expect(node.tagName).toBe("DIV");
  });

  it("creates an element with text children", () => {
    const vnode = createElement("p", null, "hello");
    const node = createDomNode(vnode) as HTMLElement;
    expect(node.tagName).toBe("P");
    expect(node.textContent).toBe("hello");
  });

  it("creates nested elements", () => {
    const vnode = createElement(
      "div",
      null,
      createElement("span", null, "inner"),
    );
    const node = createDomNode(vnode) as HTMLElement;
    const span = node.firstChild as HTMLElement;
    expect(span.tagName).toBe("SPAN");
    expect(span.textContent).toBe("inner");
  });

  it("skips null, undefined, and boolean children", () => {
    const vnode = createElement(
      "div",
      null,
      null,
      undefined,
      true,
      false,
      "visible",
    );
    const node = createDomNode(vnode) as HTMLElement;
    expect(node.childNodes).toHaveLength(1);
    expect(node.textContent).toBe("visible");
  });

  it("flattens array children", () => {
    const vnode = createElement(
      "ul",
      null,
      ...[createElement("li", null, "a"), createElement("li", null, "b")],
    );
    const node = createDomNode(vnode) as HTMLElement;
    expect(node.children).toHaveLength(2);
  });

  it("renders number children as text", () => {
    const vnode = createElement("span", null, 42);
    const node = createDomNode(vnode) as HTMLElement;
    expect(node.textContent).toBe("42");
  });

  it("handles function components", () => {
    function Greeting(props: Record<string, unknown>) {
      return createElement("h1", null, `Hello ${props["name"]}`);
    }
    const vnode = createElement(Greeting, { name: "World" });
    const node = createDomNode(vnode) as HTMLElement;
    expect(node.tagName).toBe("H1");
    expect(node.textContent).toBe("Hello World");
  });

  it("handles function components returning null", () => {
    function Empty() {
      return null;
    }
    const vnode = createElement(Empty, null);
    const node = createDomNode(vnode);
    expect(node.nodeType).toBe(Node.TEXT_NODE);
    expect(node.textContent).toBe("");
  });

  it("handles Fragment", () => {
    const vnode = createElement(
      Fragment,
      null,
      createElement("span", null, "a"),
      createElement("span", null, "b"),
    );
    const node = createDomNode(vnode);
    expect(node.nodeType).toBe(Node.DOCUMENT_FRAGMENT_NODE);
    expect(node.childNodes).toHaveLength(2);
  });
});

describe("applyProps", () => {
  it("sets string attributes", () => {
    const el = document.createElement("a");
    applyProps(el, { href: "/home", id: "link" });
    expect(el.getAttribute("href")).toBe("/home");
    expect(el.getAttribute("id")).toBe("link");
  });

  it("converts className to class", () => {
    const el = document.createElement("div");
    applyProps(el, { className: "foo bar" });
    expect(el.getAttribute("class")).toBe("foo bar");
  });

  it("converts style object to string", () => {
    const el = document.createElement("div");
    applyProps(el, {
      style: { backgroundColor: "red", fontSize: 16 },
    });
    expect(el.getAttribute("style")).toBe(
      "background-color:red;font-size:16px",
    );
  });

  it("handles boolean attributes", () => {
    const el = document.createElement("input");
    applyProps(el, { disabled: true, readonly: false });
    expect(el.hasAttribute("disabled")).toBe(true);
    expect(el.hasAttribute("readonly")).toBe(false);
  });

  it("registers event listeners", () => {
    const el = document.createElement("button");
    let clicked = false;
    applyProps(el, {
      onClick: () => {
        clicked = true;
      },
    });
    el.click();
    expect(clicked).toBe(true);
  });

  it("removes attributes for null/undefined/false", () => {
    const el = document.createElement("div");
    el.setAttribute("title", "old");
    applyProps(el, { title: null });
    expect(el.hasAttribute("title")).toBe(false);
  });

  it("skips children, key, and ref props", () => {
    const el = document.createElement("div");
    applyProps(el, {
      children: "skip",
      key: "skip",
      ref: "skip",
    });
    expect(el.attributes).toHaveLength(0);
  });

  it("sets value via DOM property instead of setAttribute", () => {
    const el = document.createElement("input");
    applyProps(el, { value: "hello" });
    expect(el.value).toBe("hello");
  });

  it("resets value via DOM property to empty string", () => {
    const el = document.createElement("input");
    el.value = "typed-by-user";
    applyProps(el, { value: "" });
    expect(el.value).toBe("");
  });

  it("sets checked via DOM property", () => {
    const el = document.createElement("input");
    el.type = "checkbox";
    applyProps(el, { checked: true });
    expect(el.checked).toBe(true);
    applyProps(el, { checked: false });
    expect(el.checked).toBe(false);
  });

  it("sets selected via DOM property", () => {
    const el = document.createElement("option");
    applyProps(el, { selected: true });
    expect(el.selected).toBe(true);
    applyProps(el, { selected: false });
    expect(el.selected).toBe(false);
  });
});
