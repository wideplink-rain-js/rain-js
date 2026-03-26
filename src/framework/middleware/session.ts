import type { Context } from "../context";
import type { Middleware, StateKey } from "../types";
import { defineKey } from "../types";

export interface SessionData {
  [key: string]: unknown;
}

export interface SessionOptions {
  kvBinding: string;
  cookieName?: string;
  maxAge?: number;
  prefix?: string;
}

export interface Session {
  get<T = unknown>(key: string): T | undefined;
  set(key: string, value: unknown): void;
  delete(key: string): void;
  has(key: string): boolean;
  clear(): void;
  flash(key: string, value?: unknown): unknown | undefined;
  readonly id: string;
  readonly isNew: boolean;
}

const SESSION_KEY: StateKey<Session> = defineKey<Session>("rain:session");

export function getSession(ctx: Context): Session {
  const current = ctx.get(SESSION_KEY);
  if (!current) {
    throw new Error(
      "[Rain] Session not found. Ensure the session " +
        "middleware is applied to this route. " +
        "Usage: app.use(session({ kvBinding: 'SESSIONS' }))",
    );
  }
  return current;
}

const DEFAULT_COOKIE_NAME = "__rain_session";
const DEFAULT_MAX_AGE = 86400;
const DEFAULT_PREFIX = "session:";
const SESSION_ID_LENGTH = 32;

function generateSessionId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(SESSION_ID_LENGTH));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function resolveKv(ctx: Context, binding: string): KVNamespace {
  const kv = (ctx.bindings as unknown as Record<string, unknown>)[binding] as
    | KVNamespace
    | undefined;
  if (!kv) {
    throw new Error(
      `[Rain] KV binding "${binding}" not found. ` +
        "Add it to your wrangler.toml: " +
        `[[kv_namespaces]]\nbinding = "${binding}"`,
    );
  }
  return kv;
}

class KvSession implements Session {
  readonly id: string;
  readonly isNew: boolean;
  private data: SessionData;
  private dirty: boolean;

  constructor(id: string, data: SessionData, isNew: boolean) {
    this.id = id;
    this.data = data;
    this.isNew = isNew;
    this.dirty = isNew;
  }

  get<T = unknown>(key: string): T | undefined {
    return this.data[key] as T | undefined;
  }

  set(key: string, value: unknown): void {
    this.data[key] = value;
    this.dirty = true;
  }

  delete(key: string): void {
    if (key in this.data) {
      delete this.data[key];
      this.dirty = true;
    }
  }

  has(key: string): boolean {
    return key in this.data;
  }

  clear(): void {
    this.data = {};
    this.dirty = true;
  }

  flash(key: string, value?: unknown): unknown | undefined {
    const flashKey = `__flash:${key}`;
    if (value !== undefined) {
      this.set(flashKey, value);
      return undefined;
    }
    const stored = this.get(flashKey);
    if (stored !== undefined) {
      this.delete(flashKey);
    }
    return stored;
  }

  isDirty(): boolean {
    return this.dirty;
  }

  toJSON(): SessionData {
    return { ...this.data };
  }
}

export function session(options: SessionOptions): Middleware {
  const cookieName = options.cookieName ?? DEFAULT_COOKIE_NAME;
  const maxAge = options.maxAge ?? DEFAULT_MAX_AGE;
  const prefix = options.prefix ?? DEFAULT_PREFIX;

  return async (ctx: Context, next) => {
    const kv = resolveKv(ctx, options.kvBinding);
    const existingId = ctx.cookie(cookieName);
    let sessionData: SessionData = {};
    let isNew = true;
    let sessionId: string;

    if (existingId && /^[0-9a-f]{64}$/.test(existingId)) {
      const stored = await kv.get(`${prefix}${existingId}`, "json");
      if (stored) {
        sessionData = stored as SessionData;
        isNew = false;
        sessionId = existingId;
      } else {
        sessionId = generateSessionId();
      }
    } else {
      sessionId = generateSessionId();
    }

    const kvSession = new KvSession(sessionId, sessionData, isNew);
    ctx.set(SESSION_KEY, kvSession);

    const response = await next();

    if (kvSession.isDirty()) {
      const kvKey = `${prefix}${sessionId}`;
      await kv.put(kvKey, JSON.stringify(kvSession.toJSON()), {
        expirationTtl: maxAge,
      });
    }

    if (isNew) {
      ctx.setCookie(cookieName, sessionId, {
        maxAge,
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
        path: "/",
      });
    }

    return response;
  };
}
