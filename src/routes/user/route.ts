import type { Handler } from "../../framework";

export const GET: Handler = (_req, _params) => {
  return new Response(`User`);
};
