import { describe, expect, it } from "vitest";
import {
  bindings,
  requestLocal,
  runWithBindings,
} from "../../src/framework/bindings";

describe("bindings()", () => {
  it("リクエストコンテキスト外で呼ぶとエラー", () => {
    expect(() => bindings()).toThrow(
      "[Rain] bindings() was called outside of a request",
    );
  });

  it("runWithBindings 内で env が取得できる", () => {
    const env = { DB: "test-db" };
    runWithBindings(env, () => {
      expect(bindings()).toEqual({ DB: "test-db" });
    });
  });
});

describe("requestLocal()", () => {
  it("リクエストコンテキスト外では毎回 init を呼ぶ", () => {
    let callCount = 0;
    const key = Symbol.for("test.outside");
    const a = requestLocal(key, () => ++callCount);
    const b = requestLocal(key, () => ++callCount);
    expect(a).toBe(1);
    expect(b).toBe(2);
  });

  it("同一リクエスト内では同じキーに対してキャッシュが効く", () => {
    let callCount = 0;
    const key = Symbol.for("test.cached");
    runWithBindings({}, () => {
      const a = requestLocal(key, () => ++callCount);
      const b = requestLocal(key, () => ++callCount);
      expect(a).toBe(1);
      expect(b).toBe(1);
      expect(callCount).toBe(1);
    });
  });

  it("異なるキーは別々にキャッシュされる", () => {
    const keyA = Symbol.for("test.a");
    const keyB = Symbol.for("test.b");
    runWithBindings({}, () => {
      const a = requestLocal(keyA, () => "value-a");
      const b = requestLocal(keyB, () => "value-b");
      expect(a).toBe("value-a");
      expect(b).toBe("value-b");
    });
  });

  it("異なるリクエスト間ではキャッシュが共有されない", () => {
    const key = Symbol.for("test.isolation");
    const results: string[] = [];
    runWithBindings({}, () => {
      results.push(requestLocal(key, () => "req-1"));
    });
    runWithBindings({}, () => {
      results.push(requestLocal(key, () => "req-2"));
    });
    expect(results).toEqual(["req-1", "req-2"]);
  });
});
