import { describe, expect, it } from "vitest";
import {
  createElement,
  Fragment,
  RAIN_ELEMENT,
} from "../../../src/framework/jsx";

describe("createElement", () => {
  it("creates an element with tag and children", () => {
    const el = createElement("div", null, "hello");
    expect(el.$$typeof).toBe(RAIN_ELEMENT);
    expect(el.tag).toBe("div");
    expect(el.children).toEqual(["hello"]);
  });

  it("passes props", () => {
    const el = createElement("a", { href: "/" });
    expect(el.props).toEqual({ href: "/" });
  });

  it("defaults null props to empty object", () => {
    const el = createElement("div", null);
    expect(el.props).toEqual({});
  });

  it("collects multiple children", () => {
    const el = createElement("div", null, "a", "b", "c");
    expect(el.children).toEqual(["a", "b", "c"]);
  });
});

describe("Fragment", () => {
  it("creates a fragment element", () => {
    const el = Fragment({ children: ["a", "b"] });
    expect(el.$$typeof).toBe(RAIN_ELEMENT);
    expect(el.tag).toBe(Fragment);
    expect(el.children).toEqual(["a", "b"]);
  });

  it("defaults children to empty array", () => {
    const el = Fragment({});
    expect(el.children).toEqual([]);
  });
});
