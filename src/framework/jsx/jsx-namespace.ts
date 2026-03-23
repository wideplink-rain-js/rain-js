import type { RainElement } from "./types";

type HtmlAttributes = {
  [key: string]: unknown;
  children?: unknown;
  dangerouslySetInnerHTML?: { __html: string };
  className?: string;
  id?: string;
  style?: Record<string, string | number> | string;
};

type HtmlTag = string;

export declare namespace RainJSX {
  type Element = RainElement;
  type ElementChildrenAttribute = { children: unknown };
  type IntrinsicElements = {
    [K in HtmlTag]: HtmlAttributes;
  };
}
