//! PricingCard — a single pricing tier: a rounded glass panel with the tier
//! name, a large price + billing period, an accent-checkmark feature list that
//! reveals on a stagger, and a CTA button. The whole card rises in on the house
//! spring. `recommended` lifts + scales the card, shows an accent badge, and
//! floats a soft accent glow behind it. Ported from ondajs (`pricing-card`).
//!
//! Scene-graph notes vs the ondajs (CSS) original:
//! - ondajs is a CSS flex column inside a glass `Surface`; the scene graph has no
//!   JS-side text measurement, so the card is laid out by EXPLICIT pixel y-offsets
//!   inside a fixed-size `<Group>` (panel `width` × computed height) rather than a
//!   `<Flex>` — feature rows fade in per-frame, and a layout container would
//!   reflow/jiggle as each row's measured bbox appeared. The card is centered on
//!   the composition by computing its top-left offset (see `x`/`y` to override).
//! - The entrance lift+scale for `recommended` is composed as a STATIC scale on
//!   the panel's own subtree. Scene scale pivots on the LOCAL ORIGIN, so the
//!   recommended scale is anchored to the card's top-left (a subtle top-anchored
//!   grow), not its center — close enough to the ondajs `scale(1.04)` for a
//!   single highlighted card; document if you nest differently.
//! - Approximations: CSS `letter-spacing` + `text-transform: uppercase` on the
//!   tier label and badge — the engine has no letter-spacing, so the tier name is
//!   uppercased in JS and tracking is dropped. The recommended GLOW is a scene
//!   `radialGradient` (ondajs blurs a `Glow`); gradients render only on the
//!   Vello/GPU backend (CPU reference collapses to the first stop). The CTA label
//!   and the billing-period offset are centered/placed via real shaped text
//!   measurement (`useTextMetrics`); only the recommended badge pill still uses a
//!   glyph-count width estimate. The checkmark is a `<Path>`
//!   (GPU only) — on the CPU reference it simply won't paint.

import {
  Group,
  Path,
  Rect,
  Text,
  radialGradient,
  useCurrentFrame,
  useVideoConfig,
} from '@onda/react'
import { entryFade, entryFadeRise } from '../choreography.js'
import { DURATION, staggerFrames } from '../motion.js'
import { type Placement, usePlacement } from '../placement.js'
import { useTextMetrics } from '../text-metrics.js'
import { useTheme } from '../theme.js'
import { type TimeInput, framesOf } from '../time.js'

/** Engine line-box height as a multiple of font size (matches typography crate). */
const LINE_RATIO = 1.2

export interface PricingCardProps {
  /** Tier name above the price (e.g. `'Pro'`). Rendered uppercase. */
  tier?: string
  /** The headline price, rendered large. Free-form: `'$29'`, `'€19'`, `'Free'`. */
  price?: string
  /** Billing period beneath the price (e.g. `'/month'`). Empty hides it. */
  period?: string
  /** Feature checklist — each item gets an accent checkmark, revealed on a stagger. */
  features?: string[]
  /** Call-to-action button label. */
  cta?: string
  /** Lifts + scales the card and shows an accent badge — the highlighted tier. */
  recommended?: boolean
  /** The earned accent — checkmarks, badge, CTA, recommended border + glow (default: theme `accent`). */
  accent?: string
  /** Frames before the card enters. */
  delay?: TimeInput
  /** Card width in px. */
  width?: number
  /** Price font size in px (the large display number). */
  priceSize?: number
  /** Panel fill color (default: theme `surface`). */
  background?: string
  /** Panel border color (when not `recommended`) (default: theme `border`). */
  borderColor?: string
  /** Primary text color (price, features) (default: theme `text`). */
  color?: string
  /** Dim color for the tier label (default: theme `textMuted`). */
  dimColor?: string
  /** Faint color for the billing period (default: theme `textMuted`). */
  faintColor?: string
  /** Display font for the price (default: theme `headingFamily ?? fontFamily`). */
  fontFamily?: string
  /** Body font for tier / features / CTA (default: theme `fontFamily`). */
  bodyFontFamily?: string
  /** Where the card sits: a region keyword (`'center'`, `'lower-third'`, …) or
   *  normalized `{x,y}` (0–1, card center). The shared placement contract;
   *  default `'center'`. */
  placement?: Placement
  /** @deprecated Legacy alias — x of the card's top-left in px. Prefer
   *  `placement`. */
  x?: number
  /** @deprecated Legacy alias — y of the card's top-left in px. Prefer
   *  `placement`. */
  y?: number
}

