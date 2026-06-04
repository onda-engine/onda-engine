//! InputField — a UI text-input mockup. Ported from ondajs (`input-field`).
//!
//! A rounded "glass" field with an optional uppercase label above. With `typed`
//! on, the `value` types itself in character-by-character (via `useTextReveal`,
//! linear cadence) behind a thin blinking accent caret; once typing settles the
//! caret keeps a slower idle blink. An accent focus ring lights the border once
//! typing begins. Every animated quantity is a pure function of the current
//! frame (caret blink is frame-parity, the reveal is `useTextReveal`), so the
//! field is fully deterministic (CLAUDE.md §1).
//!
//! Layout notes vs the ondajs (CSS) original:
//!  - ondajs lays the field out with `display: flex` + `Surface` and lets the
//!    DOM measure the value text so the caret sits exactly after the last glyph.
//!    `@onda/react` has no author-time text metrics, so the visible value width
//!    is ESTIMATED from `glyphCount * fontSize * AVG_CHAR_W` and the caret Rect
//!    is placed at that x. The estimate need only be roughly proportional — the
//!    caret reads as "at the typing edge". (See `approximations`.)
//!  - The value `<Text>` grows one glyph per frame while typing, so its measured
//!    box changes every frame. To avoid a `<Flex>` reflow/jiggle (HARD RULE 2)
//!    the whole field is positioned ABSOLUTELY: its top-left offset is computed
//!    from the composition size (the BarChart pattern) and every part is laid at
//!    an explicit x/y inside a fixed-size field `<Rect>` — no layout container.
//!  - CSS `letter-spacing` on the label and a `box-shadow` focus glow have no
//!    engine primitive; the label renders without extra tracking and the focus
//!    ring is approximated by a low-alpha accent stroke just outside the border.

import { Flex, Group, Rect, Text, useCurrentFrame, useVideoConfig } from '@onda/react'
import { useTextReveal } from '../hooks.js'
import { useTheme } from '../theme.js'

/** Engine line-box height as a multiple of font size (typography crate). */
const LINE_RATIO = 1.2

export interface InputFieldProps {
  /** The field's value. With `typed` on, this is what types itself in. */
  value?: string
  /** Placeholder shown while the field is empty (before any glyph is revealed). */
  placeholder?: string
  /** Label above the field. Empty string hides it. */
  label?: string
  /** Animate `value` typing itself in character-by-character (`useTextReveal`). */
  typed?: boolean
  /** Frames before typing starts. */
  delay?: number
  /** Frames to type the whole value (linear pacing). */
  typeDuration?: number
  /** Show the accent focus ring around the field once typing begins. */
  focusRing?: boolean
  /** Field width in px. Sized for a 1080p+ video canvas, not a screen UI. */
  width?: number
  /** Text size in px. */
  fontSize?: number
  /** UI font family (e.g. a `--font` passed to `onda render`) (default: theme `fontFamily`). */
  fontFamily?: string
  /** Value text color (default: theme `text`). */
  textColor?: string
  /** Placeholder text color (default: theme `textMuted`). */
  placeholderColor?: string
  /** Label text color (default: theme `textMuted`). */
  labelColor?: string
  /** Caret + focus-ring color — the one earned accent (the Onda rose) (default: theme `accent`). */
  accentColor?: string
  /** Resting (unfocused) field border color (default: theme `border`). */
  borderColor?: string
  /** Field background fill (the "glass" surface) (default: theme `surface`). */
  fieldColor?: string
  /** Horizontal center of the field as a 0–1 fraction of canvas width. */
  x?: number
  /** Vertical center of the field as a 0–1 fraction of canvas height. */
  y?: number
}

