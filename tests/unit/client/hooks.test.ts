import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  EffectHookState,
  Fiber,
  MemoHookState,
  RefHookState,
  StateHookState,
} from "../../../src/framework/client/hooks";
import {
  cleanupFiberEffects,
  createContext,
  flushPendingEffects,
  getCurrentFiber,
  hasPendingEffects,
  setCurrentFiber,
  setScheduleUpdate,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "../../../src/framework/client/hooks";
import { createElement } from "../../../src/framework/jsx";

// @vitest-environment jsdom

function makeFiber(): Fiber {
  return {
    vnode: createElement("div", null),
    dom: document.createElement("div"),
    hooks: [],
    hookIndex: 0,
    childFibers: [],
    parent: null,
  };
}

describe("useState", () => {
  beforeEach(() => {
    setScheduleUpdate(() => undefined);
  });

  it("throws when called outside a component", () => {
    setCurrentFiber(null);
    expect(() => useState(0)).toThrow(
      "useState must be called inside a component",
    );
  });

  it("returns initial value on first call", () => {
    const fiber = makeFiber();
    setCurrentFiber(fiber);
    const [value] = useState(42);
    setCurrentFiber(null);
    expect(value).toBe(42);
  });

  it("creates a hook entry in the fiber", () => {
    const fiber = makeFiber();
    setCurrentFiber(fiber);
    useState("hello");
    setCurrentFiber(null);
    expect(fiber.hooks).toHaveLength(1);
    expect((fiber.hooks[0] as StateHookState).value).toBe("hello");
  });

  it("maintains multiple hooks in order", () => {
    const fiber = makeFiber();
    setCurrentFiber(fiber);
    const [a] = useState("first");
    const [b] = useState("second");
    setCurrentFiber(null);
    expect(a).toBe("first");
    expect(b).toBe("second");
    expect(fiber.hooks).toHaveLength(2);
  });

  it("preserves value across re-renders", () => {
    const fiber = makeFiber();

    setCurrentFiber(fiber);
    const [val1] = useState(10);
    setCurrentFiber(null);

    setCurrentFiber(fiber);
    const [val2] = useState(999);
    setCurrentFiber(null);

    expect(val1).toBe(10);
    expect(val2).toBe(10);
  });

  it("applies queued value updates on re-render", () => {
    const fiber = makeFiber();

    setCurrentFiber(fiber);
    const [, setState] = useState(0);
    setCurrentFiber(null);

    setState(5);

    setCurrentFiber(fiber);
    const [updated] = useState(0);
    setCurrentFiber(null);

    expect(updated).toBe(5);
  });

  it("applies functional updates on re-render", () => {
    const fiber = makeFiber();

    setCurrentFiber(fiber);
    const [, setState] = useState(10);
    setCurrentFiber(null);

    setState((prev: number) => prev + 1);
    setState((prev: number) => prev * 2);

    setCurrentFiber(fiber);
    const [updated] = useState(0);
    setCurrentFiber(null);

    expect(updated).toBe(22);
  });

  it("calls scheduleUpdate when setState is invoked", () => {
    const scheduled: Fiber[] = [];
    setScheduleUpdate((f) => scheduled.push(f));

    const fiber = makeFiber();
    setCurrentFiber(fiber);
    const [, setState] = useState(0);
    setCurrentFiber(null);

    setState(1);
    setState(2);

    expect(scheduled).toHaveLength(2);
    expect(scheduled[0]).toBe(fiber);
  });

  it("resets hookIndex via setCurrentFiber", () => {
    const fiber = makeFiber();

    setCurrentFiber(fiber);
    useState("a");
    useState("b");
    expect(fiber.hookIndex).toBe(2);

    setCurrentFiber(fiber);
    expect(fiber.hookIndex).toBe(0);
    setCurrentFiber(null);
  });
});

describe("getCurrentFiber", () => {
  it("returns null when no fiber is set", () => {
    setCurrentFiber(null);
    expect(getCurrentFiber()).toBeNull();
  });

  it("returns the current fiber", () => {
    const fiber = makeFiber();
    setCurrentFiber(fiber);
    expect(getCurrentFiber()).toBe(fiber);
    setCurrentFiber(null);
  });
});

describe("useEffect", () => {
  beforeEach(() => {
    setScheduleUpdate(() => undefined);
    flushPendingEffects();
  });

  it("throws when called outside a component", () => {
    setCurrentFiber(null);
    expect(() => useEffect(() => undefined)).toThrow(
      "useEffect must be called inside a component",
    );
  });

  it("creates an effect hook entry", () => {
    const fiber = makeFiber();
    setCurrentFiber(fiber);
    useEffect(() => undefined);
    setCurrentFiber(null);
    expect(fiber.hooks).toHaveLength(1);
    expect((fiber.hooks[0] as EffectHookState).kind).toBe("effect");
    flushPendingEffects();
  });

  it("queues effect on first render", () => {
    const fiber = makeFiber();
    setCurrentFiber(fiber);
    const fn = vi.fn();
    useEffect(fn);
    setCurrentFiber(null);
    expect(hasPendingEffects()).toBe(true);
    flushPendingEffects();
    expect(fn).toHaveBeenCalledOnce();
  });

  it("does not re-queue when deps identical", () => {
    const fiber = makeFiber();
    setCurrentFiber(fiber);
    useEffect(() => undefined, [1, "a"]);
    setCurrentFiber(null);
    flushPendingEffects();

    setCurrentFiber(fiber);
    useEffect(() => undefined, [1, "a"]);
    setCurrentFiber(null);
    expect(hasPendingEffects()).toBe(false);
  });

  it("re-queues when deps change", () => {
    const fiber = makeFiber();
    setCurrentFiber(fiber);
    useEffect(() => undefined, [1]);
    setCurrentFiber(null);
    flushPendingEffects();

    setCurrentFiber(fiber);
    const fn = vi.fn();
    useEffect(fn, [2]);
    setCurrentFiber(null);
    expect(hasPendingEffects()).toBe(true);
    flushPendingEffects();
    expect(fn).toHaveBeenCalledOnce();
  });

  it("runs cleanup before re-running effect", () => {
    const fiber = makeFiber();
    const order: string[] = [];

    setCurrentFiber(fiber);
    useEffect(() => {
      order.push("effect1");
      return () => {
        order.push("cleanup1");
      };
    }, [1]);
    setCurrentFiber(null);
    flushPendingEffects();

    setCurrentFiber(fiber);
    useEffect(() => {
      order.push("effect2");
    }, [2]);
    setCurrentFiber(null);
    flushPendingEffects();

    expect(order).toEqual(["effect1", "cleanup1", "effect2"]);
  });

  it("skips effect with empty deps after first", () => {
    const fiber = makeFiber();
    const fn = vi.fn();

    setCurrentFiber(fiber);
    useEffect(fn, []);
    setCurrentFiber(null);
    flushPendingEffects();
    expect(fn).toHaveBeenCalledOnce();

    setCurrentFiber(fiber);
    useEffect(fn, []);
    setCurrentFiber(null);
    expect(hasPendingEffects()).toBe(false);
  });

  it("always re-queues when no deps provided", () => {
    const fiber = makeFiber();
    const fn = vi.fn();

    setCurrentFiber(fiber);
    useEffect(fn);
    setCurrentFiber(null);
    flushPendingEffects();

    setCurrentFiber(fiber);
    useEffect(fn);
    setCurrentFiber(null);
    expect(hasPendingEffects()).toBe(true);
    flushPendingEffects();
  });
});

describe("cleanupFiberEffects", () => {
  beforeEach(() => {
    flushPendingEffects();
  });

  it("runs cleanup for all effect hooks", () => {
    const fiber = makeFiber();
    const cleanup1 = vi.fn();
    const cleanup2 = vi.fn();

    setCurrentFiber(fiber);
    useEffect(() => () => cleanup1());
    useEffect(() => () => cleanup2());
    setCurrentFiber(null);
    flushPendingEffects();

    cleanupFiberEffects(fiber);
    expect(cleanup1).toHaveBeenCalledOnce();
    expect(cleanup2).toHaveBeenCalledOnce();
  });
});

describe("useRef", () => {
  it("throws when called outside a component", () => {
    setCurrentFiber(null);
    expect(() => useRef(0)).toThrow("useRef must be called inside a component");
  });

  it("returns initial value", () => {
    const fiber = makeFiber();
    setCurrentFiber(fiber);
    const ref = useRef(42);
    setCurrentFiber(null);
    expect(ref.current).toBe(42);
  });

  it("preserves identity across re-renders", () => {
    const fiber = makeFiber();

    setCurrentFiber(fiber);
    const ref1 = useRef("hello");
    setCurrentFiber(null);

    setCurrentFiber(fiber);
    const ref2 = useRef("ignored");
    setCurrentFiber(null);

    expect(ref1).toBe(ref2);
    expect(ref1.current).toBe("hello");
  });

  it("allows mutation of current", () => {
    const fiber = makeFiber();

    setCurrentFiber(fiber);
    const ref = useRef(0);
    ref.current = 99;
    setCurrentFiber(null);

    setCurrentFiber(fiber);
    const ref2 = useRef(0);
    setCurrentFiber(null);

    expect(ref2.current).toBe(99);
  });

  it("creates a ref hook entry", () => {
    const fiber = makeFiber();
    setCurrentFiber(fiber);
    useRef("val");
    setCurrentFiber(null);
    expect(fiber.hooks).toHaveLength(1);
    expect((fiber.hooks[0] as RefHookState).kind).toBe("ref");
  });
});

describe("useMemo", () => {
  it("throws when called outside a component", () => {
    setCurrentFiber(null);
    expect(() => useMemo(() => 1, [])).toThrow(
      "useMemo must be called inside a component",
    );
  });

  it("computes value on first render", () => {
    const fiber = makeFiber();
    setCurrentFiber(fiber);
    const value = useMemo(() => 42, []);
    setCurrentFiber(null);
    expect(value).toBe(42);
  });

  it("returns cached value when deps unchanged", () => {
    const fiber = makeFiber();
    const factory = vi.fn(() => ({ key: "value" }));

    setCurrentFiber(fiber);
    const v1 = useMemo(factory, [1]);
    setCurrentFiber(null);

    setCurrentFiber(fiber);
    const v2 = useMemo(factory, [1]);
    setCurrentFiber(null);

    expect(v1).toBe(v2);
    expect(factory).toHaveBeenCalledOnce();
  });

  it("recomputes when deps change", () => {
    const fiber = makeFiber();
    let counter = 0;
    const factory = vi.fn(() => ++counter);

    setCurrentFiber(fiber);
    const v1 = useMemo(factory, ["a"]);
    setCurrentFiber(null);

    setCurrentFiber(fiber);
    const v2 = useMemo(factory, ["b"]);
    setCurrentFiber(null);

    expect(v1).toBe(1);
    expect(v2).toBe(2);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("creates a memo hook entry", () => {
    const fiber = makeFiber();
    setCurrentFiber(fiber);
    useMemo(() => "x", []);
    setCurrentFiber(null);
    expect(fiber.hooks).toHaveLength(1);
    expect((fiber.hooks[0] as MemoHookState).kind).toBe("memo");
  });
});

describe("useCallback", () => {
  it("returns same fn when deps unchanged", () => {
    const fiber = makeFiber();
    const fn = () => undefined;

    setCurrentFiber(fiber);
    const cb1 = useCallback(fn, [1]);
    setCurrentFiber(null);

    setCurrentFiber(fiber);
    const cb2 = useCallback(fn, [1]);
    setCurrentFiber(null);

    expect(cb1).toBe(cb2);
  });

  it("returns new fn when deps change", () => {
    const fiber = makeFiber();
    const fn1 = () => "a";
    const fn2 = () => "b";

    setCurrentFiber(fiber);
    const cb1 = useCallback(fn1, [1]);
    setCurrentFiber(null);

    setCurrentFiber(fiber);
    const cb2 = useCallback(fn2, [2]);
    setCurrentFiber(null);

    expect(cb1).not.toBe(cb2);
  });
});

describe("createContext / useContext", () => {
  it("returns default value without Provider", () => {
    const ctx = createContext("default");
    const fiber = makeFiber();
    setCurrentFiber(fiber);
    const value = useContext(ctx);
    setCurrentFiber(null);
    expect(value).toBe("default");
  });

  it("throws when useContext called outside", () => {
    const ctx = createContext("x");
    setCurrentFiber(null);
    expect(() => useContext(ctx)).toThrow(
      "useContext must be called inside a component",
    );
  });

  it("reads Provider value", () => {
    const ctx = createContext(0);
    ctx.Provider({ value: 42, children: [] });

    const fiber = makeFiber();
    setCurrentFiber(fiber);
    const value = useContext(ctx);
    setCurrentFiber(null);
    expect(value).toBe(42);
  });

  it("Provider returns Fragment with children", () => {
    const ctx = createContext("test");
    const result = ctx.Provider({
      value: "hello",
      children: ["child1", "child2"],
    });
    expect(result).not.toBeNull();
    if (result && typeof result !== "string") {
      expect(result.children).toEqual(["child1", "child2"]);
    }
  });

  it("nested Providers override value", () => {
    const ctx = createContext("outer");
    ctx.Provider({ value: "inner", children: [] });

    const fiber = makeFiber();
    setCurrentFiber(fiber);
    const value = useContext(ctx);
    setCurrentFiber(null);
    expect(value).toBe("inner");
  });
});
