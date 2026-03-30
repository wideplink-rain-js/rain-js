import { beforeEach, describe, expect, it } from "vitest";
import { createDomNode } from "../../../src/framework/client/dom";
import type { Fiber } from "../../../src/framework/client/hooks";
import {
  setCurrentFiber,
  setScheduleUpdate,
  useState,
} from "../../../src/framework/client/hooks";
import { reconcile } from "../../../src/framework/client/reconciler";
import {
  flushSync,
  initScheduler,
} from "../../../src/framework/client/scheduler";
import { createElement } from "../../../src/framework/jsx";

// @vitest-environment jsdom

function makeFiberFromVnode(
  vnode: ReturnType<typeof createElement>,
  container: HTMLElement,
): Fiber {
  const dom = createDomNode(vnode);
  container.appendChild(dom);
  return {
    vnode,
    dom,
    hooks: [],
    hookIndex: 0,
    childFibers: [],
    parent: null,
  };
}

describe("reconciler", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    setScheduleUpdate(() => undefined);
  });

  it("updates text content", () => {
    const old = createElement("p", null, "old");
    const fiber = makeFiberFromVnode(old, container);

    const updated = createElement("p", null, "new");
    reconcile(container, fiber, updated);

    const p = container.querySelector("p");
    expect(p?.textContent).toBe("new");
  });

  it("updates attributes", () => {
    const old = createElement("div", { className: "old" });
    const fiber = makeFiberFromVnode(old, container);

    const updated = createElement("div", {
      className: "new",
      id: "test",
    });
    reconcile(container, fiber, updated);

    const div = container.firstChild as HTMLElement;
    expect(div.getAttribute("class")).toBe("new");
    expect(div.getAttribute("id")).toBe("test");
  });

  it("removes old attributes", () => {
    const old = createElement("div", {
      className: "old",
      title: "remove-me",
    });
    const fiber = makeFiberFromVnode(old, container);

    const updated = createElement("div", {
      className: "new",
    });
    reconcile(container, fiber, updated);

    const div = container.firstChild as HTMLElement;
    expect(div.getAttribute("class")).toBe("new");
    expect(div.hasAttribute("title")).toBe(false);
  });

  it("adds new children", () => {
    const old = createElement("ul", null, createElement("li", null, "a"));
    const fiber = makeFiberFromVnode(old, container);

    const updated = createElement(
      "ul",
      null,
      createElement("li", null, "a"),
      createElement("li", null, "b"),
    );
    reconcile(container, fiber, updated);

    const ul = container.querySelector("ul");
    expect(ul?.children).toHaveLength(2);
    expect(ul?.children[1]?.textContent).toBe("b");
  });

  it("removes excess children", () => {
    const old = createElement(
      "ul",
      null,
      createElement("li", null, "a"),
      createElement("li", null, "b"),
      createElement("li", null, "c"),
    );
    const fiber = makeFiberFromVnode(old, container);

    const updated = createElement("ul", null, createElement("li", null, "a"));
    reconcile(container, fiber, updated);

    const ul = container.querySelector("ul");
    expect(ul?.children).toHaveLength(1);
    expect(ul?.children[0]?.textContent).toBe("a");
  });

  it("replaces child when type changes", () => {
    const old = createElement("div", null, createElement("span", null, "text"));
    const fiber = makeFiberFromVnode(old, container);

    const updated = createElement(
      "div",
      null,
      createElement("p", null, "text"),
    );
    reconcile(container, fiber, updated);

    const div = container.firstChild as HTMLElement;
    expect(div.firstElementChild?.tagName).toBe("P");
    expect(div.firstElementChild?.textContent).toBe("text");
  });

  it("patches text children without replacing elements", () => {
    const old = createElement("div", null, "hello");
    const fiber = makeFiberFromVnode(old, container);
    const domBefore = container.firstChild;

    const updated = createElement("div", null, "world");
    reconcile(container, fiber, updated);

    expect(container.firstChild).toBe(domBefore);
    expect((container.firstChild as HTMLElement).textContent).toBe("world");
  });

  it("updates event handlers", () => {
    let count = 0;
    const old = createElement(
      "button",
      {
        onClick: () => {
          count += 1;
        },
      },
      "click",
    );
    const fiber = makeFiberFromVnode(old, container);

    const btn = container.querySelector("button") as HTMLButtonElement;
    btn.click();
    expect(count).toBe(1);

    const updated = createElement(
      "button",
      {
        onClick: () => {
          count += 10;
        },
      },
      "click",
    );
    reconcile(container, fiber, updated);

    btn.click();
    expect(count).toBe(11);
  });

  it("handles function component reconciliation", () => {
    function Comp(props: Record<string, unknown>) {
      return createElement("span", null, props["text"] as string);
    }

    createElement(Comp, { text: "old" });
    setCurrentFiber(null);
    const rendered = Comp({ text: "old" });
    const dom = createDomNode(rendered as ReturnType<typeof createElement>);
    container.appendChild(dom);

    const fiber: Fiber = {
      vnode: rendered as ReturnType<typeof createElement>,
      dom,
      hooks: [],
      hookIndex: 0,
      childFibers: [],
      parent: null,
    };

    const newRendered = createElement("span", null, "new");
    reconcile(container, fiber, newRendered);

    expect((container.firstChild as HTMLElement).textContent).toBe("new");
  });

  it("preserves fiber.vnode after reconcile", () => {
    function Comp(props: Record<string, unknown>) {
      return createElement("div", null, props["text"] as string);
    }

    const vnode = createElement(Comp, { text: "init" });
    setCurrentFiber(null);
    const rendered = Comp({ text: "init" });
    const dom = createDomNode(rendered as ReturnType<typeof createElement>);
    container.appendChild(dom);

    const fiber: Fiber = {
      vnode,
      dom,
      hooks: [],
      hookIndex: 0,
      childFibers: [],
      parent: null,
    };

    const newRendered = createElement("div", null, "updated");
    reconcile(container, fiber, newRendered);

    expect(fiber.vnode).toBe(vnode);
    expect(fiber.vnode.tag).toBe(Comp);
    expect(fiber.rendered).toBeDefined();
  });

  it("supports multiple re-renders via scheduler", () => {
    let renderCount = 0;
    let setTitle: (v: string) => void = () => undefined;
    let setCount: (v: number) => void = () => undefined;

    function App() {
      renderCount++;
      const [title, _setTitle] = useState("hello");
      const [count, _setCount] = useState(0);
      setTitle = _setTitle;
      setCount = _setCount;
      return createElement("div", null, `${title}-${count}`);
    }

    const vnode = createElement(App, null);
    const fiber: Fiber = {
      vnode,
      dom: document.createElement("div"),
      hooks: [],
      hookIndex: 0,
      childFibers: [],
      parent: null,
    };

    initScheduler();

    setCurrentFiber(fiber);
    const initial = App();
    setCurrentFiber(null);
    const dom = createDomNode(initial as ReturnType<typeof createElement>);
    container.appendChild(dom);
    fiber.dom = dom;
    fiber.rendered = initial as ReturnType<typeof createElement>;

    expect(dom.textContent).toBe("hello-0");
    renderCount = 0;

    setTitle("");
    flushSync();
    expect(renderCount).toBe(1);
    expect(fiber.dom.textContent).toBe("-0");
    expect(typeof fiber.vnode.tag).toBe("function");

    setCount(42);
    flushSync();
    expect(renderCount).toBe(2);
    expect(fiber.dom.textContent).toBe("-42");
    expect(typeof fiber.vnode.tag).toBe("function");
  });
});
