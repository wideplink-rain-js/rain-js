import {
  RAIN_ELEMENT,
  type RainChild,
  type RainComponent,
  type RainElement,
  type RainNode,
} from "../jsx/types";

export { Fragment } from "../jsx/createElement";

export function jsx(
  tag: string | RainComponent,
  props: Record<string, unknown>,
): RainElement {
  const children = props["children"] as RainChild | RainChild[] | undefined;
  const resolvedChildren: RainNode[] =
    children === undefined
      ? []
      : Array.isArray(children)
        ? children
        : [children];

  const { children: _children, ...rest } = props;
  return {
    $$typeof: RAIN_ELEMENT,
    tag,
    props: rest,
    children: resolvedChildren,
  };
}

export const jsxs = jsx;
export const jsxDEV = jsx;
