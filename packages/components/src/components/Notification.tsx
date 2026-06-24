//! Notification — a frosted-glass toast (the signature glassmorphism element): a
//! rounded app icon, an app name + timestamp, a title and a body line, on a REAL
//! backdrop-blur panel. Self-positioning: centered on the composition. Manual
//! vertical stacking (the engine `<Text>` is single-line; pass short strings).

import { Group, Rect, Text, useVideoConfig } from '@onda-engine/react'
import { useSpringValue } from '../hooks.js'
import { DURATION } from '../motion.js'
import { useTheme } from '../theme.js'
import { type TimeInput, framesOf } from '../time.js'

/** Engine line-box height as a multiple of font size. */
const LINE_RATIO = 1.2

export interface NotificationProps {
  /** App / sender name (small, top row). */
  app?: string
  /** Notification title (bold). */
  title?: string
  /** Notification body — one muted line. */
  body?: string
  /** Timestamp (faint, top-right). */
  time?: string
  /** Frames before the entrance begins. */
  delay?: TimeInput
  /** Panel width in px. */
  width?: number
  /** App-icon square fill (default: theme `accent`). */
  accent?: string
  /** Frosted tint (hex `#rrggbbaa`) — the glass fill (default: a translucent surface). */
  glassTint?: string
  /** Panel border color (default: theme `border`). */
  borderColor?: string
  /** Title color (default: theme `text`). */
  color?: string
  /** App / body / time color (default: theme `textMuted`). */
  dimColor?: string
  /** Corner radius in px (default: 28). */
  cornerRadius?: number
  /** Font family (default: theme `fontFamily`). */
  fontFamily?: string
}

export function Notification({
  app = 'Onda',
  title = 'Your render is ready',
  body = 'Tap to watch — exported in 4K.',
  time = 'now',
  delay: delayIn = 0,
  width = 720,
  accent: accentProp,
  glassTint = '#ffffff2e',
  borderColor: borderColorProp,
  color: colorProp,
  dimColor: dimColorProp,
  cornerRadius = 28,
  fontFamily: fontFamilyProp,
}: NotificationProps) {
  const { width: compWidth, height: compHeight, fps } = useVideoConfig()
  const theme = useTheme()
  const delay = framesOf(delayIn, fps)
  const accent = accentProp ?? theme.accent
  const borderColor = borderColorProp ?? theme.border
  const color = colorProp ?? theme.text
  const dimColor = dimColorProp ?? theme.textMuted
  const fontFamily = fontFamilyProp ?? theme.fontFamily

  const padding = 30
  const iconSize = 68
  const iconRadius = 18
  const textX = padding + iconSize + 22

  const appSize = 18
  const titleSize = 30
  const bodySize = 23
  const gap = 9

  // Manual vertical stack (engine <Text> is single-line), from the padding box top.
  const appY = 2
  const titleY = appY + appSize * LINE_RATIO + gap
  const bodyY = titleY + titleSize * LINE_RATIO + gap
  const blockH = bodyY + bodySize * LINE_RATIO
  const panelH = padding * 2 + Math.max(iconSize, blockH)

  const baseX = Math.round((compWidth - width) / 2)
  const baseY = Math.round((compHeight - panelH) / 2)

  // Spring rise + fade entrance (matches the cards).
  const entrance = useSpringValue({ delay, durationInFrames: DURATION.slow })
  const riseY = (1 - entrance) * 16

  return (
    <Group x={baseX} y={baseY} opacity={entrance}>
      <Group y={riseY}>
        {/* Frosted glass panel — real backdrop blur of what's behind it. */}
        <Rect
          width={width}
          height={panelH}
          cornerRadius={cornerRadius}
          fill="#00000000"
          backdropBlur={{ sigma: 22, tint: glassTint, brightness: 0.97, saturation: 1.1 }}
          stroke={borderColor}
          strokeWidth={1}
        />
        {/* App icon — a rounded accent square. */}
        <Rect
          x={padding}
          y={padding}
          width={iconSize}
          height={iconSize}
          cornerRadius={iconRadius}
          fill={accent}
        />
        {/* Text block (icon to its left). */}
        <Group x={textX} y={padding}>
          <Text
            x={0}
            y={appY}
            fontSize={appSize}
            color={dimColor}
            fontFamily={fontFamily}
            fontWeight={600}
            letterSpacing={1.2}
          >
            {app.toUpperCase()}
          </Text>
          <Text
            x={width - textX - padding - 52}
            y={appY}
            fontSize={appSize}
            color={dimColor}
            fontFamily={fontFamily}
            fontWeight={500}
          >
            {time}
          </Text>
          <Text
            x={0}
            y={titleY}
            fontSize={titleSize}
            color={color}
            fontFamily={fontFamily}
            fontWeight={700}
          >
            {title}
          </Text>
          <Text
            x={0}
            y={bodyY}
            fontSize={bodySize}
            color={dimColor}
            fontFamily={fontFamily}
            fontWeight={400}
          >
            {body}
          </Text>
        </Group>
      </Group>
    </Group>
  )
}
