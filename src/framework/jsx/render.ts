import { Fragment } from "./createElement";
import { escapeHtml } from "./escape";
import {
  RAIN_ELEMENT,
  RAIN_ISLAND,
  RAIN_SERVER_ACTION,
  type RainComponent,
  type RainElement,
  type RainNode,
} from "./types";

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

export interface RenderResult {
  html: string;
  csrfUsed: boolean;
}

interface RenderContext {
  islandCounter: number;
  csrf: { token: string; used: boolean } | null;
}

function serializeIslandProps(props: Record<string, unknown>): string {
  const safe: Record<string, unknown> = {};
  for (const key of Object.keys(props)) {
    if (key === "children") continue;
    const value = props[key];
    if (typeof value === "function") continue;
    if (typeof value === "symbol") continue;
    safe[key] = value;
  }
  return JSON.stringify(safe);
}

function escapeScriptJson(json: string): string {
  return json.replace(/<\/(script)/gi, "<\\/$1");
}

function renderIsland(
  tag: RainComponent,
  props: Record<string, unknown>,
  children: RainNode[],
  islandId: string,
  ctx: RenderContext,
): string {
  const index = ctx.islandCounter++;
  const result = tag({ ...props, children });
  const innerHtml =
    result === null
      ? ""
      : typeof result === "string"
        ? escapeHtml(result)
        : renderElement(result, ctx);
  let json: string;
  try {
    json = escapeScriptJson(serializeIslandProps(props));
  } catch (cause) {
    throw new Error(
      `[Rain] Island "${islandId}" の props を` +
        "シリアライズできませんでした。" +
        "循環参照や BigInt を含む props は" +
        "渡せません。該当する props を確認して" +
        "ください。",
      { cause },
    );
  }
  return (
    `<!--$rain-island:${index}:${islandId}-->` +
    innerHtml +
    `<script type="application/json"` +
    ` data-rain-props="${index}">` +
    json +
    `</script>` +
    `<!--/$rain-island:${index}-->`
  );
}

function renderRawChildren(
  tag: string,
  children: RainNode[],
  ctx: RenderContext,
): string {
  const parts: string[] = [];
  const closeRe = new RegExp(`</${tag}`, "gi");
  for (const child of children) {
    if (child === null || child === undefined) continue;
    if (typeof child === "boolean") continue;
    if (Array.isArray(child)) {
      parts.push(renderRawChildren(tag, child, ctx));
      continue;
    }
    if (isRainElement(child)) {
      parts.push(renderElement(child, ctx));
      continue;
    }
    parts.push(String(child).replace(closeRe, `<\\/${tag}`));
  }
  return parts.join("");
}

function renderChildren(children: RainNode[], ctx: RenderContext): string {
  const parts: string[] = [];
  for (const child of children) {
    if (child === null || child === undefined) continue;
    if (typeof child === "boolean") continue;
    if (Array.isArray(child)) {
      parts.push(renderChildren(child, ctx));
      continue;
    }
    if (isRainElement(child)) {
      parts.push(renderElement(child, ctx));
      continue;
    }
    parts.push(escapeHtml(String(child)));
  }
  return parts.join("");
}

function isServerActionFn(value: unknown): value is Record<symbol, string> {
  return typeof value === "function" && RAIN_SERVER_ACTION in (value as object);
}

function renderServerActionForm(
  props: Record<string, unknown>,
  children: RainNode[],
  ctx: RenderContext,
): string {
  const actionId = (props["action"] as Record<symbol, unknown>)[
    RAIN_SERVER_ACTION
  ] as string;

  const formProps: Record<string, unknown> = {};
  for (const key of Object.keys(props)) {
    if (key === "action") continue;
    formProps[key] = props[key];
  }
  formProps["action"] = `/_rain/action/${actionId}`;
  if (!formProps["method"]) {
    formProps["method"] = "POST";
  }

  const attrs = renderAttrs(formProps);

  let csrfHidden = "";
  if (ctx.csrf) {
    ctx.csrf.used = true;
    csrfHidden =
      `<input type="hidden" name="_rain_csrf"` +
      ` value="${escapeHtml(ctx.csrf.token)}">`;
  }

  const inner = renderChildren(children, ctx);
  return `<form${attrs}>${csrfHidden}${inner}</form>`;
}

function renderElement(element: RainElement, ctx: RenderContext): string {
  const { tag, props, children } = element;

  if (typeof tag === "function") {
    if (tag === Fragment) {
      return renderChildren(children, ctx);
    }

    const islandId = (tag as unknown as Record<symbol, unknown>)[RAIN_ISLAND] as
      | string
      | undefined;
    if (islandId !== undefined) {
      return renderIsland(tag, props, children, islandId, ctx);
    }

    const result = tag({ ...props, children });
    if (result === null) return "";
    if (typeof result === "string") return escapeHtml(result);
    return renderElement(result, ctx);
  }

  if (tag === "form" && isServerActionFn(props["action"])) {
    return renderServerActionForm(props, children, ctx);
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
    const raw = renderRawChildren(tag, children, ctx);
    return `<${tag}${attrs}>${raw}</${tag}>`;
  }

  const inner = renderChildren(children, ctx);
  return `<${tag}${attrs}>${inner}</${tag}>`;
}

export function renderToString(
  element: RainElement,
  options?: { csrfToken?: string },
): RenderResult {
  const ctx: RenderContext = {
    islandCounter: 0,
    csrf: options?.csrfToken ? { token: options.csrfToken, used: false } : null,
  };
  const html = renderElement(element, ctx);
  return { html, csrfUsed: ctx.csrf?.used ?? false };
}
