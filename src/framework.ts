export type Handler = (
  req: Request,
  params: Record<string, string>,
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
}

export class Rain {
  private routes: Route[] = [];
  private errorHandler: ErrorHandler | undefined;

  private addRoute(method: string, path: string, handler: Handler): void {
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
    });
  }

  onError(handler: ErrorHandler): void {
    this.errorHandler = handler;
  }

  get(path: string, handler: Handler): void {
    this.addRoute("GET", path, handler);
  }

  post(path: string, handler: Handler): void {
    this.addRoute("POST", path, handler);
  }

  put(path: string, handler: Handler): void {
    this.addRoute("PUT", path, handler);
  }

  delete(path: string, handler: Handler): void {
    this.addRoute("DELETE", path, handler);
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
        route.paramNames.forEach((name, index) => {
          const value = match[index + 1];
          if (value !== undefined) {
            params[name] = safeDecodeURIComponent(value);
          }
        });

        const response = await route.handler(request, params);

        if (!(response instanceof Response)) {
          const detail =
            `Route handler for ${method} ${pathname}` +
            " did not return a Response object.";
          const fix =
            "Return a Response from your handler: return new Response(...)";
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
