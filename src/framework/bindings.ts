import { AsyncLocalStorage } from "node:async_hooks";

interface RequestStore {
  env: unknown;
  locals: Map<symbol, unknown>;
}

const requestStorage = new AsyncLocalStorage<RequestStore>();

export function runWithBindings<T>(env: unknown, fn: () => T): T {
  return requestStorage.run(
    { env, locals: new Map() },
    fn,
  );
}

export function bindings<E = Env>(): E {
  const store = requestStorage.getStore();
  if (store === undefined) {
    throw new Error(
      `[Rain] bindings() was called outside of a request \
context. This function can only be used inside route \
handlers, middleware, or functions called during request \
processing. If you need bindings in a handler, use \
ctx.bindings instead.`,
    );
  }
  return store.env as E;
}

export function requestLocal<T>(
  key: symbol,
  init: () => T,
): T {
  const store = requestStorage.getStore();
  if (!store) return init();
  const existing = store.locals.get(key);
  if (existing !== undefined) return existing as T;
  const value = init();
  store.locals.set(key, value);
  return value;
}
