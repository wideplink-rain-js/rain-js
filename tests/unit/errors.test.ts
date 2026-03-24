import { describe, expect, it } from "vitest";
import { HttpError } from "../../src/framework";

describe("HttpError", () => {
  it("has status and message", () => {
    const error = new HttpError(404, "not found");
    expect(error.status).toBe(404);
    expect(error.message).toBe("not found");
  });

  it("extends Error", () => {
    const error = new HttpError(500, "internal");
    expect(error).toBeInstanceOf(Error);
  });

  it("supports error cause", () => {
    const cause = new Error("root");
    const error = new HttpError(500, "wrapped", { cause });
    expect(error.cause).toBe(cause);
  });
});
