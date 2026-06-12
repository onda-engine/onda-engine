//! LowerThird — broadcast-style name + role bar that slides + fades into a corner
//! with a single earned accent rule. Ported from ondajs.
//!
//! Choreography (matching ondajs): the name slides in from the bar's side on the
//! house spring; the role fades in 4 frames later (the canonical stagger); the
//! accent rule draws last (+8 frames), its width growing 0 → full so the eye
//! reads name → role → accent.
//!
//! Layout: ondajs wraps the assembly in a `PlacementBox` (an `AbsoluteFill` that
//! parks an absolutely-positioned box at a canvas anchor) and lays the three
//! parts out in a flex column. Here the assembly is hand-laid as a BARE top-level
//! `<Group x={originX} y={originY}>` (the `BarChart` pattern) — NOT inside an
//! `<AbsoluteFill>`/`<Flex>` — for two reasons: (a) the engine layout pass would
//! OVERWRITE the group's x/y (clobbering the corner anchor), and (b) the name
//! carries a motion TRANSLATE and the accent rule's width animates per-frame,
//! either of which would make a layout container reflow/jiggle. The origin is
//! computed directly from the canvas size and `placement`; a left-half placement
//! slides in from the left and aligns flush-left, a right-half one mirrors.
//!
//! Approximations: ondajs sizes the accent rule as a % of the DOM-measured name
//! width and uses CSS letter-spacing / line-height. The rule width and the line
//! stack are now sized from REAL shaped text metrics (`useTextMetrics`, which the
//! engine measures exactly — falling back to a glyph-count estimate until the
//! wasm engine warms). letter-spacing / line-height props are accepted but not
//! applied.

