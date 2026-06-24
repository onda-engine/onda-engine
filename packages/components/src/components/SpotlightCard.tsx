//! SpotlightCard — a glass card with a spotlight drifting behind the content,
//! the card rising in on the house spring while the title/body fade in on top.
//! Ported from ondajs.
//!
//! Composes the ported `<Spotlight>` (a soft radial reveal) as the card's
//! living background and `<FadeIn>` for the content, matching the ondajs
//! `Surface variant="glass"` + drifting `Glow` recipe.
//!
//! Self-positioning: the card is centered on the composition (ondajs's default
//! center placement). The whole card rises + fades in on the house spring
//! (`SPRING_SMOOTH`, via `useSpringValue`); the spotlight keeps drifting
//! (sin/cos of the frame) so the surface feels alive without competing for
//! attention, exactly as in the original.
//!
//! Layout: the card is positioned absolutely with explicit x/y (not a Flex) so
//! its measured size never drives a reflow, and so the card's local origin can
//! sit at its top-left for the rounded-rect clip. The content inside is stacked
//! with manual y offsets (the engine `<Text>` is single-line and not auto-laid
//! out here) so eyebrow/title/body keep a stable rhythm every frame.
//!
//! Scale/clip caveat: scale & clip anchor on the node's LOCAL ORIGIN (0,0). The
//! card Group's origin is its top-left, so the rise (a translate) is origin-safe;
//! no centered scale is applied to the card itself.
//!
//! Engine approximations vs the ondajs (CSS) original:
//! - The "glass" frost: this card is a translucent rounded `Rect` fill plus a
//!   1px border `stroke` (it doesn't blur what's behind it). The engine now ships
//!   a `backdropBlur` node prop (real frosted glass) it could adopt for the frost.
//! - The CSS `box-shadow` elevation and the 1px top `SHEEN` highlight are
//!   omitted (no box-shadow / inset-gradient primitive); the border stroke
//!   carries the surface edge.
//! - `letter-spacing` (the uppercase eyebrow tracking) is unsupported; the
//!   eyebrow is rendered without extra tracking.
//! - The drifting glow is a GPU-only soft reveal (the CPU reference collapses a
//!   gradient to its first stop — see `<Spotlight>`).

import { Group, Rect, Text, clipRect, useCurrentFrame, useVideoConfig } from '@onda-engine/react'
import { useSpringValue } from '../hooks.js'
import { DURATION, staggerFrames } from '../motion.js'
import { type TextStyleProps, applyTextCase } from '../text-style.js'
import { useTheme } from '../theme.js'
import { type TimeInput, framesOf } from '../time.js'
import { FadeIn } from './FadeIn.js'
import { Spotlight } from './Spotlight.js'

/** Engine line-box height as a multiple of font size (matches typography crate). */
const LINE_RATIO = 1.2

export interface SpotlightCardProps extends TextStyleProps {
  /** Small uppercase kicker above the title. Empty hides it. */
  eyebrow?: string
  /** Card headline (display font). */
  title?: string
  /** Supporting body copy. Empty hides it. Single line (engine `<Text>` is
   *  single-line; pass a short string). */
  body?: string
  /** Frames before the card enters. */
  delay?: TimeInput
  /** The drifting spotlight color — the earned accent (default: theme `accent`). */
  glowColor?: string
  /** Card width in px. */
  width?: number
  /** Card height in px. If omitted, sized from the content + padding. */
  height?: number
  /** Inner padding in px. */
  padding?: number
  /** Text alignment within the card. */
  align?: 'left' | 'center'
  /** Font family for the eyebrow + body copy (default: theme `fontFamily`). */
  bodyFontFamily?: string
  /** Title font size in px (default 44). */
  titleSize?: number
  /** Body font size in px (default 20). */
  bodySize?: number
  /** Eyebrow font size in px (default 15). */
  eyebrowSize?: number
  /** Title color (default: theme `text`). */
  titleColor?: string
  /** Body color (default: theme `textMuted`). */
  bodyColor?: string
  /** Eyebrow color (default: theme `textMuted`). */
  eyebrowColor?: string
  /** Card glass fill (translucent dark by default) (default: theme `surface`). */
  background?: string
  /** Card border (stroke) color (default: theme `border`). */
  borderColor?: string
  /** Corner radius in px (default: theme `radius`). */
  cornerRadius?: number
  /** Render the card as frosted GLASS — a real backdrop-blur of what's behind it
   *  (tinted by `background`), instead of a flat translucent fill. */
  glass?: boolean
}

