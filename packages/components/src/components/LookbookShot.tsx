//! LookbookShot — a single product presented like a page in a printed lookbook,
//! NOT a full-bleed photo with a corner caption (which reads as a slide). The
//! piece sits in a soft-shadowed mat (a framed print) inside the brand's space,
//! with the name set in the DISPLAY face and real negative space beside it. Three
//! layouts — `spread-right` / `spread-left` (asymmetric editorial: type one side,
//! framed product the other) and `centered` (a gallery print with the label
//! below). Alternating spread sides across successive shots gives a film the
//! rhythm of turning lookbook pages.
//!
//! Motion: the card fades + settles in, then breathes on a slow linear scale
//! (life without a Ken-Burns overscan — the photo is `fit="cover"` to its exact
//! box, so the card scales as ONE unit and never needs a clip, sidestepping the
//! clip-occludes-later-siblings issue). The label lines stagger in after.
//!
//! Type: the name follows the theme DISPLAY face (`headingFamily ?? fontFamily`);
//! the eyebrow + detail are the body face — the same two-font system as the rest
//! of the library.

import {
  Group,
  Image,
  Rect,
  Text,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from '@onda-engine/react'
import { useStaggeredEntrance } from '../hooks.js'
import { DURATION, SPRING_SMOOTH } from '../motion.js'
import { useTextMetrics } from '../text-metrics.js'
import { type TextStyleProps, applyTextCase } from '../text-style.js'
import { useTheme } from '../theme.js'

const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const

export type LookbookLayout = 'spread-right' | 'spread-left' | 'centered'

export interface LookbookShotProps extends TextStyleProps {
  /** Product photo source (resolved at render time by `onda render`). */
  src?: string
  /** Product name — the headline, set in the display face. */
  name?: string
  /** Small letterspaced eyebrow above the name (category), in the body face. */
  eyebrow?: string
  /** Quiet supporting line under the name (material / method), in the body face. */
  detail?: string
  /** Page composition (default `spread-right`). Alternate sides across shots. */
  layout?: LookbookLayout
  /** Frames before the card enters. */
  delay?: number
  /** Name font size in px (default 86 for spreads, auto-reduced for `centered`). */
  nameFontSize?: number
  /** The mat/frame color (the print border). Default a near-white off the bg. */
  matColor?: string
  /** Soft shadow color under the mat. Default a low-alpha warm dark. */
  shadowColor?: string
  /** Eyebrow + rule color (default: theme `accent`). */
  accentColor?: string
  /** Detail line color (default: theme `textMuted`). */
  detailColor?: string
  /** Body font for eyebrow + detail (default: theme `fontFamily`). */
  bodyFamily?: string
  /** Frames over which the card's slow "breath" scale completes (default 150). */
  lifeDurationInFrames?: number
}

/** Greedy word-wrap into lines that each fit `maxWidth` at the font size (the
 *  engine measures at render, but a pure frame→scene function can't read that
 *  back, so this estimate stands in — the display face is narrow, factor ~0.46). */
function wrap(text: string, maxWidth: number, fontSize: number): string[] {
  const words = text.split(/\s+/).filter((w) => w.length > 0)
  if (words.length === 0) return []
  const maxChars = Math.max(1, Math.floor(maxWidth / (fontSize * 0.46)))
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    const cand = cur.length === 0 ? w : `${cur} ${w}`
    if (cand.length <= maxChars || cur.length === 0) cur = cand
    else {
      lines.push(cur)
      cur = w
    }
  }
  if (cur.length > 0) lines.push(cur)
  return lines
}

