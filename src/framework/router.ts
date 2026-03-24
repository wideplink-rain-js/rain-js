import { runWithBindings } from "./bindings";
import { Context } from "./context";
import { HttpError } from "./errors";
import { renderToString } from "./jsx";
import type { RainElement } from "./jsx/types";
import type {
  ErrorHandler,
  Handler,
  LayoutHandler,
  Middleware,
  PageHandler,
  RainConfig,
  RainOptions,
} from "./types";
import { escapeRegExp } from "./utils/regexp";
import { safeDecodeURIComponent } from "./utils/url";

interface Route {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: Handler;
  middlewares: Middleware[];
}

const DEFAULT_SECURITY_HEADERS: ReadonlyArray<readonly [string, string]> = [
  ["X-Content-Type-Options", "nosniff"],
  ["X-Frame-Options", "DENY"],
  ["Referrer-Policy", "strict-origin-when-cross-origin"],
  ["X-XSS-Protection", "0"],
];

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "DELETE", "PATCH"]);

function resolveSecurityHeaders(
  config: Record<string, string> | false | undefined,
): ReadonlyArray<readonly [string, string]> {
  if (config === false) return [];
  if (!config) return DEFAULT_SECURITY_HEADERS;
  const merged = new Map<string, string>(
    DEFAULT_SECURITY_HEADERS.map(([k, v]) => [k, v]),
  );
  for (const [key, value] of Object.entries(config)) {
    merged.set(key, value);
  }
  return [...merged.entries()].map(([k, v]) => [k, v] as const);
}

export class Rain {
  private routes: Route[] = [];
  private globalMiddlewares: Middleware[] = [];
  private errorHandler: ErrorHandler | undefined;
  private csrfProtection: boolean;
  private securityHeaders: ReadonlyArray<readonly [string, string]>;

  constructor(options?: RainConfig | RainOptions) {
    const csrf =
      (options as RainConfig | undefined)?.csrf ??
      (options as RainOptions | undefined)?.csrfProtection ??
      true;
    this.csrfProtection = csrf;
    this.securityHeaders = resolveSecurityHeaders(
      (options as RainConfig | undefined)?.securityHeaders,
    );
  }

  use(...middlewares: Middleware[]): void {
    this.globalMiddlewares.push(...middlewares);
  }

  private addRoute(
    method: string,
    path: string,
    handler: Handler,
    middlewares: Middleware[] = [],
  ): void {
    const paramNames: string[] = [];
    const segments = path.split("/");
    const regexPath = segments
      .map((segment) => {
        if (segment.startsWith(":")) {
          paramNames.push(segment.slice(1));
          return "([^/]+)";
        }
        return escapeRegExp(segment);
      })
      .join("/");

    const seen = new Set<string>();
    for (const name of paramNames) {
      if (seen.has(name)) {
        throw new Error(
          `Duplicate parameter name ':${name}' in route ${path}. ` +
            "Rename the directory so that parameter names are unique.",
        );
      }
      seen.add(name);
    }

    this.routes.push({
      method,
      pattern: new RegExp(`^${regexPath}$`),
      paramNames,
      handler,
      middlewares,
    });
  }

  onError(handler: ErrorHandler): void {
    this.errorHandler = handler;
  }

  get(path: string, handler: Handler, middlewares?: Middleware[]): void {
    this.addRoute("GET", path, handler, middlewares);
  }

  post(path: string, handler: Handler, middlewares?: Middleware[]): void {
    this.addRoute("POST", path, handler, middlewares);
  }

  put(path: string, handler: Handler, middlewares?: Middleware[]): void {
    this.addRoute("PUT", path, handler, middlewares);
  }

  delete(path: string, handler: Handler, middlewares?: Middleware[]): void {
    this.addRoute("DELETE", path, handler, middlewares);
  }

  patch(path: string, handler: Handler, middlewares?: Middleware[]): void {
    this.addRoute("PATCH", path, handler, middlewares);
  }

  head(path: string, handler: Handler, middlewares?: Middleware[]): void {
    this.addRoute("HEAD", path, handler, middlewares);
  }

  options(path: string, handler: Handler, middlewares?: Middleware[]): void {
    this.addRoute("OPTIONS", path, handler, middlewares);
  }

  page(
    path: string,
    handler: PageHandler,
    layouts: LayoutHandler[] = [],
    middlewares: Middleware[] = [],
    doctype = false,
  ): void {
    const wrappedHandler: Handler = async (ctx: Context) => {
      let content: RainElement = await handler(ctx);
      for (let i = layouts.length - 1; i >= 0; i--) {
        try {
          content = await (layouts[i] as LayoutHandler)(ctx, content);
        } catch (cause) {
          const depth = layouts.length - i;
          const total = layouts.length;
          throw new Error(
            `[Rain] Layout error at depth ${depth}/${total}` +
              ` while rendering page '${path}'.` +
              " Check your layout.tsx files for this route.",
            { cause },
          );
        }
      }
      const html = renderToString(content);
      const body = doctype ? `<!DOCTYPE html>\n${html}` : html;
      return new Response(body, {
        status: 200,
        headers: { "content-type": "text/html; charset=UTF-8" },
      });
    };
    this.addRoute("GET", path, wrappedHandler, middlewares);
  }

  private composeMiddlewares(
    middlewares: Middleware[],
    handler: Handler,
  ): (ctx: Context) => Promise<Response> {
    return (ctx: Context) => {
      let index = -1;
      const dispatch = (i: number): Promise<Response> => {
        if (i <= index) {
          return Promise.reject(
            new Error(
              "[Rain] next() was called multiple times in a middleware. " +
                "Each middleware must call next() at most once.",
            ),
          );
        }
        index = i;
        if (i < middlewares.length) {
          const mw = middlewares[i] as Middleware;
          return Promise.resolve(mw(ctx, () => dispatch(i + 1)));
        }
        return Promise.resolve(handler(ctx));
      };
      return dispatch(0);
    };
  }

