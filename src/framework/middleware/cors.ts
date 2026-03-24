import type { Context } from "../context";
import type { Middleware } from "../types";

export interface CorsOptions {
  origin: string | string[] | ((origin: string, ctx: Context) => boolean);
  methods?: string[];
  allowHeaders?: string[];
  exposeHeaders?: string[];
  maxAge?: number;
  credentials?: boolean;
}

const DEFAULT_METHODS = ["GET", "HEAD", "POST"];
const DEFAULT_MAX_AGE = 86400;

function isOriginAllowed(
  requestOrigin: string,
  allowed: CorsOptions["origin"],
  ctx: Context,
): boolean {
  if (allowed === "*") return true;
  if (typeof allowed === "string") return requestOrigin === allowed;
  if (typeof allowed === "function") return allowed(requestOrigin, ctx);
  return allowed.includes(requestOrigin);
}

function resolveAllowOriginHeader(
  requestOrigin: string,
  allowed: CorsOptions["origin"],
): string {
  if (allowed === "*") return "*";
  return requestOrigin;
}

function setCorsHeaders(
  headers: Headers,
  requestOrigin: string,
  options: CorsOptions,
): void {
  headers.set(
    "Access-Control-Allow-Origin",
    resolveAllowOriginHeader(requestOrigin, options.origin),
  );

  if (options.origin !== "*") {
    headers.append("Vary", "Origin");
  }

  if (options.credentials) {
    headers.set("Access-Control-Allow-Credentials", "true");
  }

  if (options.exposeHeaders && options.exposeHeaders.length > 0) {
    headers.set(
      "Access-Control-Expose-Headers",
      options.exposeHeaders.join(", "),
    );
  }
}

function handlePreflight(
  ctx: Context,
  requestOrigin: string,
  options: CorsOptions,
): Response {
  const headers = new Headers();

  setCorsHeaders(headers, requestOrigin, options);

  const methods = options.methods ?? DEFAULT_METHODS;
  headers.set("Access-Control-Allow-Methods", methods.join(", "));

  if (options.allowHeaders && options.allowHeaders.length > 0) {
    headers.set(
      "Access-Control-Allow-Headers",
      options.allowHeaders.join(", "),
    );
  } else {
    const requested = ctx.req.headers.get("Access-Control-Request-Headers");
    if (requested) {
      headers.set("Access-Control-Allow-Headers", requested);
      headers.append("Vary", "Access-Control-Request-Headers");
    }
  }

  const maxAge = options.maxAge ?? DEFAULT_MAX_AGE;
  headers.set("Access-Control-Max-Age", String(maxAge));

  return new Response(null, { status: 204, headers });
}

export function cors(options: CorsOptions): Middleware {
  if (options.origin === "*" && options.credentials) {
    throw new Error(
      '[Rain] CORS misconfiguration: origin "*" cannot be used ' +
        "with credentials: true. Browsers will reject this " +
        "combination. Use a specific origin or origin list instead.",
    );
  }

  return async (ctx: Context, next: () => Promise<Response>) => {
    const requestOrigin = ctx.req.headers.get("Origin");

    if (!requestOrigin) {
      return next();
    }

    if (!isOriginAllowed(requestOrigin, options.origin, ctx)) {
      return next();
    }

    if (ctx.method === "OPTIONS") {
      return handlePreflight(ctx, requestOrigin, options);
    }

    const response = await next();
    const headers = new Headers(response.headers);
    setCorsHeaders(headers, requestOrigin, options);

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
}
