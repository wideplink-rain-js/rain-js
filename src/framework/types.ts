import type { Context } from "./context";
import type { RainElement } from "./jsx/types";

declare global {
  interface Env {}
}

export interface StateKey<T> {
  readonly id: string;
  readonly _brand: T;
}

export function defineKey<T>(id: string): StateKey<T> {
  return { id } as StateKey<T>;
}

export interface RainConfig {
  routesDir?: string;
  outDir?: string;
  frameworkPackage?: string;
  csrf?: boolean;
  securityHeaders?: Record<string, string> | false;
  clientScripts?: string[];
}

export interface RainOptions {
  csrfProtection?: boolean;
}

export type Handler = (ctx: Context) => Response | Promise<Response>;

export type PageHandler = (ctx: Context) => RainElement | Promise<RainElement>;

export type LayoutHandler = (
  ctx: Context,
  children: RainElement,
) => RainElement | Promise<RainElement>;

export type Middleware = (
  ctx: Context,
  next: () => Promise<Response>,
) => Response | Promise<Response>;

export type ErrorHandler = (
  error: unknown,
  req: Request,
) => Response | Promise<Response>;

export type ServerActionHandler = (
  ctx: Context,
  formData: FormData,
) => Response | undefined | Promise<Response | undefined>;

export interface Schema<T> {
  parse(data: unknown): T;
}
