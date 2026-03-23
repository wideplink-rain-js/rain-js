import { Context } from "./context";
import { HttpError } from "./errors";
import type { ErrorHandler, Handler, Middleware, RainOptions } from "./types";
import { escapeRegExp } from "./utils/regexp";
import { safeDecodeURIComponent } from "./utils/url";

interface Route {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: Handler;
  middlewares: Middleware[];
}

const SECURITY_HEADERS: ReadonlyArray<readonly [string, string]> = [
  ["X-Content-Type-Options", "nosniff"],
  ["X-Frame-Options", "DENY"],
  ["Referrer-Policy", "strict-origin-when-cross-origin"],
  ["X-XSS-Protection", "0"],
];

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "DELETE"]);

export class Rain {
  private routes: Route[] = [];
  private globalMiddlewares: Middleware[] = [];
  private errorHandler: ErrorHandler | undefined;
  private csrfProtection: boolean;

  constructor(options?: RainOptions) {
    this.csrfProtection = options?.csrfProtection ?? true;
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

  async fetch(request: Request): Promise<Response> {
    const response = await this.handleRequest(request);
    return this.applySecurityHeaders(response);
  }

  private async handleRequest(request: Request): Promise<Response> {
    const csrfResponse = this.validateCsrf(request);
    if (csrfResponse) return csrfResponse;

    const { pathname } = new URL(request.url);
    const method = request.method;

    try {
      let pathMatched = false;

      for (const route of this.routes) {
        const match = pathname.match(route.pattern);
        if (!match) continue;

        pathMatched = true;

        if (route.method !== method) continue;

        const params: Record<string, string> = {};
        route.paramNames.forEach((name, i) => {
          const value = match[i + 1];
          if (value !== undefined) {
            params[name] = safeDecodeURIComponent(value);
          }
        });

        const ctx = new Context(request, params);
        const allMiddlewares =
          this.globalMiddlewares.length === 0
            ? route.middlewares
            : [...this.globalMiddlewares, ...route.middlewares];
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
        return new Response("Method Not Allowed", {
          status: 405,
        });
      }

      return new Response("Not Found", { status: 404 });
    } catch (error) {
      return this.handleError(error, request, pathname);
    }
  }

  private applySecurityHeaders(response: Response): Response {
    const headers = new Headers(response.headers);
    let modified = false;
    for (const [name, value] of SECURITY_HEADERS) {
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
      "new Rain({ csrfProtection: false })";
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