export function LookbookShot({
  src = '',
  name = 'Product',
  eyebrow = '',
  detail = '',
  layout = 'spread-right',
  delay = 0,
  nameFontSize,
  matColor,
  shadowColor = '#2b201824',
  color: colorProp,
  accentColor: accentColorProp,
  detailColor: detailColorProp,
  fontFamily: fontFamilyProp,
  bodyFamily: bodyFamilyProp,
  letterSpacing,
  uppercase,
  lifeDurationInFrames = 150,
}: LookbookShotProps) {
  const frame = useCurrentFrame()
  const { width: W, height: H, fps } = useVideoConfig()
  const theme = useTheme()

  const color = colorProp ?? theme.text
  const accent = accentColorProp ?? theme.accent
  const detailColor = detailColorProp ?? theme.textMuted
  const nameFont = fontFamilyProp ?? theme.headingFamily ?? theme.fontFamily
  const bodyFont = bodyFamilyProp ?? theme.fontFamily
  const mat = matColor ?? '#fbf9f4'

  const centered = layout === 'centered'
  const margin = Math.round(W * 0.075)
  const pad = 18

  // ── Mat (framed print) geometry ──────────────────────────────────────────
  // Portrait canvases (9:16 / 4:5): size the centered print off HEIGHT and seat it
  // a touch above center — a width-based mat is tiny and stuck at the top in
  // portrait, leaving the lower frame empty. Landscape math is unchanged
  // (matW = matH * 0.806 ≡ the old W*0.32 with matH = W*0.32*1.24).
  const portrait = centered && H > W
  const matH = centered ? Math.round(portrait ? H * 0.44 : W * 0.32 * 1.24) : Math.round(H * 0.9)
  const matW = centered ? Math.round(matH * 0.806) : Math.round(matH * 0.76)
  const matX = centered
    ? Math.round((W - matW) / 2)
    : layout === 'spread-right'
      ? W - matW - margin
      : margin
  const matY = centered ? Math.round(portrait ? H * 0.17 : H * 0.075) : Math.round((H - matH) / 2)

  // ── Card motion: entrance settle + a slow "breath" scale (one unit, no clip).
  const enter = spring({
    frame: Math.max(0, frame - delay),
    fps,
    config: SPRING_SMOOTH,
    durationInFrames: DURATION.base,
  })
  const enterOpacity = interpolate(enter, [0, 1], [0, 1], CLAMP)
  const enterY = interpolate(enter, [0, 1], [20, 0], CLAMP)
  const life = interpolate(frame - delay, [0, lifeDurationInFrames], [1, 1.03], CLAMP)
  const cardScale = interpolate(enter, [0, 1], [0.985, 1], CLAMP) * life
  const cx = matX + matW / 2
  const cy = matY + matH / 2

  // ── Label block ──────────────────────────────────────────────────────────
  const baseName = nameFontSize ?? (centered ? 58 : 86)
  const eyebrowSize = centered ? 20 : 22
  const detailSize = centered ? 22 : 24

  const at = useStaggeredEntrance({ type: 'rise', delay: delay + 8, increment: 5 })

  // The headline name with the shared text-case applied (so measurement,
  // wrapping, and rendering all agree on the same string).
  const displayName = applyTextCase(name, { uppercase })

  // Centering needs measured widths (the LowerThird pattern).
  const nameMetrics = useTextMetrics(displayName, baseName, {
    fontFamily: nameFont,
    fontWeight: 500,
    letterSpacing,
  })
  // Measure WITH the same letter-spacing the eyebrow renders with (4px) — else the
  // shaped width is ~4·(n-1)px too small and the centered eyebrow drifts right.
  const eyebrowMetrics = useTextMetrics(eyebrow, eyebrowSize, {
    fontFamily: bodyFont,
    fontWeight: 600,
    letterSpacing: 4,
  })

  if (centered) {
    const labelTop = matY + matH + Math.round(H * 0.05)
    const nameX = Math.round((W - nameMetrics.width) / 2)
    const eyebrowX = Math.round((W - eyebrowMetrics.width) / 2)
    const nm = at(0)
    const eb = at(1)
    return (
      <Group>
        <Group x={cx} y={cy}>
          <Group scaleX={cardScale} scaleY={cardScale}>
            <Group x={-cx} y={-cy} opacity={enterOpacity}>
              <Rect
                x={matX}
                y={matY}
                width={matW}
                height={matH}
                cornerRadius={2}
                fill={mat}
                shadow={{ color: shadowColor, blur: 50, offsetX: 0, offsetY: 22 }}
              />
              <Image
                src={src}
                x={matX + pad}
                y={matY + pad}
                width={matW - pad * 2}
                height={matH - pad * 2}
                fit="cover"
              />
            </Group>
          </Group>
        </Group>
        <Group y={nm.y} opacity={nm.opacity}>
          <Text
            x={nameX}
            y={labelTop}
            fontSize={baseName}
            color={color}
            fontFamily={nameFont}
            fontWeight={500}
            letterSpacing={letterSpacing}
          >
            {displayName}
          </Text>
        </Group>
        {eyebrow ? (
          <Group y={eb.y} opacity={eb.opacity}>
            <Text
              x={eyebrowX}
              y={labelTop + Math.round(baseName * 1.25)}
              fontSize={eyebrowSize}
              color={accent}
              fontFamily={bodyFont}
              fontWeight={600}
              letterSpacing={4}
            >
              {eyebrow}
            </Text>
          </Group>
        ) : null}
      </Group>
    )
  }

  // ── Spread (asymmetric): type column on the side opposite the card. ────────
  const typeX = layout === 'spread-right' ? margin : matX + matW + Math.round(W * 0.03)
  const typeColW =
    layout === 'spread-right' ? matX - margin - Math.round(W * 0.03) : W - typeX - margin
  const nameLines = wrap(displayName, typeColW, baseName)
  const nameLineH = Math.round(baseName * 1.12)
  const eyebrowH = eyebrow ? Math.round(eyebrowSize * 1.6) : 0
  const ruleGap = 30
  const detailGap = 26
  const blockH =
    eyebrowH + nameLines.length * nameLineH + (detail ? ruleGap + 2 + detailGap + detailSize : 0)
  const startY = Math.round((H - blockH) / 2)

  const eb = at(0)
  return (
    <Group>
      {/* Framed product */}
      <Group x={cx} y={cy}>
        <Group scaleX={cardScale} scaleY={cardScale}>
          <Group x={-cx} y={-cy} opacity={enterOpacity}>
            <Rect
              x={matX}
              y={matY}
              width={matW}
              height={matH}
              cornerRadius={2}
              fill={mat}
              shadow={{ color: shadowColor, blur: 50, offsetX: 0, offsetY: 22 }}
            />
            <Image
              src={src}
              x={matX + pad}
              y={matY + pad}
              width={matW - pad * 2}
              height={matH - pad * 2}
              fit="cover"
            />
          </Group>
        </Group>
      </Group>
      {/* Type column */}
      <Group y={enterY}>
        {eyebrow ? (
          <Group y={eb.y} opacity={eb.opacity}>
            <Text
              x={typeX}
              y={startY}
              fontSize={eyebrowSize}
              color={accent}
              fontFamily={bodyFont}
              fontWeight={600}
              letterSpacing={4}
            >
              {eyebrow}
            </Text>
          </Group>
        ) : null}
        {nameLines.map((line, i) => {
          const ln = at(1 + i)
          return (
            <Group key={`${i}-${line}`} y={ln.y} opacity={ln.opacity}>
              <Text
                x={typeX}
                y={startY + eyebrowH + i * nameLineH}
                fontSize={baseName}
                color={color}
                fontFamily={nameFont}
                fontWeight={500}
                letterSpacing={letterSpacing}
              >
                {line}
              </Text>
            </Group>
          )
        })}
        {detail
          ? (() => {
              const dl = at(1 + nameLines.length)
              const ruleY = startY + eyebrowH + nameLines.length * nameLineH + ruleGap
              return (
                <Group y={dl.y} opacity={dl.opacity}>
                  <Rect x={typeX + 2} y={ruleY} width={70} height={2} fill={accent} />
                  <Text
                    x={typeX}
                    y={ruleY + detailGap}
                    fontSize={detailSize}
                    color={detailColor}
                    fontFamily={bodyFont}
                    fontWeight={400}
                  >
                    {detail}
                  </Text>
                </Group>
              )
            })()
          : null}
      </Group>
    </Group>
  )
}
