import type { Fiber } from "./hooks";
import {
  flushPendingEffects,
  setCurrentFiber,
  setScheduleUpdate,
} from "./hooks";
import { reconcile } from "./reconciler";

const pendingFibers = new Set<Fiber>();
let flushScheduled = false;

function rerender(fiber: Fiber): void {
  setCurrentFiber(fiber);

  const { vnode } = fiber;

  if (typeof vnode.tag !== "function") return;

  const newVnode = vnode.tag({
    ...vnode.props,
    children: vnode.children,
  });

  setCurrentFiber(null);

  if (newVnode === null || typeof newVnode === "string") return;

  reconcile(fiber.dom.parentNode as Node, fiber, newVnode);
}

function flush(): void {
  const fibers = [...pendingFibers];
  pendingFibers.clear();
  flushScheduled = false;

  for (const fiber of fibers) {
    rerender(fiber);
  }

  flushPendingEffects();
}

function scheduleUpdate(fiber: Fiber): void {
  pendingFibers.add(fiber);
  if (!flushScheduled) {
    flushScheduled = true;
    queueMicrotask(flush);
  }
}

export function initScheduler(): void {
  setScheduleUpdate(scheduleUpdate);
}

export function flushSync(): void {
  flush();
}

export function hasPendingUpdates(): boolean {
  return pendingFibers.size > 0;
}
