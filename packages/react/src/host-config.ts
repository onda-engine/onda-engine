//! react-reconciler host config.
//!
//! ONDA's scene graph is a static snapshot, so this renderer just builds a
//! mutable tree of [`HostNode`]s as React reconciles, which `reconciler.ts` then
//! serializes once. Mutation mode; targets **react-reconciler 0.33 (React 19)**.

import { createContext } from 'react'
import type ReactReconciler from 'react-reconciler'
import { DefaultEventPriority } from 'react-reconciler/constants.js'

/** An intermediate node built while reconciling, later mapped to a scene node. */
export interface HostNode {
  type: string
  props: Record<string, unknown>
  children: HostNode[]
  /** Text content, for `onda-text` (see `shouldSetTextContent`). */
  text?: string
}

/** The render target: holds the top-level element(s). */
export interface RootContainer {
  children: HostNode[]
}

type Props = Record<string, unknown>
// Must be NON-NULL: react-reconciler uses `null` as its internal NO_CONTEXT
// sentinel, so returning `null` here trips "Expected host context to exist".
// ONDA needs no host context, so a single shared empty object suffices.
type HostContext = Record<string, never>
const HOST_CONTEXT: HostContext = {}
type TimeoutHandle = ReturnType<typeof setTimeout>

/** Flatten React text children (string/number, possibly nested arrays) to text. */
function childrenToText(children: unknown): string {
  if (children == null || children === false || children === true) return ''
  if (Array.isArray(children)) return children.map(childrenToText).join('')
  if (typeof children === 'string') return children
  if (typeof children === 'number') return String(children)
  return ''
}

// react-reconciler 0.33 requires a host-transition context (React 19's <form>
// action transitions). ONDA renders static frames — no transitions — so the
// status is always null.
const HostTransitionContext = createContext<null>(null)

// 0.33 replaced `getCurrentEventPriority` with explicit update-priority
// tracking. A static one-shot render has no real event priority — track the
// last set value and default to `DefaultEventPriority`.
let currentUpdatePriority: number = DefaultEventPriority

export const hostConfig: ReactReconciler.HostConfig<
  string, // Type
  Props, // Props
  RootContainer, // Container
  HostNode, // Instance
  HostNode, // TextInstance
  never, // SuspenseInstance
  never, // HydratableInstance
  never, // FormInstance
  HostNode, // PublicInstance
  HostContext, // HostContext
  never, // ChildSet
  TimeoutHandle, // TimeoutHandle
  -1, // NoTimeout
  null // TransitionStatus
> = {
  supportsMutation: true,
  supportsPersistence: false,
  supportsHydration: false,
  isPrimaryRenderer: true,

  noTimeout: -1,
  scheduleTimeout: (fn, delay) => setTimeout(fn, delay),
  cancelTimeout: (handle) => clearTimeout(handle),

  createInstance(type, props) {
    const node: HostNode = { type, props, children: [] }
    if (type === 'onda-text') node.text = childrenToText(props.children)
    return node
  },

  createTextInstance(text) {
    return { type: '#text', props: {}, children: [], text }
  },

  appendInitialChild(parent, child) {
    parent.children.push(child)
  },
  finalizeInitialChildren() {
    return false
  },

  shouldSetTextContent(type) {
    return type === 'onda-text'
  },

  getRootHostContext() {
    return HOST_CONTEXT
  },
  getChildHostContext(parentContext) {
    return parentContext
  },
  getPublicInstance(instance) {
    return instance
  },

  prepareForCommit() {
    return null
  },
  resetAfterCommit() {},
  preparePortalMount() {},

  // 0.33: `prepareUpdate` is gone; `commitUpdate` receives the new props
  // directly (no diff payload) and applies them.
  commitUpdate(instance, type, _prevProps, nextProps) {
    instance.props = nextProps
    if (type === 'onda-text') instance.text = childrenToText(nextProps.children)
  },
  commitTextUpdate(textInstance, _oldText, newText) {
    textInstance.text = newText
  },
  resetTextContent() {},
  commitMount() {},

  appendChild(parent, child) {
    parent.children.push(child)
  },
  appendChildToContainer(container, child) {
    container.children.push(child)
  },
  insertBefore(parent, child, beforeChild) {
    const index = parent.children.indexOf(beforeChild)
    parent.children.splice(index < 0 ? parent.children.length : index, 0, child)
  },
  insertInContainerBefore(container, child, beforeChild) {
    const index = container.children.indexOf(beforeChild)
    container.children.splice(index < 0 ? container.children.length : index, 0, child)
  },
  removeChild(parent, child) {
    const index = parent.children.indexOf(child)
    if (index >= 0) parent.children.splice(index, 1)
  },
  removeChildFromContainer(container, child) {
    const index = container.children.indexOf(child)
    if (index >= 0) container.children.splice(index, 1)
  },
  clearContainer(container) {
    container.children.length = 0
  },

  getInstanceFromNode() {
    return null
  },
  beforeActiveInstanceBlur() {},
  afterActiveInstanceBlur() {},
  prepareScopeUpdate() {},
  getInstanceFromScope() {
    return null
  },
  detachDeletedInstance() {},

  // ── react-reconciler 0.33 (React 19) additions ─────────────────────────────
  // ONDA is a static, single-pass renderer with no suspense, forms, or
  // transitions, so these are inert (return the "nothing pending / never
  // suspend / commit immediately" answers).
  setCurrentUpdatePriority(newPriority) {
    currentUpdatePriority = newPriority
  },
  getCurrentUpdatePriority() {
    return currentUpdatePriority
  },
  resolveUpdatePriority() {
    return DefaultEventPriority
  },
  NotPendingTransition: null,
  // React's public `Context` type omits the internal fields (`_currentValue`,
  // `_threadCount`) the reconciler reads; the runtime object has them.
  // biome-ignore lint/suspicious/noExplicitAny: bridge React's public Context to the reconciler's ReactContext.
  HostTransitionContext: HostTransitionContext as any,
  resetFormInstance() {},
  requestPostPaintCallback() {},
  shouldAttemptEagerTransition() {
    return false
  },
  trackSchedulerEvent() {},
  resolveEventType() {
    return null
  },
  resolveEventTimeStamp() {
    return -1
  },
  maySuspendCommit() {
    return false
  },
  preloadInstance() {
    return true // already "loaded" — never suspends the commit
  },
  startSuspendingCommit() {},
  suspendInstance() {},
  waitForCommitToBeReady() {
    return null // commit is always ready immediately
  },
}