export function InputField({
  value = 'hello@onda.video',
  placeholder = 'Enter your email',
  label = 'Email',
  typed = true,
  delay = 0,
  typeDuration = 36,
  focusRing = true,
  width = 640,
  fontSize = 36,
  fontFamily: fontFamilyProp,
  textColor: textColorProp,
  placeholderColor: placeholderColorProp,
  labelColor: labelColorProp,
  accentColor: accentColorProp,
  borderColor: borderColorProp,
  fieldColor: fieldColorProp,
  x = 0.5,
  y = 0.5,
}: InputFieldProps) {
  const frame = useCurrentFrame()
  const { width: compWidth, height: compHeight } = useVideoConfig()
  const theme = useTheme()
  const textColor = textColorProp ?? theme.text
  const placeholderColor = placeholderColorProp ?? theme.textMuted
  const labelColor = labelColorProp ?? theme.textMuted
  const accentColor = accentColorProp ?? theme.accent
  const borderColor = borderColorProp ?? theme.border
  const fieldColor = fieldColorProp ?? theme.surface
  const fontFamily = fontFamilyProp ?? theme.fontFamily

  // How much of the value is visible. With typing off, the whole value shows.
  const shown = useTextReveal({ length: value.length, delay, durationInFrames: typeDuration })
  const visible = typed ? value.slice(0, Math.max(0, shown)) : value
  const typing = typed && shown < value.length

  // Caret blinks while typing (faster, tracking each keystroke) and after it
  // settles (slower, an idle cursor). Pure frame math — no timer (CLAUDE.md §1).
  const blinkOn = typing ? Math.floor(frame / 8) % 2 === 0 : Math.floor(frame / 18) % 2 === 0
  // Caret only appears once typing has actually begun (frame >= delay); before
  // then the field rests on a steady placeholder with no blinking cursor.
  const showCaret = typed && frame >= delay && blinkOn

  // Focus ring only reads as "focused" once typing is underway / done.
  const focused = focusRing && (!typed || frame >= delay)
  const fieldBorder = focused ? accentColor : borderColor

  // Placeholder shows steadily while the field is empty and typing hasn't begun
  // (no caret to blink against). Once typing starts it gives way to the caret.
  const showPlaceholder = visible.length === 0 && (!typed || frame < delay)

  // Field geometry. Generous vertical padding so the line box breathes, matching
  // the ondajs `22px 28px` padding scaled to the video font size.
  const padX = Math.round(fontSize * 0.8)
  const padY = Math.round(fontSize * 0.6)
  const lineHeight = fontSize * LINE_RATIO
  const fieldHeight = lineHeight + padY * 2
  const cornerRadius = theme.radius ?? Math.round(fontSize * 0.4)

  // Label sits above the field, uppercased and dim (ondajs `textTransform` +
  // `letterSpacing`; the engine has no letter-spacing — see approximations).
  const hasLabel = label.length > 0
  const labelSize = Math.round(fontSize * 0.52)
  const labelGap = Math.round(fontSize * 0.4)
  const labelBlock = hasLabel ? labelSize * LINE_RATIO + labelGap : 0

  // Total assembly footprint, centered by an explicit top-left offset (the
  // BarChart pattern) so the per-frame value-width changes never reflow a layout.
  const totalHeight = labelBlock + fieldHeight
  const originX = Math.round(x * compWidth - width / 2)
  const originY = Math.round(y * compHeight - totalHeight / 2)

  // Top of the (vertically centered) value line box inside the field.
  const textY = labelBlock + padY
  const textX = padX

  // The caret sits right after the value via a Flex row (the engine measures the
  // text), so no glyph-width estimate is needed — a hair of gap separates it from
  // the last glyph.
  const caretWidth = Math.max(2, Math.round(fontSize * 0.06))
  const caretGap = Math.max(6, Math.round(fontSize * 0.22))

  // Focus-ring glow: a low-alpha accent stroke just outside the field border,
  // standing in for the ondajs CSS box-shadow (see approximations).
  const ringInset = 4
  const ringStroke = `${accentColor}40`

  return (
    <Group x={originX} y={originY}>
      {/* Label above the field (uppercased, dim). */}
      {hasLabel ? (
        <Text
          x={0}
          y={0}
          fontSize={labelSize}
          letterSpacing={labelSize * 0.08}
          color={labelColor}
          fontFamily={fontFamily}
          fontWeight={600}
        >
          {label.toUpperCase()}
        </Text>
      ) : null}

      {/* Focus ring — drawn behind the field as a soft accent outline. */}
      {focused ? (
        <Rect
          x={-ringInset}
          y={labelBlock - ringInset}
          width={width + ringInset * 2}
          height={fieldHeight + ringInset * 2}
          cornerRadius={cornerRadius + ringInset}
          fill="#00000000"
          stroke={ringStroke}
          strokeWidth={6}
        />
      ) : null}

      {/* The glass field — rounded background with a (focus-aware) border. */}
      <Rect
        x={0}
        y={labelBlock}
        width={width}
        height={fieldHeight}
        cornerRadius={cornerRadius}
        fill={fieldColor}
        stroke={fieldBorder}
        strokeWidth={2}
      />

      {/* Placeholder while the field is empty (steady, before typing begins). */}
      {showPlaceholder ? (
        <Text
          x={textX}
          y={textY}
          fontSize={fontSize}
          color={placeholderColor}
          fontFamily={fontFamily}
          fontWeight={400}
        >
          {placeholder}
        </Text>
      ) : null}

      {/* Value + caret in a row so the ENGINE measures the typed text and the
          caret lands right after the last glyph (no width estimate). The row is
          left-pinned at the text origin and only grows rightward as it types — the
          fixed field Rect never reflows. */}
      {visible.length > 0 || showCaret ? (
        <Flex direction="row" align="center" gap={caretGap} x={textX} y={textY} height={lineHeight}>
          {visible.length > 0 ? (
            <Text fontSize={fontSize} color={textColor} fontFamily={fontFamily} fontWeight={400}>
              {visible}
            </Text>
          ) : null}
          {showCaret ? (
            <Rect width={caretWidth} height={fontSize} cornerRadius={1} fill={accentColor} />
          ) : null}
        </Flex>
      ) : null}
    </Group>
  )
}
