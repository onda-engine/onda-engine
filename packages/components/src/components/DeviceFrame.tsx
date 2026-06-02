//! DeviceFrame — a phone or laptop bezel wrapping arbitrary content. Ported from ondajs.
//!
//! A container component (the documented exception to "self-contained"): pass
//! `children` (scene nodes), an image `src`, or neither. ondajs renders nested
//! CSS `<div>`s — a rounded bezel with padding, an `overflow:hidden` rounded
//! screen, and a notch (phone) or hinge/base (laptop). Here that becomes scene
//! primitives: an outer rounded `<Rect>` (bezel), an inner rounded `<Rect>`
//! (screen background), a `<Group clip={clipRect(...)}>` masking the content to
//! the rounded screen, and a small notch/hinge `<Rect>`.
//!
//! Self-positioning: the device is centered on the composition. The whole
//! subtree is drawn around the device CENTER (offsets of `-w/2, -h/2`) so the
//! scale-in entrance grows from the center — scene scale pivots on the local
//! origin (0,0), not the node's box, so the origin is anchored at the center.
//! (ondajs's `placement` prop is dropped: this always centers on the canvas.)
//!
//! Approximations vs ondajs:
//! - CSS `box-shadow` has no engine primitive; the drop shadow is approximated
//!   by a soft, offset, semi-transparent `<Rect>` behind the bezel.
//! - The screen content is masked with a ROUNDED `clipRect(w, h, screenRadius)`
//!   (cornerRadius = bezel-inset radius), standing in for the DOM's
//!   `overflow:hidden` on a rounded div. The rounded screen-background `<Rect>`
//!   shows through the same radius so the rounded-screen read holds.
//! - When using `src` (no children), the `<Image>` is placed at the screen origin
//!   and clipped to the screen box. The engine sizes images via scaleX/scaleY and
//!   a frame→scene function can't read the image's intrinsic dimensions, so CSS
//!   `object-fit: cover` is not reproduced — pass children for precise framing.

import { Group, Image, Rect, clipRect, useCurrentFrame, useVideoConfig } from '@onda/react'
import type { ReactNode } from 'react'
import { entryScale } from '../choreography.js'
import { DURATION } from '../motion.js'

/** ondajs palette tokens (resolved from CSS vars there; literal hex here). */
const BEZEL = '#1c1c22'
const BEZEL_LIT = '#26262e'
const SCREEN_BG = '#08080a'
const NOTCH = '#000000'
/** Soft approximation of the ondajs `box-shadow` drop. */
const SHADOW = '#000000a6'

export interface DeviceFrameProps {
  /** Which device bezel to draw. */
  device?: 'phone' | 'laptop'
  /** Image src shown inside when no `children` are passed (use the literal
   *  `"DEMO_IMAGE"` token in demos). Sized via the engine, not `object-fit`. */
  src?: string
  /** Frames before the entrance begins. */
  delay?: number
  /** Scale-and-fade the device in on the house spring. */
  animate?: boolean
  /** Device width in px (height is derived from the device aspect). */
  width?: number
  /** Bezel color (hex `#rrggbb` / `#rrggbbaa`). */
  color?: string
  /** Content to wrap (scene nodes). Takes precedence over `src`. */
  children?: ReactNode
}

export function DeviceFrame({
  device = 'phone',
  src,
  delay = 0,
  animate = true,
  width = 420,
  color = BEZEL,
  children,
}: DeviceFrameProps) {
  const frame = useCurrentFrame()
  const { fps, width: compWidth, height: compHeight } = useVideoConfig()

  // House-spring scale-and-fade entrance (matches ondajs `useEntrance` scale).
  const entrance = entryScale({ frame, fps, delay, durationInFrames: DURATION.base, from: 0.96 })
  const opacity = animate ? entrance.opacity : 1
  const scale = animate ? entrance.scaleX : 1

  // The full device bounding box (so we can center it and pivot the scale).
  const box = deviceBox(device, width)

  // Center on the composition; draw the subtree around the device center so the
  // scale grows from the middle (scale pivots on this Group's local origin).
  const centerX = compWidth / 2
  const centerY = compHeight / 2

  return (
    <Group x={centerX} y={centerY} scaleX={scale} scaleY={scale} opacity={opacity}>
      <Group x={-box.width / 2} y={-box.height / 2}>
        {device === 'phone'
          ? renderPhone(width, color, src, children)
          : renderLaptop(width, color, src, children)}
      </Group>
    </Group>
  )
}

