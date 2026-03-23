import type { Handler } from "../../../framework";

export const GET: Handler = (_req, params) => {
  return new Response(`User ID: ${params["id"]}`);
};
