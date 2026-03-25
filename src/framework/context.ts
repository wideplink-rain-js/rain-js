import { HttpError } from "./errors";
import { isRainElement, renderToString } from "./jsx";
import type { RainElement } from "./jsx/types";
import type { StateKey } from "./types";

const DEFAULT_MAX_BODY_SIZE = 1_048_576;

export class Context {
  readonly req: Request;
  readonly params: Record<string, string>;
  readonly state: Map<string, unknown>;
  readonly bindings: Env;
  private cachedUrl: URL | undefined;
  private executionCtx: ExecutionContext | undefined;

  constructor(
    req: Request,
    params: Record<string, string>,
    env: Env = {} as Env,
    executionCtx?: ExecutionContext,
  ) {
    this.req = req;
    this.params = params;
    this.state = new Map();
    this.bindings = env;
    this.executionCtx = executionCtx;
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

  waitUntil(promise: Promise<unknown>): void {
    if (!this.executionCtx) {
      throw new Error(
        "[Rain] ctx.waitUntil() called without an ExecutionContext. " +
          "This typically happens in tests. " +
          "Pass an ExecutionContext when creating " +
          "the Context, or mock it in your test setup.",
      );
    }
    this.executionCtx.waitUntil(promise);
  }

  get<T>(key: StateKey<T>): T | undefined {
    return this.state.get(key.id) as T | undefined;
  }

  set<T>(key: StateKey<T>, value: T): void {
    this.state.set(key.id, value);
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

  html(body: RainElement | string, status = 200): Response {
    const htmlString = isRainElement(body)
      ? renderToString(body)
      : String(body);
    return new Response(htmlString, {
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

  async parseJson<T = unknown>(options?: { maxSize?: number }): Promise<T> {
    const ct = this.header("content-type");
    if (!ct?.includes("application/json")) {
      throw new HttpError(
        415,
        "[Rain] ctx.parseJson() expected " +
          "Content-Type 'application/json' " +
          `but received '${ct ?? "(none)"}'.` +
          " Ensure the client sends the " +
          "correct Content-Type header.",
      );
    }
    const maxSize = options?.maxSize ?? DEFAULT_MAX_BODY_SIZE;
    this.assertBodySize(maxSize, "parseJson");
    const raw = await this.req.text();
    if (raw.length > maxSize) {
      throw this.bodyTooLargeError(maxSize, "parseJson");
    }
    try {
      return JSON.parse(raw) as T;
    } catch (cause) {
      throw new HttpError(
        400,
        "[Rain] ctx.parseJson() failed to " +
          "parse request body as JSON. " +
          "Ensure the request body is " +
          "valid JSON.",
        { cause },
      );
    }
  }

  async parseFormData(options?: { maxSize?: number }): Promise<FormData> {
    const ct = this.header("content-type");
    const isUrlEncoded =
      ct?.includes("application/x-www-form-urlencoded") ?? false;
    const isMultipart = ct?.includes("multipart/form-data") ?? false;
    if (!(isUrlEncoded || isMultipart)) {
      throw new HttpError(
        415,
        "[Rain] ctx.parseFormData() expected " +
          "Content-Type " +
          "'multipart/form-data' or " +
          "'application/" +
          "x-www-form-urlencoded' but " +
          `received '${ct ?? "(none)"}'.` +
          " Ensure the client sends the " +
          "correct Content-Type header.",
      );
    }
    const maxSize = options?.maxSize ?? DEFAULT_MAX_BODY_SIZE;
    this.assertBodySize(maxSize, "parseFormData");
    try {
      return await this.req.formData();
    } catch (cause) {
      throw new HttpError(
        400,
        "[Rain] ctx.parseFormData() failed " +
          "to parse request body. Ensure " +
          "the body matches the " +
          "Content-Type header.",
        { cause },
      );
    }
  }

  async parseText(options?: { maxSize?: number }): Promise<string> {
    const maxSize = options?.maxSize ?? DEFAULT_MAX_BODY_SIZE;
    this.assertBodySize(maxSize, "parseText");
    const raw = await this.req.text();
    if (raw.length > maxSize) {
      throw this.bodyTooLargeError(maxSize, "parseText");
    }
    return raw;
  }

  async parseArrayBuffer(options?: { maxSize?: number }): Promise<ArrayBuffer> {
    const maxSize = options?.maxSize ?? DEFAULT_MAX_BODY_SIZE;
    this.assertBodySize(maxSize, "parseArrayBuffer");
    const buf = await this.req.arrayBuffer();
    if (buf.byteLength > maxSize) {
      throw this.bodyTooLargeError(maxSize, "parseArrayBuffer");
    }
    return buf;
  }

  private assertBodySize(maxSize: number, method: string): void {
    const cl = this.header("content-length");
    if (cl === null) return;
    const size = Number.parseInt(cl, 10);
    if (!Number.isNaN(size) && size > maxSize) {
      throw this.bodyTooLargeError(maxSize, method);
    }
  }

  private bodyTooLargeError(maxSize: number, method: string): HttpError {
    return new HttpError(
      413,
      `[Rain] ctx.${method}() request body ` +
        "exceeds the maximum size of " +
        `${maxSize} bytes. Increase the ` +
        `limit: ctx.${method}` +
        `({ maxSize: ${maxSize * 2} })`,
    );
  }
}
