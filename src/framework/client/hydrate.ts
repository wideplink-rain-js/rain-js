import { Fragment } from "../jsx/createElement";
import {
  RAIN_ELEMENT,
  RAIN_ISLAND,
  type RainComponent,
  type RainElement,
  type RainNode,
} from "../jsx/types";
import type { Fiber } from "./hooks";
import { setCurrentFiber } from "./hooks";

interface IslandDescriptor {
  index: number;
  islandId: string;
  rootElement: Element;
  props: Record<string, unknown>;
  propsScript: Element;
}

const ISLAND_START_RE = /^\$rain-island:(\d+):(.+)$/;

function isRainElement(value: unknown): value is RainElement {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as RainElement).$$typeof === RAIN_ELEMENT
  );
}

function flattenChildren(children: RainNode[]): RainNode[] {
  const flat: RainNode[] = [];
  for (const child of children) {
    if (Array.isArray(child)) {
      flat.push(...flattenChildren(child));
    } else {
      flat.push(child);
    }
  }
  return flat;
}

function collectComments(root: Node): Comment[] {
  const comments: Comment[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_COMMENT);
  let current = walker.nextNode();
  while (current) {
    comments.push(current as Comment);
    current = walker.nextNode();
  }
  return comments;
}

function scanSiblings(
  start: Comment,
  index: number,
): { rootElement: Element | null; propsScript: Element | null } {
  let rootElement: Element | null = null;
  let propsScript: Element | null = null;
  let sibling = start.nextSibling;
  const endMarker = `/$rain-island:${index}`;
  while (sibling) {
    if (
      sibling.nodeType === Node.COMMENT_NODE &&
      sibling.textContent === endMarker
    ) {
      break;
    }
    if (
      sibling instanceof HTMLScriptElement &&
      sibling.getAttribute("data-rain-props") === String(index)
    ) {
      propsScript = sibling;
    } else if (sibling instanceof Element && !rootElement) {
      rootElement = sibling;
    }
    sibling = sibling.nextSibling;
  }
  return { rootElement, propsScript };
}

export function findIslands(root: Node): IslandDescriptor[] {
  const islands: IslandDescriptor[] = [];
  const comments = collectComments(root);

  for (const node of comments) {
    const text = node.textContent ?? "";
    const match = ISLAND_START_RE.exec(text);
    if (!match) continue;

    const [, indexStr, id] = match;
    const index = parseInt(indexStr ?? "0", 10);
    const islandId = id ?? "";
    const { rootElement, propsScript } = scanSiblings(node, index);

    if (rootElement && propsScript) {
      const rawJson = propsScript.textContent ?? "{}";
      const props = JSON.parse(rawJson) as Record<string, unknown>;
      islands.push({
        index,
        islandId,
        rootElement,
        props,
        propsScript,
      });
    }
  }

  return islands;
}

function attachEventHandlers(
  el: HTMLElement,
  props: Record<string, unknown>,
): void {
  for (const key of Object.keys(props)) {
    if (!key.startsWith("on")) continue;
    const value = props[key];
    if (typeof value !== "function") continue;
    const eventName = key.slice(2).toLowerCase();
    el.addEventListener(eventName, value as EventListener);
  }
}

function hydrateChildren(parent: Node, children: RainNode[]): void {
  const flat = flattenChildren(children).filter(
    (c) => c !== null && c !== undefined && typeof c !== "boolean",
  );

  let domIndex = 0;
  for (const child of flat) {
    const domNode = parent.childNodes[domIndex];
    domIndex++;
    if (!domNode) break;

    if (isRainElement(child)) {
      hydrateVNodeToDom(domNode, child);
    }
  }
}

function hydrateVNodeToDom(dom: Node, vnode: RainElement): void {
  if (typeof vnode.tag === "function") {
    if (vnode.tag === Fragment) {
      hydrateChildren(dom, vnode.children);
      return;
    }

    if (RAIN_ISLAND in (vnode.tag as unknown as Record<symbol, unknown>)) {
      return;
    }

    const result = vnode.tag({
      ...vnode.props,
      children: vnode.children,
    });
    if (
      result !== null &&
      typeof result !== "string" &&
      isRainElement(result)
    ) {
      hydrateVNodeToDom(dom, result);
    }
    return;
  }

  if (dom instanceof HTMLElement) {
    attachEventHandlers(dom, vnode.props);
    hydrateChildren(dom, vnode.children);
  }
}

export function hydrateIsland(
  rootDom: Element,
  component: RainComponent,
  props: Record<string, unknown>,
): Fiber {
  const vnode: RainElement = {
    $$typeof: RAIN_ELEMENT,
    tag: component,
    props,
    children: [],
  };

  const fiber: Fiber = {
    vnode,
    dom: rootDom,
    hooks: [],
    hookIndex: 0,
    childFibers: [],
    parent: null,
  };

  setCurrentFiber(fiber);
  const rendered = component(props);
  setCurrentFiber(null);

  if (
    rendered !== null &&
    typeof rendered !== "string" &&
    isRainElement(rendered)
  ) {
    hydrateVNodeToDom(rootDom, rendered);
    fiber.rendered = rendered;
  }

  return fiber;
}

export function hydrateIslands(
  root: Node,
  registry: ReadonlyMap<string, RainComponent>,
): Fiber[] {
  const islands = findIslands(root);
  const fibers: Fiber[] = [];

  for (const island of islands) {
    const component = registry.get(island.islandId);
    if (!component) continue;

    const fiber = hydrateIsland(island.rootElement, component, island.props);
    fibers.push(fiber);

    island.propsScript.remove();
  }

  return fibers;
}
