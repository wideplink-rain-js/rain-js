import {
  RAIN_ELEMENT,
  type RainChild,
  type RainComponent,
  type RainElement,
  type RainNode,
} from "./types";

export function Fragment(props: Record<string, unknown>): RainElement {
  return {
    $$typeof: RAIN_ELEMENT,
    tag: Fragment,
    props: {},
    children: (props["children"] ?? []) as RainNode[],
  };
}

export function createElement(
  tag: string | RainComponent,
  props: Record<string, unknown> | null,
  ...children: RainChild[]
): RainElement {
  const resolvedProps = props ?? {};
  return {
    $$typeof: RAIN_ELEMENT,
    tag,
    props: resolvedProps,
    children,
  };
}