/** The device's overall bounding box (for centering + pivot). */
function deviceBox(device: 'phone' | 'laptop', width: number): { width: number; height: number } {
  if (device === 'phone') {
    return { width, height: width * 2.05 }
  }
  // Laptop: screen body + hinge base stacked, base is wider than the screen.
  const screenH = width * 0.62
  return { width: width * 1.16, height: screenH + 14 + 6 }
}

/** Phone bezel: rounded body, inset rounded screen, clipped content, top notch. */
function renderPhone(width: number, color: string, src?: string, children?: ReactNode) {
  const height = width * 2.05
  const radius = width * 0.15
  const bezel = Math.max(12, width * 0.035)
  const screenW = width - bezel * 2
  const screenH = height - bezel * 2
  const screenRadius = Math.max(0, radius - bezel)
  const notchW = width * 0.32
  const notchH = 10
  const notchX = (width - notchW) / 2
  const notchY = bezel + 6

  return (
    <Group>
      {/* Drop-shadow approximation (no engine box-shadow): offset, soft alpha. */}
      <Rect x={6} y={18} width={width} height={height} cornerRadius={radius} fill={SHADOW} />
      {/* Bezel body. */}
      <Rect width={width} height={height} cornerRadius={radius} fill={color} />
      {/* Screen background (rounded), inset by the bezel padding. */}
      <Rect
        x={bezel}
        y={bezel}
        width={screenW}
        height={screenH}
        cornerRadius={screenRadius}
        fill={SCREEN_BG}
      />
      {/* Content, masked to the rounded screen box. */}
      <Group x={bezel} y={bezel} clip={clipRect(screenW, screenH, screenRadius)}>
        {renderContent(src, children)}
      </Group>
      {/* Notch, drawn above the screen. */}
      <Rect
        x={notchX}
        y={notchY}
        width={notchW}
        height={notchH}
        cornerRadius={notchH / 2}
        fill={NOTCH}
      />
    </Group>
  )
}

/** Laptop bezel: rounded screen body centered over a wider hinge + foot. */
function renderLaptop(width: number, color: string, src?: string, children?: ReactNode) {
  const screenH = width * 0.62
  const bezel = Math.max(10, width * 0.02)
  const radius = 16
  const screenW = width - bezel * 2
  const screenInnerH = screenH - bezel * 2
  const screenRadius = Math.max(0, radius - bezel)

  // The body is centered horizontally within the (wider) base box.
  const baseW = width * 1.16
  const bodyX = (baseW - width) / 2

  const hingeW = baseW
  const hingeH = 14
  const hingeY = screenH

  const footW = width * 0.16
  const footH = 6
  const footX = (baseW - footW) / 2
  const footY = screenH + hingeH

  return (
    <Group>
      {/* Drop-shadow approximation under the screen body. */}
      <Rect
        x={bodyX + 6}
        y={18}
        width={width}
        height={screenH}
        cornerRadius={radius}
        fill={SHADOW}
      />
      {/* Screen body bezel. */}
      <Rect x={bodyX} y={0} width={width} height={screenH} cornerRadius={radius} fill={color} />
      {/* Screen background (rounded), inset by the bezel padding. */}
      <Rect
        x={bodyX + bezel}
        y={bezel}
        width={screenW}
        height={screenInnerH}
        cornerRadius={screenRadius}
        fill={SCREEN_BG}
      />
      {/* Content, masked to the rounded screen box. */}
      <Group x={bodyX + bezel} y={bezel} clip={clipRect(screenW, screenInnerH, screenRadius)}>
        {renderContent(src, children)}
      </Group>
      {/* Hinge base (wider, lit), then the small foot below it. */}
      <Rect
        x={0}
        y={hingeY}
        width={hingeW}
        height={hingeH}
        cornerRadius={hingeH / 2}
        fill={BEZEL_LIT}
      />
      <Rect
        x={footX}
        y={footY}
        width={footW}
        height={footH}
        cornerRadius={footH / 2}
        fill={color}
      />
    </Group>
  )
}

/** Screen contents: children take precedence, else an image src, else nothing. */
function renderContent(src: string | undefined, children: ReactNode): ReactNode {
  if (children != null) {
    return children
  }
  if (src) {
    return <Image src={src} />
  }
  return null
}
