export class Context {
  readonly req: Request;
  readonly params: Record<string, string>;
  readonly state: Map<string, unknown>;
  private cachedUrl: URL | undefined;

  constructor(req: Request, params: Record<string, string>) {
    this.req = req;
    this.params = params;
    this.state = new Map();
  }

  get url(): URL {
    this.cachedUrl ??= new URL(this.req.url);
    return this.cachedUrl;
  }

  get path(): string {
    return this.url.pathname;
  }

  get method(): string {
    return this.req.method;
  }

  get query(): URLSearchParams {
    return this.url.searchParams;
  }

  header(name: string): string | null {
    return this.req.headers.get(name);
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
