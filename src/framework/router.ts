import { runWithBindings } from "./bindings";
import type { ScriptDescriptor } from "./compiler/inject";
import { injectScripts } from "./compiler/inject";
import { Context } from "./context";
import { HttpError } from "./errors";
import { escapeHtml, renderToString } from "./jsx";
import type { RainElement } from "./jsx/types";
import type {
  ErrorHandler,
  Handler,
  LayoutHandler,
  Middleware,
  PageHandler,
  RainConfig,
  RainOptions,
  ServerActionHandler,
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
  private clientScriptDescriptors: ScriptDescriptor[];
  private actionHandlers: Map<string, ServerActionHandler> = new Map();

  constructor(options?: RainConfig | RainOptions) {
    const csrf =
      (options as RainConfig | undefined)?.csrf ??
      (options as RainOptions | undefined)?.csrfProtection ??
      true;
    this.csrfProtection = csrf;
    this.securityHeaders = resolveSecurityHeaders(
      (options as RainConfig | undefined)?.securityHeaders,
    );
    const scripts = (options as RainConfig | undefined)?.clientScripts ?? [];
    this.clientScriptDescriptors = scripts.map((src) => ({
      src,
    }));
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

  registerAction(id: string, handler: ServerActionHandler): void {
    this.actionHandlers.set(id, handler);
  }

  registerActions(actions: Record<string, ServerActionHandler>): void {
    for (const [id, handler] of Object.entries(actions)) {
      this.actionHandlers.set(id, handler);
    }
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
      const csrfToken = crypto.randomUUID();
      const { html, csrfUsed } = renderToString(content, { csrfToken });
      const raw = doctype ? `<!DOCTYPE html>\n${html}` : html;
      const body = injectScripts(raw, this.clientScriptDescriptors);
      if (csrfUsed) {
        ctx.setCookie("_rain_csrf", csrfToken, {
          httpOnly: true,
          secure: true,
          sameSite: "Strict",
          path: "/",
        });
      }
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
    executionCtx?: ExecutionContext,
  ): Promise<Response> {
    const resolvedEnv = env ?? ({} as Env);
    return runWithBindings(resolvedEnv, async () => {
      const response = await this.handleRequest(
        request,
        resolvedEnv,
        executionCtx,
      );
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

  private async handleRequest(
    request: Request,
    env: Env,
    executionCtx?: ExecutionContext,
  ): Promise<Response> {
    const csrfResponse = this.validateCsrf(request);
    if (csrfResponse) return csrfResponse;

    const { pathname } = new URL(request.url);
    const method = request.method;

    if (method === "POST" && pathname.startsWith("/_rain/action/")) {
      return this.handleServerAction(pathname, request, env, executionCtx);
    }

    try {
      const result = this.matchRoute(method, pathname);

      if (result.route) {
        return await this.executeRoute(
          result.route,
          result.match,
          request,
          env,
          executionCtx,
          method,
          pathname,
        );
      }

      if (method === "HEAD" && result.getFallback) {
        return await this.executeHeadFallback(
          result.getFallback.route,
          result.getFallback.match,
          request,
          env,
          executionCtx,
          pathname,
        );
      }

      if (result.pathMatched) {
        return this.buildMethodNotAllowed(
          request,
          env,
          executionCtx,
          result.firstMiddlewares ?? [],
        );
      }

      const assetResponse = await this.tryServeStaticAsset(request, env);
      if (assetResponse) return assetResponse;

      return new Response("Not Found", { status: 404 });
    } catch (error) {
      return this.handleError(error, request, pathname);
    }
  }

  private matchRoute(
    method: string,
    pathname: string,
  ): {
    route?: Route;
    match: RegExpMatchArray;
    pathMatched: boolean;
    firstMiddlewares?: Middleware[] | undefined;
    getFallback?: { route: Route; match: RegExpMatchArray };
  } {
    let pathMatched = false;
    let firstMiddlewares: Middleware[] | undefined;
    let getFallback: { route: Route; match: RegExpMatchArray } | undefined;
    const trackGetFallback = method === "HEAD";

    for (const route of this.routes) {
      const match = pathname.match(route.pattern);
      if (!match) continue;

      pathMatched = true;
      firstMiddlewares ??= route.middlewares;

      if (route.method === method) {
        return { route, match, pathMatched, firstMiddlewares };
      }

      if (trackGetFallback && route.method === "GET" && !getFallback) {
        getFallback = { route, match };
      }
    }

    const base = {
      match: [] as unknown as RegExpMatchArray,
      pathMatched,
      firstMiddlewares,
    };
    if (getFallback) {
      return { ...base, getFallback };
    }
    return base;
  }

  private async executeHeadFallback(
    route: Route,
    match: RegExpMatchArray,
    request: Request,
    env: Env,
    executionCtx: ExecutionContext | undefined,
    pathname: string,
  ): Promise<Response> {
    const response = await this.executeRoute(
      route,
      match,
      request,
      env,
      executionCtx,
      "HEAD",
      pathname,
    );
    return new Response(null, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }

  private async executeRoute(
    route: Route,
    match: RegExpMatchArray,
    request: Request,
    env: Env,
    executionCtx: ExecutionContext | undefined,
    method: string,
    pathname: string,
  ): Promise<Response> {
    const params: Record<string, string> = {};
    route.paramNames.forEach((name, i) => {
      const value = match[i + 1];
      if (value !== undefined) {
        params[name] = safeDecodeURIComponent(value);
      }
    });

    const ctx = new Context(request, params, env, executionCtx);
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

    return this.applyCookies(response, ctx);
  }

  private async handleServerAction(
    pathname: string,
    request: Request,
    env: Env,
    executionCtx?: ExecutionContext,
  ): Promise<Response> {
    const actionId = decodeURIComponent(
      pathname.slice("/_rain/action/".length),
    );
    const handler = this.actionHandlers.get(actionId);

    if (!handler) {
      return new Response(
        "[Rain] Server Action '" +
          escapeHtml(actionId) +
          "' not found. " +
          "Ensure the action is registered " +
          "with app.registerAction().",
        {
          status: 404,
          headers: {
            "content-type": "text/plain; charset=UTF-8",
          },
        },
      );
    }

    const ctx = new Context(request, {}, env, executionCtx);

    const actionHandler: Handler = async (actionCtx: Context) => {
      const formData = await actionCtx.req.formData();
      this.validateActionCsrf(actionCtx, formData);
      const result = await handler(actionCtx, formData);
      if (result) return result;
      const referer = actionCtx.header("Referer") ?? "/";
      return actionCtx.redirect(referer, 303);
    };

    const allMiddlewares =
      this.globalMiddlewares.length > 0 ? [...this.globalMiddlewares] : [];
    const composed = this.composeMiddlewares(allMiddlewares, actionHandler);

    try {
      const response = await composed(ctx);
      return this.applyCookies(response, ctx);
    } catch (error) {
      return this.handleError(error, request, pathname);
    }
  }

  private validateActionCsrf(ctx: Context, formData: FormData): void {
    const formToken = formData.get("_rain_csrf");
    const cookieToken = ctx.cookie("_rain_csrf");
    if (!(formToken && cookieToken)) {
      throw new HttpError(
        403,
        "[Rain] Server Action CSRF token missing. " +
          "Both a form token and a cookie are " +
          "required. This may indicate a cross-site " +
          "request forgery attempt. " +
          "Reload the page and try again.",
      );
    }
    if (formToken !== cookieToken) {
      throw new HttpError(
        403,
        "[Rain] Server Action CSRF token mismatch. " +
          "The form token does not match the cookie. " +
          "This may indicate a cross-site request " +
          "forgery attempt, or the cookie may have " +
          "expired. Reload the page and try again.",
      );
    }
  }

  private async buildMethodNotAllowed(
    request: Request,
    env: Env,
    executionCtx: ExecutionContext | undefined,
    routeMiddlewares: Middleware[],
  ): Promise<Response> {
    const allMiddlewares = this.mergeMiddlewares(routeMiddlewares);
    const ctx = new Context(request, {}, env, executionCtx);
    if (allMiddlewares.length === 0) {
      return this.applyCookies(
        new Response("Method Not Allowed", { status: 405 }),
        ctx,
      );
    }
    const methodNotAllowed: Handler = () =>
      new Response("Method Not Allowed", { status: 405 });
    const composed = this.composeMiddlewares(allMiddlewares, methodNotAllowed);
    const response = await composed(ctx);
    return this.applyCookies(response, ctx);
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

  private applyCookies(response: Response, ctx: Context): Response {
    const pending = ctx.getPendingCookies();
    if (pending.length === 0) return response;
    const headers = new Headers(response.headers);
    for (const cookie of pending) {
      headers.append("Set-Cookie", cookie);
    }
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

  private async tryServeStaticAsset(
    request: Request,
    env: Env,
  ): Promise<Response | null> {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return null;
    }
    const assets = (env as Env & { ASSETS?: Fetcher }).ASSETS;
    if (!assets) return null;
    try {
      const response = await assets.fetch(request);
      if (response.status === 404) return null;
      return response;
    } catch (error) {
      console.error(
        "[Rain] Static asset fetch failed.",
        "Check the [assets] configuration in wrangler.toml.",
        error,
      );
      return null;
    }
  }
}
