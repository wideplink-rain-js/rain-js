export type Handler = (
  req: Request,
  params: Record<string, string>,
) => Response | Promise<Response>;

interface Route {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: Handler;
}

export class Rain {
  private routes: Route[] = [];

  private addRoute(method: string, path: string, handler: Handler): void {
    const paramNames: string[] = [];
    const regexPath = path.replace(/:([^/]+)/g, (_, name) => {
      paramNames.push(name);
      return "([^/]+)";
    });

    this.routes.push({
      method,
      pattern: new RegExp(`^${regexPath}$`),
      paramNames,
      handler,
    });
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

    for (const route of this.routes) {
      if (route.method !== method) continue;

      const match = pathname.match(route.pattern);
      if (match) {
        const params: Record<string, string> = {};
        route.paramNames.forEach((name, index) => {
          const value = match[index + 1];
          if (value !== undefined) {
            params[name] = value;
          }
        });

        return await route.handler(request, params);
      }
    }

    return new Response("Not Found", { status: 404 });
  }
}
