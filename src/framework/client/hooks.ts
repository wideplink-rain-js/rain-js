import { Fragment } from "../jsx/createElement";
import type { RainComponent, RainElement, RainNode } from "../jsx/types";
import { RAIN_ELEMENT } from "../jsx/types";

export interface Fiber {
  vnode: RainElement;
  rendered?: RainElement;
  dom: Node;
  hooks: HookState[];
  hookIndex: number;
  childFibers: Fiber[];
  parent: Fiber | null;
}

export interface StateHookState {
  kind: "state";
  value: unknown;
  queue: Array<unknown | ((prev: unknown) => unknown)>;
}

export interface EffectHookState {
  kind: "effect";
  effect: () => undefined | (() => void);
  cleanup: (() => void) | undefined;
  deps: unknown[] | undefined;
}

export interface RefHookState {
  kind: "ref";
  ref: { current: unknown };
}

export interface MemoHookState {
  kind: "memo";
  value: unknown;
  deps: unknown[] | undefined;
}

export type HookState =
  | StateHookState
  | EffectHookState
  | RefHookState
  | MemoHookState;

interface PendingEffect {
  fiber: Fiber;
  index: number;
}

const pendingEffects: PendingEffect[] = [];

let currentFiber: Fiber | null = null;

export function getCurrentFiber(): Fiber | null {
  return currentFiber;
}

export function setCurrentFiber(fiber: Fiber | null): void {
  currentFiber = fiber;
  if (fiber) {
    fiber.hookIndex = 0;
  }
}

type SetStateAction<T> = T | ((prev: T) => T);
type Dispatch<T> = (action: SetStateAction<T>) => void;

let scheduleUpdateFn: ((fiber: Fiber) => void) | null = null;

export function setScheduleUpdate(fn: (fiber: Fiber) => void): void {
  scheduleUpdateFn = fn;
}

export function useState<T>(initial: T): [T, Dispatch<T>] {
  const fiber = currentFiber;
  if (!fiber) {
    throw new Error(
      "useState must be called inside a component. " +
        "Ensure you are not calling hooks conditionally " +
        "or outside of a render cycle.",
    );
  }

  const idx = fiber.hookIndex;
  fiber.hookIndex++;

  if (idx >= fiber.hooks.length) {
    fiber.hooks.push({
      kind: "state",
      value: initial,
      queue: [],
    });
  }

  const hook = fiber.hooks[idx] as StateHookState;

  for (const action of hook.queue) {
    if (typeof action === "function") {
      hook.value = (action as (prev: unknown) => unknown)(hook.value);
    } else {
      hook.value = action;
    }
  }
  hook.queue.length = 0;

  const setState: Dispatch<T> = (action) => {
    hook.queue.push(action as unknown);
    if (scheduleUpdateFn && fiber) {
      scheduleUpdateFn(fiber);
    }
  };

  return [hook.value as T, setState];
}

function shallowEqual(
  a: unknown[] | undefined,
  b: unknown[] | undefined,
): boolean {
  if (a === undefined || b === undefined) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!Object.is(a[i], b[i])) return false;
  }
  return true;
}

function throwHookError(name: string): never {
  throw new Error(
    `${name} must be called inside a component. ` +
      "Ensure you are not calling hooks conditionally " +
      "or outside of a render cycle.",
  );
}

export function useEffect(
  effect: () => undefined | (() => void),
  deps?: unknown[],
): void {
  if (!currentFiber) throwHookError("useEffect");
  const fiber = currentFiber;
  const idx = fiber.hookIndex;
  fiber.hookIndex++;

  if (idx >= fiber.hooks.length) {
    fiber.hooks.push({
      kind: "effect",
      effect,
      cleanup: undefined,
      deps,
    });
    pendingEffects.push({ fiber, index: idx });
    return;
  }

  const hook = fiber.hooks[idx] as EffectHookState;

  if (!shallowEqual(hook.deps, deps)) {
    hook.effect = effect;
    hook.deps = deps;
    pendingEffects.push({ fiber, index: idx });
  }
}

export interface RefObject<T> {
  current: T;
}

export function useRef<T>(initial: T): RefObject<T> {
  if (!currentFiber) throwHookError("useRef");
  const fiber = currentFiber;
  const idx = fiber.hookIndex;
  fiber.hookIndex++;

  if (idx >= fiber.hooks.length) {
    fiber.hooks.push({
      kind: "ref",
      ref: { current: initial },
    });
  }

  return (fiber.hooks[idx] as RefHookState).ref as RefObject<T>;
}

export function useMemo<T>(factory: () => T, deps: unknown[]): T {
  if (!currentFiber) throwHookError("useMemo");
  const fiber = currentFiber;
  const idx = fiber.hookIndex;
  fiber.hookIndex++;

  if (idx >= fiber.hooks.length) {
    const value = factory();
    fiber.hooks.push({ kind: "memo", value, deps });
    return value;
  }

  const hook = fiber.hooks[idx] as MemoHookState;

  if (!shallowEqual(hook.deps, deps)) {
    hook.value = factory();
    hook.deps = deps;
  }

  return hook.value as T;
}

export function useCallback<T extends (...args: never[]) => unknown>(
  callback: T,
  deps: unknown[],
): T {
  return useMemo(() => callback, deps);
}

export interface RainContext<T> {
  _defaultValue: T;
  _currentValue: T;
  Provider: RainComponent;
}

export function createContext<T>(defaultValue: T): RainContext<T> {
  const context: RainContext<T> = {
    _defaultValue: defaultValue,
    _currentValue: defaultValue,
    Provider: (props: Record<string, unknown>): RainElement => {
      context._currentValue = props["value"] as T;
      const children = (props["children"] ?? []) as RainNode[];
      return {
        $$typeof: RAIN_ELEMENT,
        tag: Fragment,
        props: {},
        children,
      };
    },
  };
  return context;
}

export function useContext<T>(context: RainContext<T>): T {
  if (!currentFiber) throwHookError("useContext");
  return context._currentValue;
}

export function flushPendingEffects(): void {
  const effects = [...pendingEffects];
  pendingEffects.length = 0;
  for (const { fiber, index } of effects) {
    const hook = fiber.hooks[index];
    if (!hook || hook.kind !== "effect") continue;
    if (hook.cleanup) hook.cleanup();
    const result = hook.effect();
    hook.cleanup =
      typeof result === "function" ? (result as () => void) : undefined;
  }
}

export function cleanupFiberEffects(fiber: Fiber): void {
  for (const hook of fiber.hooks) {
    if (hook.kind === "effect" && hook.cleanup) {
      hook.cleanup();
      hook.cleanup = undefined;
    }
  }
}

export function hasPendingEffects(): boolean {
  return pendingEffects.length > 0;
}
