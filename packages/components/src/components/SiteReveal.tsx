//! SiteReveal — the "it's live" payoff for a launch film: a soft-shadowed browser
//! card that scale-fades in and then slowly SCROLLS a full-page screenshot of the
//! homepage (a gentle auto-scroll, not a fast flick), so the whole site reads as
//! real and live. Pairs with a headline beat ("Now live.") placed as an EARLIER
//! scene sibling — list the headline before this so the internal content clip
//! never occludes it.
//!
//! The page is a tall full-page capture (e.g. 1400×6274). Pass its `pageAspect`
//! (height/width) so the component scales it to the card width and scrolls
//! through `scrollStart`→`scrollEnd` of the page over the beat. The scrolling
//! image is masked to the viewport with `clipRect` — the clip is the LAST node in
//! the card and the chrome is drawn first, so the frame chrome is never clipped.
//!
//! Premium chrome: a clean centered address pill (not macOS traffic lights) over
//! a near-white bar, a soft drop shadow under the rounded card (the same framed-
//! print depth as LookbookShot) — consistent with an editorial brand film.

import {
  Ellipse,
  Group,
  Image,
  Rect,
  Text,
  clipRect,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from '@onda-engine/react'
import { DURATION, SPRING_SMOOTH } from '../motion.js'
import { useTheme } from '../theme.js'

const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const

export interface SiteRevealProps {
  /** Full-page screenshot (tall) — the homepage to scroll. */
  src?: string
  /** Address-bar text. */
  url?: string
  /** Page height / width of `src` (drives the scroll extent). Default ~4.48. */
  pageAspect?: number
  /** Card content width in px (default 1360). */
  width?: number
  /** Viewport height in px below the chrome bar (default 770). */
  height?: number
  /** Vertical nudge of the whole card from center (default 56, slightly low to
   *  leave room for a headline above). */
  offsetY?: number
  /** Frames before the card enters. */
  delay?: number
  /** Type the URL into the address bar (with a blinking cursor) before scrolling
   *  — the "navigate to the site" beat. Default true. */
  typeUrl?: boolean
  /** Frames the URL takes to type in (default 26). */
  typeDurationInFrames?: number
  /** Page fraction (0..1) shown at the start of the scroll (default 0 = top). */
  scrollStart?: number
  /** Page fraction (0..1) reached at the end (default 0.62 — stop before footer). */
  scrollEnd?: number
  /** Frames over which the scroll completes (default 150). */
  scrollDurationInFrames?: number
  /** Card body fill (default near-white). */
  surface?: string
  /** Chrome bar fill (default a light warm gray). */
  barColor?: string
  /** 1px card border + chrome divider (default: theme `border`). */
  border?: string
  /** Address pill text color (default: theme `textMuted`). */
  dim?: string
  /** Soft shadow color under the card (default a low-alpha warm dark). */
  shadowColor?: string
  /** Card corner radius in px (default 16). */
  cardRadius?: number
}

const CHROME_H = 58
const DOT = 12
const DOT_GAP = 9

export function SiteReveal({
  src = '',
  url = '',
  pageAspect = 4.48,
  width = 1360,
  height = 770,
  offsetY = 56,
  delay = 0,
  typeUrl = true,
  typeDurationInFrames = 26,
  scrollStart = 0,
  scrollEnd = 0.62,
  scrollDurationInFrames = 150,
  surface = '#fdfcf9',
  barColor = '#f1ece1',
  border: borderProp,
  dim: dimProp,
  shadowColor = '#2b201826',
  cardRadius = 16,
}: SiteRevealProps) {
  const frame = useCurrentFrame()
  const { width: W, height: H, fps } = useVideoConfig()
  const theme = useTheme()
  const border = borderProp ?? theme.border
  const dim = dimProp ?? theme.textMuted

  const cardW = width
  const cardH = CHROME_H + height
  const cx = W / 2
  const cy = H / 2 + offsetY

  // Entrance: house scale-fade about the card center.
  const enter = spring({
    frame: Math.max(0, frame - delay),
    fps,
    config: SPRING_SMOOTH,
    durationInFrames: DURATION.base,
  })
  const opacity = interpolate(enter, [0, 1], [0, 1], CLAMP)
  const scale = interpolate(enter, [0, 1], [0.965, 1], CLAMP)

  // URL types into the address bar after the card lands (a blinking cursor while
  // typing), then the scroll waits until the URL is finished — the "navigate to
  // the site, then browse it" beat.
  const typeStart = delay + 14
  const typeP = typeUrl
    ? interpolate(frame - typeStart, [0, typeDurationInFrames], [0, 1], CLAMP)
    : 1
  const typedUrl = url.slice(0, Math.round(url.length * typeP))
  const typing = typeUrl && frame >= typeStart && frame < typeStart + typeDurationInFrames
  const cursorOn = typing && Math.floor((frame - typeStart) / 6) % 2 === 0
  const urlText = typeUrl ? typedUrl + (cursorOn ? '|' : '') : url
  const scrollBegin = typeUrl ? typeStart + typeDurationInFrames + 8 : delay + 10

  // Auto-scroll: the page is scaled to the card width, then panned through
  // scrollStart→scrollEnd of its height over the beat (linear — a steady scroll).
  const scaledPageH = cardW * pageAspect
  const scrollRange = Math.max(0, scaledPageH - height)
  const p = interpolate(frame - scrollBegin, [0, scrollDurationInFrames], [0, 1], CLAMP)
  const frac = scrollStart + (scrollEnd - scrollStart) * p
  const scrollY = -scrollRange * frac

  const bodyX = -cardW / 2
  const bodyY = -cardH / 2

  // Centered address pill geometry.
  const pillW = Math.min(560, Math.round(cardW * 0.42))
  const pillH = 34
  const pillX = Math.round(-pillW / 2)
  const pillY = bodyY + Math.round((CHROME_H - pillH) / 2)
  const dotY = bodyY + Math.round((CHROME_H - DOT) / 2)

  return (
    <Group x={cx} y={cy} scaleX={scale} scaleY={scale} opacity={opacity}>
      {/* Card body — soft drop shadow, near-white, hairline border. */}
      <Rect
        x={bodyX}
        y={bodyY}
        width={cardW}
        height={cardH}
        cornerRadius={cardRadius}
        fill={surface}
        stroke={border}
        strokeWidth={1}
        shadow={{ color: shadowColor, blur: 60, offsetX: 0, offsetY: 26 }}
      />
      {/* Chrome bar. */}
      <Rect
        x={bodyX}
        y={bodyY}
        width={cardW}
        height={CHROME_H}
        cornerRadius={cardRadius}
        fill={barColor}
      />
      {/* square off the bar's bottom corners so only the top is rounded */}
      <Rect
        x={bodyX}
        y={bodyY + CHROME_H - cardRadius}
        width={cardW}
        height={cardRadius}
        fill={barColor}
      />
      {[0, 1, 2].map((i) => (
        <Ellipse
          key={i}
          x={bodyX + 26 + i * (DOT + DOT_GAP)}
          y={dotY}
          width={DOT}
          height={DOT}
          fill={border}
        />
      ))}
      {/* Address pill (centered). */}
      <Rect
        x={pillX}
        y={pillY}
        width={pillW}
        height={pillH}
        cornerRadius={pillH / 2}
        fill={surface}
        stroke={border}
        strokeWidth={1}
      />
      <Group
        x={pillX + 18}
        y={pillY + Math.round((pillH - 20) / 2)}
        clip={clipRect(pillW - 36, 22)}
      >
        <Text fontSize={20} color={dim}>
          {urlText}
        </Text>
      </Group>
      {/* 1px divider under the chrome. */}
      <Rect x={bodyX} y={bodyY + CHROME_H - 1} width={cardW} height={1} fill={border} />

      {/* Content viewport — the scrolling page, masked to the viewport. The clip
          is the LAST node (chrome already drawn), so the chrome is never cut. */}
      <Group x={bodyX} y={bodyY + CHROME_H} clip={clipRect(cardW, height)}>
        <Image src={src} x={0} y={scrollY} width={cardW} height={scaledPageH} fit="cover" />
      </Group>
    </Group>
  )
}