  fetch(
    request: Request,
    env?: Env,
    _executionCtx?: ExecutionContext,
  ): Promise<Response> {
    const resolvedEnv = env ?? ({} as Env);
    return runWithBindings(resolvedEnv, async () => {
      const response = await this.handleRequest(request, resolvedEnv);
      return this.applySecurityHeaders(response);
    });
  }

  private mergeMiddlewares(routeMiddlewares: Middleware[]): Middleware[] {
    if (this.globalMiddlewares.length === 0 && routeMiddlewares.length === 0) {
      return [];
    }
    if (this.globalMiddlewares.length === 0) return routeMiddlewares;
    if (routeMiddlewares.length === 0) return this.globalMiddlewares;
    return [...this.globalMiddlewares, ...routeMiddlewares];
  }

  private async handleRequest(request: Request, env: Env): Promise<Response> {
    const csrfResponse = this.validateCsrf(request);
    if (csrfResponse) return csrfResponse;

    const { pathname } = new URL(request.url);
    const method = request.method;

    try {
      let pathMatched = false;
      let firstMatchedMiddlewares: Middleware[] | undefined;

      for (const route of this.routes) {
        const match = pathname.match(route.pattern);
        if (!match) continue;

        pathMatched = true;
        firstMatchedMiddlewares ??= route.middlewares;

        if (route.method !== method) continue;

        const params: Record<string, string> = {};
        route.paramNames.forEach((name, i) => {
          const value = match[i + 1];
          if (value !== undefined) {
            params[name] = safeDecodeURIComponent(value);
          }
        });

        const ctx = new Context(request, params, env);
        const allMiddlewares = this.mergeMiddlewares(route.middlewares);
        const composed = this.composeMiddlewares(allMiddlewares, route.handler);
        const response = await composed(ctx);

        if (!(response instanceof Response)) {
          const detail =
            `Route handler for ${method} ${pathname}` +
            " did not return a Response object.";
          const fix =
            "Return a Response from your handler:" +
            " return ctx.text('Hello') or return new Response(...)";
          console.error(`[Rain] ${detail} ${fix}`);
          return new Response("Internal Server Error", {
            status: 500,
          });
        }

        return response;
      }

      if (pathMatched) {
        return this.buildMethodNotAllowed(
          request,
          env,
          firstMatchedMiddlewares ?? [],
        );
      }

      return new Response("Not Found", { status: 404 });
    } catch (error) {
      return this.handleError(error, request, pathname);
    }
  }

  private buildMethodNotAllowed(
    request: Request,
    env: Env,
    routeMiddlewares: Middleware[],
  ): Response | Promise<Response> {
    const allMiddlewares = this.mergeMiddlewares(routeMiddlewares);
    if (allMiddlewares.length === 0) {
      return new Response("Method Not Allowed", { status: 405 });
    }
    const ctx = new Context(request, {}, env);
    const methodNotAllowed: Handler = () =>
      new Response("Method Not Allowed", { status: 405 });
    const composed = this.composeMiddlewares(allMiddlewares, methodNotAllowed);
    return composed(ctx);
  }

  private applySecurityHeaders(response: Response): Response {
    if (this.securityHeaders.length === 0) return response;
    const headers = new Headers(response.headers);
    let modified = false;
    for (const [name, value] of this.securityHeaders) {
      if (!headers.has(name)) {
        headers.set(name, value);
        modified = true;
      }
    }
    if (!modified) return response;
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  private validateCsrf(request: Request): Response | null {
    if (!this.csrfProtection) return null;
    if (!STATE_CHANGING_METHODS.has(request.method)) {
      return null;
    }

    const requestOrigin = new URL(request.url).origin;
    const origin = request.headers.get("Origin");

    if (origin) {
      if (origin !== requestOrigin) {
        return this.csrfForbiddenResponse(origin, requestOrigin);
      }
      return null;
    }

    const referer = request.headers.get("Referer");
    if (referer) {
      const refererOrigin = this.extractOrigin(referer);
      if (refererOrigin && refererOrigin !== requestOrigin) {
        return this.csrfForbiddenResponse(refererOrigin, requestOrigin);
      }
    }

    return null;
  }

  private extractOrigin(url: string): string | null {
    try {
      return new URL(url).origin;
    } catch {
      return null;
    }
  }

  private csrfForbiddenResponse(received: string, expected: string): Response {
    const message =
      "[Rain] CSRF validation failed: " +
      `Origin '${received}' does not match ` +
      `request origin '${expected}'. ` +
      "If this is a legitimate cross-origin " +
      "request, configure CORS or disable " +
      "CSRF protection: " +
      "new Rain({ csrf: false })";
    return new Response(message, {
      status: 403,
      headers: {
        "content-type": "text/plain; charset=UTF-8",
      },
    });
  }

  private async handleError(
    error: unknown,
    request: Request,
    pathname: string,
  ): Promise<Response> {
    if (this.errorHandler) {
      try {
        return await this.errorHandler(error, request);
      } catch (onErrorError) {
        console.error("[Rain] Error in onError handler.", onErrorError);
        return new Response("Internal Server Error", { status: 500 });
      }
    }

    if (error instanceof HttpError) {
      return new Response(error.message, { status: error.status });
    }

    console.error(
      `[Rain] Unhandled error on ${request.method} ${pathname}.`,
      "Use app.onError() to add custom error handling.",
      error,
    );
    return new Response("Internal Server Error", { status: 500 });
  }
}
