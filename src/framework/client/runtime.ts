import type { RainComponent } from "../jsx/types";
import type { Fiber } from "./hooks";
import { flushPendingEffects } from "./hooks";
import { hydrateIslands } from "./hydrate";
import { initScheduler } from "./scheduler";

const registry = new Map<string, RainComponent>();

export function registerIsland(id: string, component: RainComponent): void {
  registry.set(id, component);
}

export function getRegistry(): ReadonlyMap<string, RainComponent> {
  return registry;
}

export function startHydration(root: Node = document.body): Fiber[] {
  initScheduler();
  const fibers = hydrateIslands(root, registry);
  flushPendingEffects();
  return fibers;
}