const DEFAULT_FEATURES = [
  'Unlimited renders',
  'Signature motion identity',
  'Source you own, copied in',
  'Priority support',
]

export function PricingCard({
  tier = 'Pro',
  price = '$29',
  period = '/month',
  features = DEFAULT_FEATURES,
  cta = 'Get started',
  recommended = false,
  accent: accentProp,
  delay: delayIn = 0,
  width = 380,
  priceSize = 64,
  background: backgroundProp,
  borderColor: borderColorProp,
  color: colorProp,
  dimColor: dimColorProp,
  faintColor: faintColorProp,
  fontFamily: fontFamilyProp,
  bodyFontFamily: bodyFontFamilyProp,
  placement,
  x,
  y,
}: PricingCardProps) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  // TimeInput props -> frames (accepts numbers or '0.5s'/'500ms'/'12f').
  const delay = framesOf(delayIn, fps)
  const theme = useTheme()
  const accent = accentProp ?? theme.accent
  const background = backgroundProp ?? theme.surface
  const borderColor = borderColorProp ?? theme.border
  const color = colorProp ?? theme.text
  const dimColor = dimColorProp ?? theme.textMuted
  const faintColor = faintColorProp ?? theme.textMuted
  const fontFamily = fontFamilyProp ?? theme.headingFamily ?? theme.fontFamily
  const bodyFontFamily = bodyFontFamilyProp ?? theme.fontFamily

  // --- Layout constants (px) — the explicit column the engine layout pass
  // would otherwise produce, kept fixed so per-frame row fades don't reflow. ---
  const padding = 40
  const tierSize = 15
  const periodSize = 18
  const featureSize = 18
  const ctaSize = 17
  const checkBox = 18
  const checkGap = 12
  const sectionGap = 24
  const featureGap = 14
  const ctaHeight = 48
  const contentWidth = width - padding * 2

  // Real shaped text widths (proportional — exact) used to center the CTA label
  // and to offset the billing period after the price. The engine measures these;
  // they fall back to a glyph-count estimate until the wasm engine warms.
  const ctaMetrics = useTextMetrics(cta, ctaSize, { fontFamily: bodyFontFamily, fontWeight: 600 })
  const priceMetrics = useTextMetrics(price, priceSize, {
    fontFamily,
    fontWeight: 600,
    letterSpacing: priceSize * -0.03,
  })

  // Vertical cursor through the card body, accumulating each section's height.
  const tierY = padding
  const priceY = tierY + tierSize * LINE_RATIO + sectionGap
  const featuresY = priceY + priceSize * LINE_RATIO + sectionGap
  const featureRow = featureSize * LINE_RATIO + featureGap
  const featuresHeight = features.length > 0 ? featureRow * features.length - featureGap : 0
  const ctaY = featuresY + featuresHeight + sectionGap
  const cardHeight = ctaY + ctaHeight + padding

  // The recommended tier sits a touch higher + larger — a STATIC lift composed
  // with the entrance, not an animation (matches ondajs `translateY(-16px) scale(1.04)`).
  const liftY = recommended ? -16 : 0
  const liftScale = recommended ? 1.04 : 1

  // Anchor the fixed-size card on the shared placement contract (card CENTER at
  // the resolved point; corner regions sit flush on the safe margin). Legacy px
  // `x`/`y` (top-left) win per-axis; the default is centered, as before. (No
  // layout container: per-frame feature fades never trigger a reflow.)
  const resolved = usePlacement(placement, { width, height: cardHeight })
  const originX = x ?? Math.round(resolved.originX)
  const originY = y ?? Math.round(resolved.originY)

  // Entrance — opacity + rise on the house spring (ondajs `useEntrance('rise')`).
  const enter = entryFadeRise({ frame, fps, delay })

  const panelBorder = recommended ? accent : borderColor

  // CTA label centered via real shaped text measurement.
  const ctaTextWidth = ctaMetrics.width
  const ctaTextX = Math.round((contentWidth - ctaTextWidth) / 2)
  const ctaTextY = Math.round((ctaHeight - ctaSize * LINE_RATIO) / 2)

  // Recommended badge box (top-right) — estimated label width + horizontal padding.
  // Uppercase caps run noticeably wider than the body advance, so size the pill
  // with a deliberately wide glyph ratio and generous side padding to keep the
  // label clear of the rounded border (the trailing cap mustn't crowd the edge).
  const badgeLabel = 'RECOMMENDED'
  const badgeFontSize = 12
  const badgePadX = 16
  const badgeWidthRatio = 0.72
  // ondajs tracks the badge at 0.12em — widens it by tracking × (glyphs − 1).
  const badgeTracking = badgeFontSize * 0.12
  const badgeTextWidth =
    badgeLabel.length * badgeFontSize * badgeWidthRatio +
    badgeTracking * Math.max(0, badgeLabel.length - 1)
  const badgeWidth = Math.round(badgeTextWidth + badgePadX * 2)
  const badgeHeight = Math.round(badgeFontSize * LINE_RATIO + 8)

  return (
    <Group x={originX} y={originY} opacity={enter.opacity}>
      {/* Entrance rise + static recommended lift. Scale pivots on the local
          origin (top-left) — top-anchored grow for the highlighted card. */}
      <Group y={enter.y + liftY} scaleX={liftScale} scaleY={liftScale}>
        {/* Soft accent glow behind the recommended card (GPU only). Painted
            first so it sits beneath the panel; a canvas-local radial fading to
            transparent, centered near the card's top edge. */}
        {recommended ? (
          <Rect
            x={-width * 0.15}
            y={-cardHeight * 0.12}
            width={width * 1.3}
            height={cardHeight * 0.7}
            gradient={radialGradient([width / 2, cardHeight * 0.1], width * 0.65, [
              { offset: 0, color: withAlpha(accent, 0x38) },
              { offset: 1, color: withAlpha(accent, 0x00) },
            ])}
          />
        ) : null}

        {/* Glass panel. */}
        <Rect
          width={width}
          height={cardHeight}
          cornerRadius={theme.radius}
          fill={background}
          stroke={panelBorder}
          strokeWidth={recommended ? 2 : 1}
        />

        {/* --- Card body, inset by `padding`. --- */}
        <Group x={padding} y={0}>
          {/* Tier name (uppercased, ondajs `0.16em` tracking; left-aligned). */}
          <Text
            x={0}
            y={tierY}
            fontSize={tierSize}
            letterSpacing={tierSize * 0.16}
            color={dimColor}
            fontFamily={bodyFontFamily}
            fontWeight={600}
          >
            {tier.toUpperCase()}
          </Text>

          {/* Recommended badge — outlined pill in the top-right. */}
          {recommended ? (
            <Group x={contentWidth - badgeWidth} y={tierY - 6}>
              <Rect
                width={badgeWidth}
                height={badgeHeight}
                cornerRadius={badgeHeight / 2}
                fill="#00000000"
                stroke={accent}
                strokeWidth={1}
              />
              <Text
                x={badgePadX}
                y={Math.round((badgeHeight - badgeFontSize * LINE_RATIO) / 2)}
                fontSize={badgeFontSize}
                letterSpacing={badgeTracking}
                color={accent}
                fontFamily={bodyFontFamily}
                fontWeight={600}
              >
                {badgeLabel}
              </Text>
            </Group>
          ) : null}

          {/* Price (large display, ondajs `-0.03em`) + billing period; left-aligned,
              billing offset uses priceMetrics which now folds in the tracking. */}
          <Text
            x={0}
            y={priceY}
            fontSize={priceSize}
            letterSpacing={priceSize * -0.03}
            color={color}
            fontFamily={fontFamily}
            fontWeight={600}
          >
            {price}
          </Text>
          {period ? (
            <Text
              x={Math.round(priceMetrics.width + 8)}
              y={Math.round(priceY + (priceSize - periodSize) * 0.9)}
              fontSize={periodSize}
              color={faintColor}
              fontFamily={bodyFontFamily}
              fontWeight={500}
            >
              {period}
            </Text>
          ) : null}

          {/* Feature checklist — accent checkmarks, each row fades in on a stagger.
              Opacity-only motion (layout-safe; rows are explicitly y-positioned). */}
          {features.map((feature, i) => {
            const rowDelay = delay + staggerFrames(i + 2)
            const { opacity } = entryFade({
              frame,
              fps,
              delay: rowDelay,
              durationInFrames: DURATION.base,
            })
            const rowY = featuresY + featureRow * i
            return (
              <Group key={`${i}-${feature}`} y={rowY} opacity={opacity}>
                {/* Accent checkmark (GPU-only Path). Drawn within an 18×18 box,
                    nudged down to sit on the text's optical center. */}
                <Group y={3}>
                  <Path
                    d={`M ${checkBox * 0.22} ${checkBox * 0.53} L ${checkBox * 0.4} ${
                      checkBox * 0.69
                    } L ${checkBox * 0.78} ${checkBox * 0.31}`}
                    fill="#00000000"
                    stroke={accent}
                    strokeWidth={2}
                    strokeCap="round"
                    strokeJoin="round"
                  />
                </Group>
                <Text
                  x={checkBox + checkGap}
                  y={0}
                  fontSize={featureSize}
                  letterSpacing={featureSize * 0.01}
                  color={color}
                  fontFamily={bodyFontFamily}
                  fontWeight={400}
                >
                  {feature}
                </Text>
              </Group>
            )
          })}

          {/* CTA button — filled accent when recommended, else an outline. */}
          <Group y={ctaY}>
            <Rect
              width={contentWidth}
              height={ctaHeight}
              cornerRadius={theme.radius}
              fill={recommended ? accent : '#00000000'}
              stroke={recommended ? accent : borderColor}
              strokeWidth={1}
            />
            <Text
              x={ctaTextX}
              y={ctaTextY}
              fontSize={ctaSize}
              color={recommended ? '#08080a' : color}
              fontFamily={bodyFontFamily}
              fontWeight={600}
            >
              {cta}
            </Text>
          </Group>
        </Group>
      </Group>
    </Group>
  )
}

/** Return `color` (`#rrggbb` / `#rrggbbaa` / `#rgb`) with its alpha channel set to
 *  the given byte (0..255), preserving RGB so a gradient fades the accent rather
 *  than toward black. Falls back to the input unchanged on an unknown format. */
function withAlpha(color: string, alpha: number): string {
  const a = Math.max(0, Math.min(255, Math.round(alpha)))
    .toString(16)
    .padStart(2, '0')
  if (color.startsWith('#')) {
    const hex = color.slice(1)
    if (hex.length === 6 || hex.length === 8) {
      return `#${hex.slice(0, 6)}${a}`
    }
    if (hex.length === 3) {
      const r = hex[0] ?? '0'
      const g = hex[1] ?? '0'
      const b = hex[2] ?? '0'
      return `#${r}${r}${g}${g}${b}${b}${a}`
    }
  }
  return color
}
