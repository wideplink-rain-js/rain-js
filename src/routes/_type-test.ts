import type { JSX } from "rain-js/jsx-runtime";
import type { Context } from "../framework/context";
import type { RainElement } from "../framework/jsx/types";

declare const ctx: Context;
declare const el: RainElement;
declare const jsxEl: JSX.Element;

jsxEl satisfies RainElement | string;

ctx.html(el);
ctx.html(jsxEl);
ctx.html("hello");
