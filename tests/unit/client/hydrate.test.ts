import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  setScheduleUpdate,
  useState,
} from "../../../src/framework/client/hooks";
import {
  findIslands,
  hydrateIsland,
  hydrateIslands,
} from "../../../src/framework/client/hydrate";
import { createElement } from "../../../src/framework/jsx";
import type { RainComponent } from "../../../src/framework/jsx/types";

// @vitest-environment jsdom

function injectIslandHtml(
  container: HTMLElement,
  index: number,
  islandId: string,
  innerHtml: string,
  props: Record<string, unknown> = {},
): void {
  const json = JSON.stringify(props);
  container.innerHTML =
    `<!--$rain-island:${index}:${islandId}-->` +
    innerHtml +
    `<script type="application/json"` +
    ` data-rain-props="${index}">` +
    json +
    `</script>` +
    `<!--/$rain-island:${index}-->`;
}

describe("findIslands", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    setScheduleUpdate(() => undefined);
  });

  it("finds a single island", () => {
    injectIslandHtml(container, 0, "Counter", "<button>0</button>");

    const islands = findIslands(container);
    expect(islands).toHaveLength(1);
    expect(islands[0]?.islandId).toBe("Counter");
    expect(islands[0]?.index).toBe(0);
    expect(islands[0]?.rootElement.tagName).toBe("BUTTON");
  });

  it("finds multiple islands", () => {
    container.innerHTML =
      `<!--$rain-island:0:Counter-->` +
      `<button>0</button>` +
      `<script type="application/json"` +
      ` data-rain-props="0">{}</script>` +
      `<!--/$rain-island:0-->` +
      `<p>separator</p>` +
      `<!--$rain-island:1:Toggle-->` +
      `<span>off</span>` +
      `<script type="application/json"` +
      ` data-rain-props="1">{}</script>` +
      `<!--/$rain-island:1-->`;

    const islands = findIslands(container);
    expect(islands).toHaveLength(2);
    expect(islands[0]?.islandId).toBe("Counter");
    expect(islands[1]?.islandId).toBe("Toggle");
  });

  it("deserializes props from script tag", () => {
    injectIslandHtml(container, 0, "Greeting", `<h1>Hello Alice</h1>`, {
      name: "Alice",
      count: 5,
    });

    const islands = findIslands(container);
    expect(islands[0]?.props).toEqual({
      name: "Alice",
      count: 5,
    });
  });

  it("returns empty array when no islands", () => {
    container.innerHTML = "<p>No islands here</p>";
    expect(findIslands(container)).toHaveLength(0);
  });
});

describe("hydrateIsland", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    setScheduleUpdate(() => undefined);
  });

  it("attaches event handlers to existing DOM", () => {
    const button = document.createElement("button");
    button.textContent = "click me";
    container.appendChild(button);

    const handler = vi.fn();
    const Counter: RainComponent = (props) =>
      createElement("button", { onClick: props["onClick"] }, "click me");

    const fiber = hydrateIsland(button, Counter, {
      onClick: handler,
    });

    button.click();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(fiber.dom).toBe(button);
  });

  it("sets up hooks during hydration", () => {
    const button = document.createElement("button");
    button.textContent = "Count: 0";
    container.appendChild(button);

    let hookCalled = false;

    const Counter: RainComponent = () => {
      const [count] = useState(0);
      hookCalled = true;
      return createElement("button", null, `Count: ${count}`);
    };

    hydrateIsland(button, Counter, {});

    expect(hookCalled).toBe(true);
  });

  it("creates fiber with rendered field", () => {
    const div = document.createElement("div");
    div.innerHTML = "<span>hello</span>";
    container.appendChild(div);

    const Comp: RainComponent = () =>
      createElement("div", null, createElement("span", null, "hello"));

    const fiber = hydrateIsland(div, Comp, {});
    expect(fiber.rendered).toBeDefined();
    expect(fiber.rendered?.tag).toBe("div");
  });

  it("attaches events to nested children", () => {
    const div = document.createElement("div");
    const btn = document.createElement("button");
    btn.textContent = "click";
    div.appendChild(btn);
    container.appendChild(div);

    const handler = vi.fn();
    const Comp: RainComponent = () =>
      createElement(
        "div",
        null,
        createElement("button", { onClick: handler }, "click"),
      );

    hydrateIsland(div, Comp, {});
    btn.click();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("does not recreate DOM nodes", () => {
    const p = document.createElement("p");
    p.textContent = "existing";
    container.appendChild(p);

    const Comp: RainComponent = () => createElement("p", null, "existing");

    hydrateIsland(p, Comp, {});
    expect(container.firstChild).toBe(p);
    expect(p.textContent).toBe("existing");
  });
});

describe("hydrateIslands", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    setScheduleUpdate(() => undefined);
  });

  it("hydrates all registered islands", () => {
    container.innerHTML =
      `<!--$rain-island:0:Btn-->` +
      `<button>a</button>` +
      `<script type="application/json"` +
      ` data-rain-props="0">{}</script>` +
      `<!--/$rain-island:0-->` +
      `<!--$rain-island:1:Span-->` +
      `<span>b</span>` +
      `<script type="application/json"` +
      ` data-rain-props="1">{}</script>` +
      `<!--/$rain-island:1-->`;

    const Btn: RainComponent = () => createElement("button", null, "a");
    const Span: RainComponent = () => createElement("span", null, "b");

    const registry = new Map<string, RainComponent>([
      ["Btn", Btn],
      ["Span", Span],
    ]);

    const fibers = hydrateIslands(container, registry);
    expect(fibers).toHaveLength(2);
  });

  it("skips unregistered islands", () => {
    injectIslandHtml(container, 0, "Unknown", "<div>x</div>");

    const registry = new Map<string, RainComponent>();
    const fibers = hydrateIslands(container, registry);
    expect(fibers).toHaveLength(0);
  });

  it("removes props script after hydration", () => {
    injectIslandHtml(container, 0, "Counter", "<button>0</button>");

    const Counter: RainComponent = () => createElement("button", null, "0");
    const registry = new Map<string, RainComponent>([["Counter", Counter]]);

    hydrateIslands(container, registry);

    const scripts = container.querySelectorAll("script[data-rain-props]");
    expect(scripts).toHaveLength(0);
  });

  it("passes deserialized props to component", () => {
    injectIslandHtml(container, 0, "Greeting", `<h1>Hello Alice</h1>`, {
      name: "Alice",
    });

    const receivedProps: Record<string, unknown>[] = [];
    const Greeting: RainComponent = (props) => {
      receivedProps.push({ ...props });
      return createElement("h1", null, `Hello ${props["name"]}`);
    };

    const registry = new Map<string, RainComponent>([["Greeting", Greeting]]);

    hydrateIslands(container, registry);
    expect(receivedProps[0]).toEqual({ name: "Alice" });
  });
});
