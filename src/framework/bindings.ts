import { AsyncLocalStorage } from "node:async_hooks";

const bindingsStorage = new AsyncLocalStorage<unknown>();

export function runWithBindings<T>(env: unknown, fn: () => T): T {
  return bindingsStorage.run(env, fn);
}

export function bindings<E = Env>(): E {
  const store = bindingsStorage.getStore();
  if (store === undefined) {
    throw new Error(
      `[Rain] bindings() was called outside of a request \
context. This function can only be used inside route \
handlers, middleware, or functions called during request \
processing. If you need bindings in a handler, use \
ctx.bindings instead.`,
    );
  }
  return store as E;
}
