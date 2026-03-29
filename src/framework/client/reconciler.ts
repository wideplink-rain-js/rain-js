import { Fragment } from "../jsx/createElement";
import type { RainElement, RainNode } from "../jsx/types";
import { RAIN_ELEMENT } from "../jsx/types";
import { applyProps, createDomNode } from "./dom";
import type { Fiber } from "./hooks";
import { setCurrentFiber } from "./hooks";

function isRainElement(value: unknown): value is RainElement {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as RainElement).$$typeof === RAIN_ELEMENT
  );
}

function flattenChildren(children: RainNode[]): RainNode[] {
  const flat: RainNode[] = [];
  for (const child of children) {
    if (Array.isArray(child)) {
      flat.push(...flattenChildren(child));
    } else {
      flat.push(child);
    }
  }
  return flat;
}

function getKey(node: RainNode): string | number | undefined {
  if (isRainElement(node)) {
    return node.props["key"] as string | number | undefined;
  }
  return undefined;
}

function hasAnyKey(nodes: RainNode[]): boolean {
  for (const node of nodes) {
    if (getKey(node) !== undefined) return true;
  }
  return false;
}

function isSameType(oldNode: RainNode, newNode: RainNode): boolean {
  if (isRainElement(oldNode) && isRainElement(newNode)) {
    return oldNode.tag === newNode.tag;
  }
  if (!(isRainElement(oldNode) || isRainElement(newNode))) {
    return true;
  }
  return false;
}

function isNullish(node: RainNode): boolean {
  return node === null || node === undefined || typeof node === "boolean";
}

function nodeToText(node: RainNode): string {
  if (typeof node === "number") return String(node);
  if (typeof node === "string") return node;
  return "";
}

function removeOldProps(
  el: HTMLElement,
  oldProps: Record<string, unknown>,
  newProps: Record<string, unknown>,
): void {
  for (const key of Object.keys(oldProps)) {
    if (key === "children" || key === "key" || key === "ref") continue;
    if (key in newProps) continue;

    if (key.startsWith("on") && typeof oldProps[key] === "function") {
      const eventName = key.slice(2).toLowerCase();
      el.removeEventListener(eventName, oldProps[key] as EventListener);
      continue;
    }

    if (key === "className") {
      el.removeAttribute("class");
    } else {
      el.removeAttribute(key);
    }
  }
}

function updateEventListeners(
  el: HTMLElement,
  oldProps: Record<string, unknown>,
  newProps: Record<string, unknown>,
): void {
  for (const key of Object.keys(newProps)) {
    if (!key.startsWith("on") || typeof newProps[key] !== "function") continue;

    const eventName = key.slice(2).toLowerCase();
    const oldHandler = oldProps[key];
    const newHandler = newProps[key];

    if (oldHandler === newHandler) continue;

    if (typeof oldHandler === "function") {
      el.removeEventListener(eventName, oldHandler as EventListener);
    }
    el.addEventListener(eventName, newHandler as EventListener);
  }
}

function patchProps(
  el: HTMLElement,
  oldProps: Record<string, unknown>,
  newProps: Record<string, unknown>,
): void {
  removeOldProps(el, oldProps, newProps);
  updateEventListeners(el, oldProps, newProps);
  applyProps(el, newProps);
}

function renderFunctionComponent(
  vnode: RainElement,
  fiber: Fiber | null,
): RainElement | null {
  if (typeof vnode.tag !== "function") return vnode;
  if (vnode.tag === Fragment) return vnode;

  if (fiber) {
    setCurrentFiber(fiber);
  }

  const result = vnode.tag({
    ...vnode.props,
    children: vnode.children,
  });

  if (fiber) {
    setCurrentFiber(null);
  }

  if (result === null) return null;
  if (typeof result === "string") return null;
  return result;
}

function buildKeyedMap(
  oldFlat: RainNode[],
  parentEl: Node,
): Map<string | number, { node: RainNode; domNode: Node; index: number }> {
  const oldKeyed = new Map<
    string | number,
    { node: RainNode; domNode: Node; index: number }
  >();
  for (let i = 0; i < oldFlat.length; i++) {
    const key = getKey(oldFlat[i] as RainNode);
    const domNode = parentEl.childNodes[i] as Node;
    if (key !== undefined && domNode) {
      oldKeyed.set(key, {
        node: oldFlat[i] as RainNode,
        domNode,
        index: i,
      });
    }
  }
  return oldKeyed;
}

