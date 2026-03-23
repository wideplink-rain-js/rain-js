import type { RainElement } from "./jsx/types";

export { Fragment, jsx, jsxDEV, jsxs } from "./jsx/jsx-runtime";

type HtmlAttributes = {
  [key: string]: unknown;
  children?: unknown;
  dangerouslySetInnerHTML?: { __html: string };
  className?: string;
  id?: string;
  style?: Record<string, string | number> | string;
};

type HtmlTag = string;

export declare namespace JSX {
  type Element = RainElement;
  type ElementChildrenAttribute = { children: unknown };
  type IntrinsicElements = {
    [K in HtmlTag]: HtmlAttributes;
  };
}
