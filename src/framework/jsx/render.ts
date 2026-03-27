import { Fragment } from "./createElement";
import { escapeHtml } from "./escape";
import { RAIN_ELEMENT, type RainElement, type RainNode } from "./types";

const RAW_TEXT_ELEMENTS = new Set(["script", "style"]);

const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

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

function renderAttrs(props: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const key of Object.keys(props)) {
    if (key === "children" || key === "dangerouslySetInnerHTML") {
      continue;
    }

    const value = props[key];
    if (value === false || value === undefined || value === null) {
      continue;
    }

    const attrName = key === "className" ? "class" : key;

    if (BOOLEAN_ATTRS.has(attrName) && value === true) {
      parts.push(` ${attrName}`);
      continue;
    }

    if (attrName === "style" && typeof value === "object") {
      const css = styleToCss(value as Record<string, string | number>);
      parts.push(` style="${escapeHtml(css)}"`);
      continue;
    }

    parts.push(` ${attrName}="${escapeHtml(String(value))}"`);
  }
  return parts.join("");
}

export function isRainElement(value: unknown): value is RainElement {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as RainElement).$$typeof === RAIN_ELEMENT
  );
}

function renderRawChildren(tag: string, children: RainNode[]): string {
  const parts: string[] = [];
  const closeRe = new RegExp(`</${tag}`, "gi");
  for (const child of children) {
    if (child === null || child === undefined) continue;
    if (typeof child === "boolean") continue;
    if (Array.isArray(child)) {
      parts.push(renderRawChildren(tag, child));
      continue;
    }
    if (isRainElement(child)) {
      parts.push(renderElement(child));
      continue;
    }
    parts.push(String(child).replace(closeRe, `<\\/${tag}`));
  }
  return parts.join("");
}

function renderChildren(children: RainNode[]): string {
  const parts: string[] = [];
  for (const child of children) {
    if (child === null || child === undefined) continue;
    if (typeof child === "boolean") continue;
    if (Array.isArray(child)) {
      parts.push(renderChildren(child));
      continue;
    }
    if (isRainElement(child)) {
      parts.push(renderElement(child));
      continue;
    }
    parts.push(escapeHtml(String(child)));
  }
  return parts.join("");
}

function renderElement(element: RainElement): string {
  const { tag, props, children } = element;

  if (typeof tag === "function") {
    if (tag === Fragment) {
      return renderChildren(children);
    }
    const result = tag({ ...props, children });
    if (result === null) return "";
    if (typeof result === "string") return escapeHtml(result);
    return renderElement(result);
  }

  const attrs = renderAttrs(props);
  const isVoid = VOID_ELEMENTS.has(tag);

  if (isVoid) {
    return `<${tag}${attrs}>`;
  }

  const dangerousHtml = props["dangerouslySetInnerHTML"] as
    | { __html: string }
    | undefined;

  if (dangerousHtml) {
    return `<${tag}${attrs}>${dangerousHtml.__html}</${tag}>`;
  }

  if (RAW_TEXT_ELEMENTS.has(tag)) {
    const raw = renderRawChildren(tag, children);
    return `<${tag}${attrs}>${raw}</${tag}>`;
  }

  const inner = renderChildren(children);
  return `<${tag}${attrs}>${inner}</${tag}>`;
}

export function renderToString(element: RainElement): string {
  return renderElement(element);
}