function patchKeyedChild(
  parentEl: Node,
  oldKeyed: Map<
    string | number,
    { node: RainNode; domNode: Node; index: number }
  >,
  newChild: RainNode,
  existingDom: Node,
): void {
  const newKey = getKey(newChild);
  const cached = newKey === undefined ? undefined : oldKeyed.get(newKey);
  if (cached) {
    parentEl.insertBefore(cached.domNode, existingDom);
    patchNode(cached.domNode, cached.node, newChild);
  } else {
    const newDom = createNodeFromChild(newChild);
    if (newDom) parentEl.insertBefore(newDom, existingDom);
  }
}

function patchChildAtIndex(
  parentEl: Node,
  oldChild: RainNode | undefined,
  newChild: RainNode | undefined,
  existingDom: Node | undefined,
  oldKeyed: Map<
    string | number,
    { node: RainNode; domNode: Node; index: number }
  > | null,
): void {
  if (oldChild === undefined && newChild !== undefined) {
    const newDom = createNodeFromChild(newChild);
    if (newDom) parentEl.appendChild(newDom);
    return;
  }

  if (newChild === undefined && existingDom) {
    parentEl.removeChild(existingDom);
    return;
  }

  if (!(oldChild && newChild && existingDom)) return;

  const newKey = getKey(newChild);
  const oldKey = getKey(oldChild);
  if (
    oldKeyed &&
    newKey !== undefined &&
    oldKey !== undefined &&
    newKey !== oldKey
  ) {
    patchKeyedChild(parentEl, oldKeyed, newChild, existingDom);
    return;
  }

  if (!isSameType(oldChild, newChild)) {
    const newDom = createNodeFromChild(newChild);
    if (newDom) parentEl.replaceChild(newDom, existingDom);
    return;
  }

  patchNode(existingDom, oldChild, newChild);
}

function trimExcessChildren(parentEl: Node, targetLen: number): void {
  while (parentEl.childNodes.length > targetLen) {
    const last = parentEl.lastChild;
    if (last) parentEl.removeChild(last);
    else break;
  }
}

function patchChildren(
  parentEl: Node,
  oldChildren: RainNode[],
  newChildren: RainNode[],
): void {
  const oldFlat = flattenChildren(oldChildren).filter((c) => !isNullish(c));
  const newFlat = flattenChildren(newChildren).filter((c) => !isNullish(c));

  const oldKeyed = hasAnyKey(oldFlat) ? buildKeyedMap(oldFlat, parentEl) : null;
  const maxLen = Math.max(oldFlat.length, newFlat.length);

  for (let i = 0; i < maxLen; i++) {
    patchChildAtIndex(
      parentEl,
      oldFlat[i] as RainNode | undefined,
      newFlat[i] as RainNode | undefined,
      parentEl.childNodes[i] as Node | undefined,
      oldKeyed,
    );
  }

  trimExcessChildren(parentEl, newFlat.length);
}

function createNodeFromChild(child: RainNode): Node | null {
  if (isNullish(child)) return null;
  if (isRainElement(child)) return createDomNode(child);
  return document.createTextNode(nodeToText(child));
}

function patchNode(dom: Node, oldNode: RainNode, newNode: RainNode): void {
  if (!(isRainElement(oldNode) || isRainElement(newNode))) {
    const oldText = nodeToText(oldNode);
    const newText = nodeToText(newNode);
    if (oldText !== newText && dom.nodeType === Node.TEXT_NODE) {
      dom.textContent = newText;
    }
    return;
  }

  if (!(isRainElement(oldNode) && isRainElement(newNode))) return;

  if (oldNode.tag === Fragment && newNode.tag === Fragment) {
    patchChildren(dom, oldNode.children, newNode.children);
    return;
  }

  if (typeof oldNode.tag === "string" && dom instanceof HTMLElement) {
    patchProps(dom, oldNode.props, newNode.props);
    patchChildren(dom, oldNode.children, newNode.children);
  }
}

export function reconcile(
  container: Node,
  fiber: Fiber,
  newVnode: RainElement,
): void {
  const oldDom = fiber.dom;

  const resolved = renderFunctionComponent(newVnode, null);
  if (!resolved) return;

  const oldResolved =
    fiber.rendered ?? renderFunctionComponent(fiber.vnode, null);

  if (oldResolved && oldDom.parentNode) {
    if (typeof resolved.tag === "string" && oldDom instanceof HTMLElement) {
      patchProps(oldDom, oldResolved.props, resolved.props);
      patchChildren(oldDom, oldResolved.children, resolved.children);
    } else {
      const newDom = createDomNode(resolved);
      container.replaceChild(newDom, oldDom);
      fiber.dom = newDom;
    }
  }

  fiber.rendered = resolved;
  fiber.vnode = newVnode;
}