export function SpotlightCard({
  eyebrow = 'FEATURE',
  title = 'Motion identity',
  body = 'One consistent feel across every component.',
  delay: delayIn = 0,
  glowColor: glowColorProp,
  width = 560,
  height,
  padding = 48,
  align = 'left',
  fontFamily: fontFamilyProp,
  letterSpacing,
  uppercase,
  bodyFontFamily: bodyFontFamilyProp,
  titleSize = 44,
  bodySize = 20,
  eyebrowSize = 15,
  titleColor: titleColorProp,
  bodyColor: bodyColorProp,
  eyebrowColor: eyebrowColorProp,
  background: backgroundProp,
  borderColor: borderColorProp,
  cornerRadius: cornerRadiusProp,
  glass = false,
}: SpotlightCardProps) {
  const frame = useCurrentFrame()
  const { width: compWidth, height: compHeight, fps } = useVideoConfig()
  // TimeInput props -> frames (accepts numbers or '0.5s'/'500ms'/'12f').
  const delay = framesOf(delayIn, fps)
  const theme = useTheme()
  const glowColor = glowColorProp ?? theme.accent
  const fontFamily = fontFamilyProp ?? theme.headingFamily ?? theme.fontFamily
  const bodyFontFamily = bodyFontFamilyProp ?? theme.fontFamily
  const titleColor = titleColorProp ?? theme.text
  const bodyColor = bodyColorProp ?? theme.textMuted
  const eyebrowColor = eyebrowColorProp ?? theme.textMuted
  const background = backgroundProp ?? theme.surface
  const borderColor = borderColorProp ?? theme.border
  const cornerRadius = cornerRadiusProp ?? theme.radius

  // ── Content layout (manual stacking; engine <Text> is single-line) ─────────
  const hasEyebrow = eyebrow.length > 0
  const hasBody = body.length > 0
  const eyebrowGap = 14 // marginBottom under the eyebrow (matches ondajs)
  const bodyGap = 16 // marginTop above the body (matches ondajs)

  const eyebrowLine = eyebrowSize * LINE_RATIO
  const titleLine = titleSize * LINE_RATIO
  const bodyLine = bodySize * LINE_RATIO

  // Running vertical cursor for each content line, top of the padding box down.
  let cursor = 0
  const eyebrowY = cursor
  if (hasEyebrow) cursor += eyebrowLine + eyebrowGap
  const titleY = cursor
  cursor += titleLine
  if (hasBody) cursor += bodyGap
  const bodyY = cursor
  if (hasBody) cursor += bodyLine
  const contentHeight = cursor

  // Card dimensions: explicit, or content + padding. Absolute layout, so an
  // animated size would NOT reflow anything — but the card size is static here.
  const cardWidth = width
  const cardHeight = height ?? contentHeight + padding * 2

  // Centered on the composition (ondajs's default center placement).
  const baseX = Math.round((compWidth - cardWidth) / 2)
  const baseY = Math.round((compHeight - cardHeight) / 2)

  // ── Card entrance: rise + fade on the house spring (ondajs `useEntrance` rise).
  const entrance = useSpringValue({ delay, durationInFrames: DURATION.slow })
  const cardOpacity = entrance
  const riseY = (1 - entrance) * 16 // translate up into place (16px envelope)

  // ── Drifting spotlight center, in composition fractions, centered on the card.
  // Reproduces ondajs's `0.5 + sin(f*0.02)*0.22`, `0.4 + cos(f*0.016)*0.16`
  // but anchored to the card's center rather than the whole canvas.
  const cardCenterFracX = (baseX + cardWidth / 2) / compWidth
  const cardCenterFracY = (baseY + cardHeight / 2) / compHeight
  // Drift amplitude in fractions of the SMALLER card axis, mapped to comp space.
  const driftX = (Math.sin(frame * 0.02) * 0.22 * cardWidth) / compWidth
  const driftY = (Math.cos(frame * 0.016) * 0.16 * cardHeight) / compHeight
  const glowX = cardCenterFracX + driftX
  const glowY = cardCenterFracY + driftY
  // Spotlight radius as a % of the smaller comp dimension that roughly matches
  // ondajs's `size={0.9}` glow (~0.9 of the card's smaller axis).
  const minCard = Math.min(cardWidth, cardHeight)
  const minComp = Math.min(compWidth, compHeight)
  const glowRadiusPct = ((0.9 * minCard) / minComp) * 100

  // Text x within the padding box (left-aligned vs centered).
  const innerWidth = cardWidth - padding * 2
  const textX = align === 'center' ? Math.round(innerWidth / 2) : 0

  return (
    <Group x={baseX} y={baseY} opacity={cardOpacity}>
      {/* Rise translate nested inside the layout-positioned group (translate-safe:
          this group is positioned by explicit x/y above, not by a Flex). */}
      <Group y={riseY}>
        {/* Surface: real frosted GLASS (backdrop blur of what's behind, tinted by
            `background`) when `glass`, else a flat translucent fill + drop-shadow. */}
        {glass ? (
          <Rect
            width={cardWidth}
            height={cardHeight}
            cornerRadius={cornerRadius}
            fill="#00000000"
            backdropBlur={{ sigma: 20, tint: background, brightness: 0.97, saturation: 1.1 }}
            stroke={borderColor}
            strokeWidth={1}
          />
        ) : (
          <Rect
            width={cardWidth}
            height={cardHeight}
            cornerRadius={cornerRadius}
            fill={background}
            stroke={borderColor}
            strokeWidth={1}
            shadow={{ color: '#00000059', blur: 28, offsetY: 12 }}
          />
        )}

        {/* Drifting spotlight behind the content, clipped to the card's rounded
            rect. The spotlight renders at composition scale (its Rect + gradient
            are sized to the comp via useVideoConfig); counter-translate it back
            to the composition origin so it aligns, while the clip — anchored to
            this group's local origin (the card top-left) — masks it to the card. */}
        <Group clip={clipRect(cardWidth, cardHeight, cornerRadius)}>
          <Group x={-baseX} y={-(baseY + riseY)} opacity={0.28}>
            <Spotlight
              x={glowX}
              y={glowY}
              radius={glowRadiusPct}
              delay={delay}
              durationInFrames={DURATION.slow}
              color={glowColor}
              softness={70}
            />
          </Group>
        </Group>

        {/* Content on top, fading in just after the card lands. Manual stacking;
            each <Text> is single-line. */}
        <Group x={padding} y={padding}>
          {hasEyebrow ? (
            <FadeIn delay={delay + staggerFrames(1)} durationInFrames={DURATION.base}>
              <Text
                x={textX}
                y={eyebrowY}
                fontSize={eyebrowSize}
                color={eyebrowColor}
                fontFamily={bodyFontFamily ?? fontFamily}
                fontWeight={500}
              >
                {eyebrow}
              </Text>
            </FadeIn>
          ) : null}

          <FadeIn delay={delay + staggerFrames(2)} durationInFrames={DURATION.base}>
            <Text
              x={textX}
              y={titleY}
              fontSize={titleSize}
              color={titleColor}
              fontFamily={fontFamily}
              fontWeight={600}
              letterSpacing={letterSpacing}
            >
              {applyTextCase(title, { uppercase })}
            </Text>
          </FadeIn>

          {hasBody ? (
            <FadeIn delay={delay + staggerFrames(3)} durationInFrames={DURATION.base}>
              <Text
                x={textX}
                y={bodyY}
                fontSize={bodySize}
                color={bodyColor}
                fontFamily={bodyFontFamily ?? fontFamily}
                fontWeight={400}
              >
                {body}
              </Text>
            </FadeIn>
          ) : null}
        </Group>
      </Group>
    </Group>
  )
}
