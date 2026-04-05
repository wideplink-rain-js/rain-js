import { drizzle } from "drizzle-orm/d1";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bindings } from "../../src/framework/bindings";
import { db } from "../../src/framework/db";

vi.mock("drizzle-orm/d1", () => ({
  drizzle: vi.fn(() => ({ fake: "drizzle-instance" })),
}));

vi.mock("../../src/framework/bindings", () => {
  let store: Map<symbol, unknown> | undefined;
  return {
    bindings: vi.fn(),
    requestLocal: vi.fn(<T>(key: symbol, init: () => T): T => {
      if (!store) return init();
      const existing = store.get(key);
      if (existing !== undefined) return existing as T;
      const value = init();
      store.set(key, value);
      return value;
    }),
    _enableStore: () => {
      store = new Map();
    },
    _disableStore: () => {
      store = undefined;
    },
  };
});

const mockedDrizzle = vi.mocked(drizzle);
const mockedBindings = vi.mocked(bindings);

describe("db()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedDrizzle.mockReturnValue({
      fake: "drizzle-instance",
    } as unknown as ReturnType<typeof drizzle>);
  });

  it("d1Binding を直接渡した場合、drizzle に渡される", () => {
    const fakeD1 = { fake: "d1" } as unknown as D1Database;
    db(fakeD1);
    expect(mockedDrizzle).toHaveBeenCalledWith(fakeD1);
    expect(mockedBindings).not.toHaveBeenCalled();
  });

  it("d1Binding なしの場合、bindings().DB を使う", () => {
    const fakeD1 = { fake: "d1" } as unknown as D1Database;
    mockedBindings.mockReturnValue({ DB: fakeD1 } as unknown as Env);
    db();
    expect(mockedDrizzle).toHaveBeenCalledWith(fakeD1);
  });

  it("bindings().DB が undefined の場合、エラーを throw", () => {
    mockedBindings.mockReturnValue({ DB: undefined } as unknown as Env);
    expect(() => db()).toThrow('[Rain] D1 binding "DB" was not found');
  });

  it("bindings().DB が null の場合もエラーを throw", () => {
    mockedBindings.mockReturnValue({ DB: null } as unknown as Env);
    expect(() => db()).toThrow('[Rain] D1 binding "DB" was not found');
  });

  it("bindings() 自体がエラーを throw する場合、そのエラーが伝播する", () => {
    mockedBindings.mockImplementation(() => {
      throw new Error(
        "[Rain] bindings() was called outside of a request context",
      );
    });
    expect(() => db()).toThrow("[Rain] bindings() was called outside");
  });

  it("drizzle の戻り値がそのまま返される", () => {
    const fakeDrizzleResult = {
      select: vi.fn(),
      insert: vi.fn(),
    };
    mockedDrizzle.mockReturnValue(
      fakeDrizzleResult as unknown as ReturnType<typeof drizzle>,
    );
    const fakeD1 = {
      fake: "d1",
    } as unknown as D1Database;
    const result = db(fakeD1);
    expect(result).toBe(fakeDrizzleResult);
  });

  it("options.schema を渡した場合、drizzle に schema が渡される", () => {
    const fakeD1 = { fake: "d1" } as unknown as D1Database;
    const fakeSchema = { users: {} } as Record<string, unknown>;
    mockedBindings.mockReturnValue({ DB: fakeD1 } as unknown as Env);
    db({ schema: fakeSchema });
    expect(mockedDrizzle).toHaveBeenCalledWith(fakeD1, {
      schema: fakeSchema,
    });
  });

  it("options.d1 を渡した場合、bindings を使わない", () => {
    const fakeD1 = { fake: "d1" } as unknown as D1Database;
    db({ d1: fakeD1 });
    expect(mockedDrizzle).toHaveBeenCalledWith(fakeD1);
    expect(mockedBindings).not.toHaveBeenCalled();
  });
});

const bindingsMod = (await import(
  "../../src/framework/bindings"
)) as unknown as Record<string, () => void>;
const enableStore = bindingsMod["_enableStore"] as () => void;
const disableStore = bindingsMod["_disableStore"] as () => void;

describe("db() request-scoped cache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    let callCount = 0;
    mockedDrizzle.mockImplementation(
      () =>
        ({
          id: `instance-${++callCount}`,
        }) as unknown as ReturnType<typeof drizzle>,
    );
    enableStore();
  });

  afterEach(() => {
    disableStore();
  });

  it("同一リクエスト内で同じ D1 に対して同一インスタンスを返す", () => {
    const fakeD1 = { fake: "d1" } as unknown as D1Database;
    const first = db(fakeD1);
    const second = db(fakeD1);
    expect(first).toBe(second);
    expect(mockedDrizzle).toHaveBeenCalledTimes(1);
  });

  it("異なる D1 に対しては別のインスタンスを返す", () => {
    const d1a = { id: "a" } as unknown as D1Database;
    const d1b = { id: "b" } as unknown as D1Database;
    const first = db(d1a);
    const second = db(d1b);
    expect(first).not.toBe(second);
    expect(mockedDrizzle).toHaveBeenCalledTimes(2);
  });

  it("同じ D1 + schema でキャッシュが効く", () => {
    const fakeD1 = { fake: "d1" } as unknown as D1Database;
    const fakeSchema = { users: {} } as Record<string, unknown>;
    mockedBindings.mockReturnValue({ DB: fakeD1 } as unknown as Env);
    const first = db({ schema: fakeSchema });
    const second = db({ schema: fakeSchema });
    expect(first).toBe(second);
    expect(mockedDrizzle).toHaveBeenCalledTimes(1);
  });

  it("同じ D1 でも schema が異なれば別インスタンス", () => {
    const fakeD1 = { fake: "d1" } as unknown as D1Database;
    mockedBindings.mockReturnValue({ DB: fakeD1 } as unknown as Env);
    const schemaA = { users: {} } as Record<string, unknown>;
    const schemaB = { posts: {} } as Record<string, unknown>;
    const first = db({ schema: schemaA });
    const second = db({ schema: schemaB });
    expect(first).not.toBe(second);
    expect(mockedDrizzle).toHaveBeenCalledTimes(2);
  });

  it("ストアがない場合は毎回新しいインスタンスを生成", () => {
    disableStore();
    const fakeD1 = { fake: "d1" } as unknown as D1Database;
    const first = db(fakeD1);
    const second = db(fakeD1);
    expect(first).not.toBe(second);
    expect(mockedDrizzle).toHaveBeenCalledTimes(2);
  });
});
