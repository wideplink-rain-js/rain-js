export const RAIN_ELEMENT = Symbol.for("rain.element");
export const RAIN_ISLAND = Symbol.for("rain.island");
export const RAIN_SERVER_ACTION = Symbol.for("rain.server_action");

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

export function markAsIsland<T extends RainComponent>(
  id: string,
  component: T,
): T {
  (component as Record<symbol, unknown>)[RAIN_ISLAND] = id;
  return component;
}

export function markAsServerAction<T extends (...args: never[]) => unknown>(
  id: string,
  fn: T,
): T {
  (fn as Record<symbol, unknown>)[RAIN_SERVER_ACTION] = id;
  return fn;
}