import {
  Group,
  Rect,
  Text,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from '@onda/react'
import { entryFade, entrySlide } from '../choreography.js'
import { DURATION, SPRING_SMOOTH } from '../motion.js'
import { useTextMetrics } from '../text-metrics.js'
import { useTheme } from '../theme.js'
import { type TimeInput, framesOf } from '../time.js'

/** Broadcast lower-third placement regions — the corners (or centered edge) a
 *  name bar lives in. The `*-center` variants center the block on the canvas
 *  mid-line, for a single credit/URL line under a closing card. */
export type LowerThirdPlacement =
  | 'bottom-left'
  | 'bottom-right'
  | 'bottom-center'
  | 'top-left'
  | 'top-right'
  | 'top-center'

/** Resolved canvas anchor for a placement: fractional x/y of the anchor point
 *  plus which visual side the bar sits on (drives slide direction + alignment).
 *  Margins match ondajs's `REGION_MAP` (10% safe inset on each axis); centered
 *  variants anchor at x = 0.5 and align each line about the block center. */
const PLACEMENT_MAP: Record<
  LowerThirdPlacement,
  { x: number; y: number; side: 'left' | 'right' | 'center'; vertical: 'top' | 'bottom' }
> = {
  'bottom-left': { x: 0.1, y: 0.9, side: 'left', vertical: 'bottom' },
  'bottom-right': { x: 0.9, y: 0.9, side: 'right', vertical: 'bottom' },
  'bottom-center': { x: 0.5, y: 0.9, side: 'center', vertical: 'bottom' },
  'top-left': { x: 0.1, y: 0.1, side: 'left', vertical: 'top' },
  'top-right': { x: 0.9, y: 0.1, side: 'right', vertical: 'top' },
  'top-center': { x: 0.5, y: 0.1, side: 'center', vertical: 'top' },
}

/** Engine line-box height as a multiple of font size (matches the typography
 *  crate, the same ratio `Underline` uses). */
const LINE_RATIO = 1.2

/** Choreography offsets — frames AFTER the name's delay (verbatim ondajs). */
const ROLE_OFFSET = 4
const UNDERLINE_OFFSET = 8

export interface LowerThirdProps {
  /** The person's name (the primary line). */
  name?: string
  /** The person's role / title (the secondary line). */
  role?: string
  /** Which canvas corner the bar sits in (default `'bottom-left'`). Drives the
   *  slide-in direction and flush alignment. */
  placement?: LowerThirdPlacement
  /** Frames before the name slides in. */
  delay?: TimeInput
  /** Show the accent rule beneath the name (default `true`). */
  accent?: boolean
  /** Name color (default: theme `text`). */
  color?: string
  /** Role color (default: theme `textMuted`). */
  roleColor?: string
  /** Accent rule color (default: theme `accent`). */
  accentColor?: string
  /** Name font size in px (default 48). */
  fontSize?: number
  /** Name font weight (default 600). */
  nameFontWeight?: number
  /** Role font size in px (default 22). */
  roleFontSize?: number
  /** Role font weight (default 500). */
  roleFontWeight?: number
  /** Loaded font family for both lines (e.g. a `--font` passed to `onda render`) (default: theme `fontFamily`). */
  fontFamily?: string
  /** Accent rule corner radius in px (capped so a thin sliver never bulges) (default: theme `radius`). */
  cornerRadius?: number
}

export function LowerThird({
  name = 'Rodrigo',
  role = 'CEO, Onda',
  placement = 'bottom-left',
  delay: delayIn = 0,
  accent = true,
  color: colorProp,
  roleColor: roleColorProp,
  accentColor: accentColorProp,
  fontSize = 48,
  nameFontWeight = 600,
  roleFontSize = 22,
  roleFontWeight = 500,
  fontFamily: fontFamilyProp,
  cornerRadius: cornerRadiusProp,
}: LowerThirdProps) {
  const frame = useCurrentFrame()
  const { fps, width, height } = useVideoConfig()
  // TimeInput props -> frames (accepts numbers or '0.5s'/'500ms'/'12f').
  const delay = framesOf(delayIn, fps)
  const theme = useTheme()
  const color = colorProp ?? theme.text
  const roleColor = roleColorProp ?? theme.textMuted
  const accentColor = accentColorProp ?? theme.accent
  const fontFamily = fontFamilyProp ?? theme.fontFamily
  const cornerRadius = cornerRadiusProp ?? theme.radius

  // Real shaped line-box widths (the engine measures them exactly; falls back to
  // a glyph-count estimate until the wasm engine warms). One hook per fixed line.
  const nameMetrics = useTextMetrics(name, fontSize, { fontFamily, fontWeight: nameFontWeight })
  const roleMetrics = useTextMetrics(role, roleFontSize, { fontFamily, fontWeight: roleFontWeight })

  // A lower-third only lives in a corner; a caller (or the agent) may pass a
  // general placement like `center` — fall back to the house corner rather than
  // crashing on an unmapped key.
  const { x: ax, y: ay, side, vertical } = PLACEMENT_MAP[placement] ?? PLACEMENT_MAP['bottom-left']
  const isLeft = side === 'left'
  const isCenter = side === 'center'

  // Name slides in from the bar's side — subtle horizontal travel reinforces
  // which corner the bar belongs to (ondajs: 'left'/'right', distance 16). A
  // centered block has no "side", so it just fades up in place (distance 0).
  const slide = entrySlide({
    frame,
    fps,
    delay,
    durationInFrames: DURATION.base,
    direction: isLeft ? 'left' : 'right',
    distance: isCenter ? 0 : 16,
  })

  // Role fades in 4 frames after the name lands.
  const roleMotion = entryFade({
    frame,
    fps,
    delay: delay + ROLE_OFFSET,
    durationInFrames: DURATION.base,
  })

  // Accent rule draws last (+8 frames), its width growing 0 → full on the house
  // spring (fast — emphatic), matching ondajs's `Underline` second phase
  // (`lineDuration={10}` == DURATION.fast, `lineDelay={0}`).
  const accentProgress = spring({
    frame: Math.max(0, frame - delay - UNDERLINE_OFFSET),
    fps,
    config: SPRING_SMOOTH,
    durationInFrames: DURATION.fast,
  })

  // Measured line-box widths (see header). The block width is the wider of the
  // two lines so the assembly anchors as one box.
  const nameWidth = nameMetrics.width
  const roleWidth = roleMetrics.width
  const blockWidth = Math.max(nameWidth, roleWidth)

  // Vertical stack: name line box, a 4px gap (ondajs), the role line box, an
  // 8px gap before the accent rule, then a 3px rule (ondajs `lineThickness`).
  const nameLineH = fontSize * LINE_RATIO
  const roleLineH = roleFontSize * LINE_RATIO
  const GAP = 4
  const ACCENT_GAP = 8
  const ACCENT_THICKNESS = 3
  const roleY = nameLineH + GAP
  const accentY = roleY + roleLineH + ACCENT_GAP

  // Accent rule grows 0 → the name's width (the name owns the typography above).
  const accentWidth = interpolate(accentProgress, [0, 1], [0, nameWidth], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  // A full-pill radius on a thin sliver would bulge; cap at half its own size.
  const accentRadius = Math.min(cornerRadius, ACCENT_THICKNESS / 2, accentWidth / 2)

  // Total assembled height — used to anchor a bottom-placed bar by its baseline.
  const blockHeight = accent ? accentY + ACCENT_THICKNESS : roleY + roleLineH

  // Anchor the assembly box at the canvas corner. The box's local origin (0,0)
  // is its top-left; shift so a right-side placement is flush-right (origin
  // moved left by the block width) and a bottom placement sits its baseline at
  // the anchor (origin moved up by the block height). Computed directly from the
  // canvas size — no layout container, so the anchor and the per-frame width
  // growth never trigger a reflow (the BarChart pattern).
  const anchorX = ax * width
  const anchorY = ay * height
  const originX = isCenter ? anchorX - blockWidth / 2 : isLeft ? anchorX : anchorX - blockWidth
  const originY = vertical === 'bottom' ? anchorY - blockHeight : anchorY

  // Per-line alignment within the block: left lines start at 0; right lines are
  // pushed flush-right; centered lines are centered about the block's mid-line.
  const lineX = (w: number) => (isCenter ? (blockWidth - w) / 2 : isLeft ? 0 : blockWidth - w)
  const nameX = lineX(nameWidth)
  const roleX = lineX(roleWidth)
  const accentX = lineX(accentWidth)

  return (
    <Group x={originX} y={originY}>
      {/* Name — slides + fades in from the bar's side. The inner Group carries
          the motion translate; the outer x positions the line within the
          block (flush-left or flush-right). */}
      <Group x={nameX}>
        <Group x={slide.x} y={slide.y} opacity={slide.opacity}>
          <Text
            fontSize={fontSize}
            color={color}
            fontFamily={fontFamily}
            fontWeight={nameFontWeight}
          >
            {name}
          </Text>
        </Group>
      </Group>

      {/* Role — fades in 4 frames after the name. */}
      <Text
        x={roleX}
        y={roleY}
        opacity={roleMotion.opacity}
        fontSize={roleFontSize}
        color={roleColor}
        fontFamily={fontFamily}
        fontWeight={roleFontWeight}
      >
        {role}
      </Text>

      {/* Accent rule — draws last, width 0 → full, only when `accent`. */}
      {accent && accentWidth > 0 ? (
        <Rect
          x={accentX}
          y={accentY}
          width={accentWidth}
          height={ACCENT_THICKNESS}
          cornerRadius={accentRadius}
          fill={accentColor}
        />
      ) : null}
    </Group>
  )
}
