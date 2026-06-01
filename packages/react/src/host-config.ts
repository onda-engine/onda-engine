//! react-reconciler host config.
//!
//! ONDA's scene graph is a static snapshot, so this renderer just builds a
//! mutable tree of [`HostNode`]s as React reconciles, which `reconciler.ts` then
//! serializes once. Mutation mode; targets react-reconciler 0.29 (React 18).

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
type HostContext = null
type TimeoutHandle = ReturnType<typeof setTimeout>

/** Flatten React text children (string/number, possibly nested arrays) to text. */
function childrenToText(children: unknown): string {
  if (children == null || children === false || children === true) return ''
  if (Array.isArray(children)) return children.map(childrenToText).join('')
  if (typeof children === 'string') return children
  if (typeof children === 'number') return String(children)
  return ''
}

export const hostConfig: ReactReconciler.HostConfig<
  string, // Type
  Props, // Props
  RootContainer, // Container
  HostNode, // Instance
  HostNode, // TextInstance
  never, // SuspenseInstance
  never, // HydratableInstance
  HostNode, // PublicInstance
  HostContext, // HostContext
  boolean, // UpdatePayload
  never, // ChildSet
  TimeoutHandle, // TimeoutHandle
  -1 // NoTimeout
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
    return null
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

  prepareUpdate() {
    return true
  },
  commitUpdate(instance, _payload, type, _prevProps, nextProps) {
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

  getCurrentEventPriority() {
    return DefaultEventPriority
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
}
