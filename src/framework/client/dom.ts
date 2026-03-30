import { Fragment } from "../jsx/createElement";
import type { RainElement, RainNode } from "../jsx/types";
import { RAIN_ELEMENT } from "../jsx/types";

const IDL_PROPERTIES = new Set(["value", "checked", "selected"]);

const BOOLEAN_ATTRS = new Set([
  "allowfullscreen",
  "async",
  "autofocus",
  "autoplay",
  "checked",
  "controls",
  "default",
  "defer",
  "disabled",
  "formnovalidate",
  "hidden",
  "inert",
  "ismap",
  "loop",
  "multiple",
  "muted",
  "nomodule",
  "novalidate",
  "open",
  "playsinline",
  "readonly",
  "required",
  "reversed",
  "selected",
]);

function styleToCss(style: Record<string, string | number>): string {
  const parts: string[] = [];
  for (const key of Object.keys(style)) {
    const value = style[key];
    if (value === undefined || value === null) continue;
    const cssKey = key.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`);
    const cssValue = typeof value === "number" ? `${String(value)}px` : value;
    parts.push(`${cssKey}:${String(cssValue)}`);
  }
  return parts.join(";");
}

const SKIP_PROPS = new Set(["children", "key", "ref"]);

function applyEventProp(el: HTMLElement, key: string, value: unknown): boolean {
  if (!key.startsWith("on") || typeof value !== "function") return false;
  const eventName = key.slice(2).toLowerCase();
  el.addEventListener(eventName, value as EventListener);
  return true;
}

function applySpecialProp(
  el: HTMLElement,
  key: string,
  value: unknown,
): boolean {
  if (key === "className") {
    el.setAttribute("class", String(value));
    return true;
  }
  if (key === "style" && typeof value === "object" && value) {
    el.setAttribute(
      "style",
      styleToCss(value as Record<string, string | number>),
    );
    return true;
  }
  return false;
}

function applyRegularProp(el: HTMLElement, key: string, value: unknown): void {
  if (IDL_PROPERTIES.has(key)) {
    (el as unknown as Record<string, unknown>)[key] = value;
    return;
  }

  if (BOOLEAN_ATTRS.has(key)) {
    if (value) {
      el.setAttribute(key, "");
    } else {
      el.removeAttribute(key);
    }
    return;
  }

  if (value === false || value === undefined || value === null) {
    el.removeAttribute(key);
    return;
  }

  el.setAttribute(key, String(value));
}

export function applyProps(
  el: HTMLElement,
  props: Record<string, unknown>,
): void {
  for (const key of Object.keys(props)) {
    if (SKIP_PROPS.has(key)) continue;
    const value = props[key];
    if (applyEventProp(el, key, value)) continue;
    if (applySpecialProp(el, key, value)) continue;
    applyRegularProp(el, key, value);
  }
}

function isRainElement(value: unknown): value is RainElement {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as RainElement).$$typeof === RAIN_ELEMENT
  );
}

function createChildNodes(children: RainNode[], parent: Node): void {
  for (const child of children) {
    if (child === null || child === undefined) continue;
    if (typeof child === "boolean") continue;
    if (Array.isArray(child)) {
      createChildNodes(child, parent);
      continue;
    }
    if (isRainElement(child)) {
      parent.appendChild(createDomNode(child));
      continue;
    }
    parent.appendChild(document.createTextNode(String(child)));
  }
}

export function createDomNode(vnode: RainElement): Node {
  const { tag, props, children } = vnode;

  if (tag === Fragment) {
    const frag = document.createDocumentFragment();
    createChildNodes(children, frag);
    return frag;
  }

  if (typeof tag === "function") {
    const result = tag({ ...props, children });
    if (result === null) return document.createTextNode("");
    if (typeof result === "string") return document.createTextNode(result);
    return createDomNode(result);
  }

  const el = document.createElement(tag);
  applyProps(el, props);
  createChildNodes(children, el);
  return el;
}
