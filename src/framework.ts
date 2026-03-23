export class Context {
  readonly req: Request;
  readonly params: Record<string, string>;
  readonly state: Map<string, unknown>;

  constructor(req: Request, params: Record<string, string>) {
    this.req = req;
    this.params = params;
    this.state = new Map();
  }

  json(data: unknown, status = 200): Response {
    let body: string;
    try {
      body = JSON.stringify(data);
    } catch (cause) {
      throw new Error(
        "[Rain] ctx.json() failed to serialize data. " +
          "Ensure the data is JSON-serializable " +
          "(no circular references, BigInt, or functions).",
        { cause },
      );
    }
    return new Response(body, {
      status,
      headers: { "content-type": "application/json; charset=UTF-8" },
    });
  }

  html(body: string, status = 200): Response {
    return new Response(body, {
      status,
      headers: { "content-type": "text/html; charset=UTF-8" },
    });
  }

  text(body: string, status = 200): Response {
    return new Response(body, {
      status,
      headers: { "content-type": "text/plain; charset=UTF-8" },
    });
  }

  redirect(
    location: string,
    status = 302,
    options?: { allowExternal?: boolean },
  ): Response {
    const allowExternal = options?.allowExternal ?? false;

    try {
      const targetUrl = new URL(location, this.req.url);
      const currentOrigin = new URL(this.req.url).origin;

      if (targetUrl.origin !== currentOrigin && !allowExternal) {
        throw new Error(
          `[Rain] ctx.redirect() attempted to redirect to external URL "${location}". ` +
            `External redirects may be vulnerable to open redirect attacks. ` +
            `If this is intentional, use: ctx.redirect("${location}", ${status}, { allowExternal: true })`,
        );
      }
    } catch (cause) {
      if (cause instanceof Error && cause.message.startsWith("[Rain]")) {
        throw cause;
      }
    }

    return new Response(null, {
      status,
      headers: { location },
    });
  }
}

export type Handler = (ctx: Context) => Response | Promise<Response>;

export type Middleware = (
  ctx: Context,
  next: () => Promise<Response>,
) => Response | Promise<Response>;

export type ErrorHandler = (
  error: unknown,
  req: Request,
) => Response | Promise<Response>;

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string, options?: ErrorOptions) {
    super(message, options);
    this.status = status;
  }
}

interface Route {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: Handler;
  middlewares: Middleware[];
}

export class Rain {
  private routes: Route[] = [];
  private globalMiddlewares: Middleware[] = [];
  private errorHandler: ErrorHandler | undefined;

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
        return new Response("Method Not Allowed", { status: 405 });
      }

      return new Response("Not Found", { status: 404 });
    } catch (error) {
      return this.handleError(error, request, pathname);
    }
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
