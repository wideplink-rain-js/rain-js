import type { Handler } from "../../../framework";

export const GET: Handler = (ctx) => {
  return ctx.text(`User ID: ${ctx.params["id"]}`);
};
