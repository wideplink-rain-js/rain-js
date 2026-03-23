export const RAIN_ELEMENT = Symbol.for("rain.element");

export interface RainElement {
  readonly $$typeof: typeof RAIN_ELEMENT;
  readonly tag: string | RainComponent;
  readonly props: Record<string, unknown>;
  readonly children: RainNode[];
}

export type RainComponent = (
  props: Record<string, unknown>,
) => RainElement | string | null;

export type RainChild =
  | RainElement
  | string
  | number
  | boolean
  | null
  | undefined;

export type RainNode = RainChild | RainChild[];
