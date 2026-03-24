import type { Context } from "./context";

declare global {
  interface Env {}
}

export interface RainConfig {
  routesDir?: string;
  outDir?: string;
  csrf?: boolean;
  securityHeaders?: Record<string, string> | false;
}

export interface RainOptions {
  csrfProtection?: boolean;
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
