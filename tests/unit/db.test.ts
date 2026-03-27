import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bindings } from "../../src/framework/bindings";
import { db } from "../../src/framework/db";

vi.mock("drizzle-orm/d1", () => ({
  drizzle: vi.fn(() => ({ fake: "drizzle-instance" })),
}));

vi.mock("../../src/framework/bindings", () => ({
  bindings: vi.fn(),
}));

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
});
