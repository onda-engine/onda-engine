//! DeckFlyover — a virtual camera flying over a board of editable PRESENTATION
//! slides: the "behold the whole deck" beat. It opens on the whole board, punches
//! into one hero slide, holds, pulls back to reveal the deck again, then pans
//! slowly across it.
//!
//! The motion is a real 2D {@link Camera} (translate∘scale∘translate about a focus
//! point) animated over five eased phases — establish → punch-in → hold → pull-back
//! → pan. The slides are laid out once in WORLD coordinates by the BentoGrid
//! auto-flow packer; the camera frames a moving sub-window of that world.
//!
//! Every slide is EDITABLE and renders as a real deck slide (logo lockup, title,
//! body/cards/list, footer + page number), in a light OR navy-dark variant, with a
//! liquid blue→orange gradient on the title hero. So a converted deck-flyover stays
//! a true template — retype the copy, recolor the brand, swap the layout.
//!
//! Backend: the liquid/feature gradients are GPU-only, so the host routes this to
//! Vello; text + transforms degrade cleanly.

import type { ReactElement } from 'react'
import {
  Camera,
  Easing,
  type EasingFn,
  Group,
  Image,
  Rect,
  Text,
  fbmGradient,
  interpolate,
  linearGradient,
  radialGradient,
  useCurrentFrame,
  useVideoConfig,
} from '@onda-engine/react'
import type { TextStyleProps } from '../text-style.js'
import { type TimeInput, framesOf } from '../time.js'
import { useTheme } from '../theme.js'

export type DeckSlideKind =
  | 'title'
  | 'features'
  | 'bullets'
  | 'agenda'
  | 'quote'
  | 'stats'
  | 'contact'
  | 'cover'

export interface DeckFeature {
  title: string
  body?: string
}
export interface DeckStat {
  value: string
  label?: string
}

/** One presentation slide on the board. */
export interface DeckSlide {
  /** Slide layout. */
  kind?: DeckSlideKind
  /** Render dark (navy) instead of light/white. (title + contact default dark.) */
  dark?: boolean
  eyebrow?: string
  title?: string
  subtitle?: string
  tag?: string
  body?: string
  label?: string
  bullets?: string[]
  items?: DeckFeature[]
  stats?: DeckStat[]
  /** Background image URL — fills the slide (replacing the gradient); a scrim keeps text legible. */
  image?: string
  colSpan?: number
  rowSpan?: number
}

export interface DeckFlyoverProps extends TextStyleProps {
  slides?: DeckSlide[]
  columns?: number
  gap?: number
  width?: number
  rowHeight?: number
  padding?: number
  heroIndex?: number
  /** Slide indices the camera tours, in order (e.g. `[4, 7, 10]`). Falls back to `[heroIndex]`. */
  tour?: number[]
  brandName?: string
  pushZoom?: number
  boardZoom?: number
  driftX?: number
  driftY?: number
  establishFrames?: TimeInput
  punchFrames?: TimeInput
  holdFrames?: TimeInput
  /** Frames of each fly-over between tour stops. */
  moveFrames?: TimeInput
  pullFrames?: TimeInput
  panFrames?: TimeInput
  accentColor?: string
}

type Cell = { x: number; y: number; w: number; h: number; index: number }

const AVG_CHAR_W = 0.53

/** Greedy word-wrap into lines fitting `maxWidth` at `fontSize` (estimate). */
function wrap(textValue: string, maxWidth: number, fontSize: number): string[] {
  const out: string[] = []
  for (const para of textValue.split('\n')) {
    const words = para.split(/\s+/).filter((w) => w.length > 0)
    const maxChars = Math.max(1, Math.floor(maxWidth / (fontSize * AVG_CHAR_W)))
    let line = ''
    for (const w of words) {
      const cand = line.length === 0 ? w : `${line} ${w}`
      if (cand.length <= maxChars || line.length === 0) line = cand
      else {
        out.push(line)
        line = w
      }
    }
    if (line.length > 0) out.push(line)
  }
  return out
}

/** Eased interpolate over one frame segment, clamped at both ends. */
function seg(frame: number, f0: number, f1: number, v0: number, v1: number, easing: EasingFn) {
  return interpolate(frame, [f0, f1], [v0, v1], {
    easing,
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
}

type Pal = {
  bg: string
  ink: string
  dim: string
  line: string
  card: string
  cardInk: string
  cardDim: string
}
const LIGHT: Pal = {
  bg: '#f4f5f8',
  ink: '#101a2e',
  dim: '#5b667d',
  line: '#e3e5ec',
  card: '#0f2147',
  cardInk: '#ffffff',
  cardDim: '#b3bfdc',
}
const DARK: Pal = {
  bg: '#0e0b1a',
  ink: '#f4f1fb',
  dim: '#a99fc0',
  line: '#2a2342',
  card: '#1b1530',
  cardInk: '#ffffff',
  cardDim: '#b8aed4',
}

export function DeckFlyover({
  slides = [],
  columns = 3,
  gap = 40,
  width = 2880,
  rowHeight,
  padding = 54,
  heroIndex = 4,
  tour,
  brandName = 'Acme',
  pushZoom,
  boardZoom,
  establishFrames,
  punchFrames,
  holdFrames,
  moveFrames,
  pullFrames,
  panFrames,
  fontFamily: fontFamilyProp,
  accentColor,
}: DeckFlyoverProps) {
  const frame = useCurrentFrame()
  const { width: canvasW, height: canvasH, fps } = useVideoConfig()
  const theme = useTheme()

  const accent = accentColor ?? '#7c3aed'
  const headingFamily = fontFamilyProp ?? theme.headingFamily ?? theme.fontFamily
  const bodyFamily = fontFamilyProp ?? theme.fontFamily

  // ── Layout: ROWS of uniform slides; each row an infinite horizontal marquee.
  // Slides fill rows left-to-right (`columns` per row). The hero's row is HELD
  // still so the punch-in lands readable; the other rows scroll sideways and
  // wrap, so the deck reads as an endless carousel while the camera works.
  const cols = Math.max(1, Math.round(columns))
  const colW = (width - (cols - 1) * gap) / cols
  const rowH = rowHeight ?? Math.round((colW * 9) / 16)
  const step = colW + gap
  const rowCount = Math.max(1, Math.ceil(slides.length / cols))
  const rowWidth = cols * step // one full cycle of a row before it repeats
  const gridH = rowCount * rowH + (rowCount - 1) * gap

  const boardCx = rowWidth / 2
  const boardCy = gridH / 2

  // Carousel: every row scrolls + wraps; adjacent rows alternate direction.
  const ROW_SPEED = 2.6
  const dir = (r: number): number => (r % 2 === 0 ? -1 : 1)

  const zoomIn = pushZoom ?? Math.min((canvasW * 0.9) / colW, (canvasH * 0.9) / rowH)
  const fitZoom = boardZoom ?? Math.min(canvasW / (rowWidth + gap * 2), canvasH / (gridH + gap))

  // The slides the camera stops on — a short guided tour (falls back to the hero).
  const stops =
    Array.isArray(tour) && tour.length > 0
      ? tour.filter((i) => i >= 0 && i < slides.length)
      : [heroIndex]

  // Phase schedule: establish(wide) → [fly → hold] per stop → pull(wide) → settle.
  // The carousel FLOWS in every phase EXCEPT the holds (frozen), so each visited
  // slide is readable; we frame it at its scrolled-and-frozen position.
  const dEst = framesOf(establishFrames, fps, 20)
  const dPunch = framesOf(punchFrames, fps, 16)
  const dHold = framesOf(holdFrames, fps, 40)
  const dMove = framesOf(moveFrames, fps, 28)
  const dPull = framesOf(pullFrames, fps, 34)
  const dSettle = framesOf(panFrames, fps, 26)

  type Phase = { start: number; end: number; flowing: boolean }
  const phases: Phase[] = []
  let cur = 0
  const addPhase = (durationFrames: number, flowing: boolean) => {
    phases.push({ start: cur, end: cur + durationFrames, flowing })
    cur += durationFrames
  }
  // Flowing frames elapsed up to `f` (holds are frozen) — drives the carousel.
  const flowAt = (f: number): number => {
    let acc = 0
    for (const p of phases) {
      if (f <= p.start) break
      if (p.flowing) acc += Math.min(f, p.end) - p.start
    }
    return acc
  }
  const rowShift = (r: number): number => dir(r) * ROW_SPEED * flowAt(frame)
  // A slide's framed world center at frame `f` (its frozen position during a hold).
  const slideFocus = (s: number, f: number): { x: number; y: number } => {
    const r = Math.floor(s / cols)
    const c = s % cols
    return {
      x: c * step + colW / 2 + dir(r) * ROW_SPEED * flowAt(f),
      y: r * (rowH + gap) + rowH / 2,
    }
  }

  // Build the phase schedule AND the camera keyframes in one time-ordered pass
  // (locals only — no array back-reads). `cur` is the running end-time.
  type KF = { t: number; x: number; y: number; z: number; ease: EasingFn }
  const kf: KF[] = [{ t: 0, x: boardCx, y: boardCy, z: fitZoom, ease: Easing.linear }]
  addPhase(dEst, true)
  kf.push({ t: cur, x: boardCx, y: boardCy, z: fitZoom, ease: Easing.easeInOutCubic })
  let prevX = boardCx
  let prevY = boardCy
  for (let i = 0; i < stops.length; i++) {
    const s = stops[i]
    if (s === undefined) continue
    const flyStart = cur
    addPhase(i === 0 ? dPunch : dMove, true)
    const hs = cur
    const f = slideFocus(s, hs)
    if (i > 0) {
      // Pull back a touch mid-flight, then push into the next stop (a sense of travel).
      kf.push({
        t: flyStart + (hs - flyStart) / 2,
        x: (prevX + f.x) / 2,
        y: (prevY + f.y) / 2,
        z: Math.max(fitZoom * 1.2, zoomIn * 0.55),
        ease: Easing.easeInOutCubic,
      })
    }
    kf.push({ t: hs, x: f.x, y: f.y, z: zoomIn, ease: Easing.easeInOutCubic })
    addPhase(dHold, false)
    kf.push({ t: cur, x: f.x, y: f.y, z: zoomIn * 1.03, ease: Easing.easeOutCubic })
    prevX = f.x
    prevY = f.y
  }
  addPhase(dPull, true)
  kf.push({ t: cur, x: boardCx, y: boardCy, z: fitZoom, ease: Easing.easeInOutCubic })
  addPhase(dSettle, true)
  // Hold the board centered + snug at the end (no vertical drift → no white gutter);
  // the carousel keeps the frame alive.
  kf.push({ t: cur, x: boardCx, y: boardCy, z: fitZoom, ease: Easing.smoothStep })

  let focusX = boardCx
  let focusY = boardCy
  let zoom = fitZoom
  for (let i = 1; i < kf.length; i++) {
    const a = kf[i - 1]
    const b = kf[i]
    if (!a || !b) continue
    if (frame <= b.t || i === kf.length - 1) {
      focusX = seg(frame, a.t, b.t, a.x, b.x, b.ease)
      focusY = seg(frame, a.t, b.t, a.y, b.y, b.ease)
      zoom = seg(frame, a.t, b.t, a.z, b.z, b.ease)
      if (frame <= b.t) break
    }
  }

  // Gentle whole-board fade-in at the open.
  const intro = interpolate(frame, [0, 8], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })

  const t = frame / fps

  // ── Slide chrome (logo lockup + footer) ─────────────────────────────────
  const chrome = (cell: Cell, pal: Pal, page: number): ReactElement[] => [
    <Group key="logo" x={padding} y={padding}>
      <Rect width={26} height={26} cornerRadius={7} fill={accent} />
      <Text
        x={36}
        y={1}
        fontSize={22}
        color={pal.ink}
        fontFamily={headingFamily}
        fontWeight={700}
        letterSpacing={0.2}
      >
        {brandName}
      </Text>
    </Group>,
    <Text
      key="page"
      x={cell.w - padding - 34}
      y={cell.h - padding - 16}
      fontSize={15}
      color={pal.dim}
      fontFamily={bodyFamily}
      fontWeight={500}
      letterSpacing={1}
    >
      {String(page).padStart(2, '0')}
    </Text>,
  ]

  // ── Per-kind slide content ──────────────────────────────────────────────
  function renderTitle(cell: Cell, slide: DeckSlide): ReactElement {
    const titleSize = 58
    const titleLines = wrap(slide.title ?? '', cell.w * 0.52, titleSize)
    const nodes: ReactElement[] = []
    // Left navy scrim over the liquid wave so the headline stays legible.
    nodes.push(
      <Rect
        key="scrim"
        width={cell.w}
        height={cell.h}
        cornerRadius={theme.radius}
        gradient={linearGradient(
          [0, 0],
          [cell.w, 0],
          [
            { offset: 0, color: '#0e0b1a' },
            { offset: 0.42, color: '#0e0b1aee' },
            { offset: 0.66, color: '#0e0b1a00' },
            { offset: 1, color: '#0e0b1a00' },
          ],
        )}
      />,
    )
    let y = cell.h / 2 - (titleLines.length * titleSize * 1.05) / 2 - 24
    if (slide.eyebrow) {
      nodes.push(
        <Text
          key="eyebrow"
          x={padding}
          y={y - 40}
          fontSize={18}
          color="#c4b5fd"
          fontFamily={bodyFamily}
          fontWeight={700}
          letterSpacing={3}
        >
          {slide.eyebrow.toUpperCase()}
        </Text>,
      )
    }
    titleLines.forEach((line, i) => {
      nodes.push(
        <Text
          key={`t${i}`}
          x={padding}
          y={y}
          fontSize={titleSize}
          color="#ffffff"
          fontFamily={headingFamily}
          fontWeight={700}
        >
          {line}
        </Text>,
      )
      y += Math.round(titleSize * 1.05)
    })
    if (slide.subtitle) {
      y += 18
      wrap(slide.subtitle, cell.w * 0.46, 20).forEach((line, i) => {
        nodes.push(
          <Text
            key={`s${i}`}
            x={padding}
            y={y}
            fontSize={20}
            color="#cfc6ea"
            fontFamily={bodyFamily}
            fontWeight={400}
          >
            {line}
          </Text>,
        )
        y += 28
      })
    }
    if (slide.tag) {
      nodes.push(
        <Text
          key="tag"
          x={cell.w - padding - slide.tag.length * 8}
          y={cell.h / 2 - 8}
          fontSize={15}
          color="#e7e0f5"
          fontFamily={bodyFamily}
          fontWeight={500}
        >
          {slide.tag}
        </Text>,
      )
    }
    return <Group>{nodes}</Group>
  }

  function renderFeatures(cell: Cell, slide: DeckSlide, pal: Pal): ReactElement {
    const nodes: ReactElement[] = []
    const titleSize = 38
    let y = padding + 64
    wrap(slide.title ?? '', cell.w - padding * 2, titleSize).forEach((line, i) => {
      nodes.push(
        <Text
          key={`t${i}`}
          x={padding}
          y={y}
          fontSize={titleSize}
          color={pal.ink}
          fontFamily={headingFamily}
          fontWeight={700}
        >
          {line}
        </Text>,
      )
      y += Math.round(titleSize * 1.08)
    })
    if (slide.subtitle) {
      y += 6
      wrap(slide.subtitle, cell.w - padding * 2, 19).forEach((line, i) => {
        nodes.push(
          <Text key={`s${i}`} x={padding} y={y} fontSize={19} color={pal.dim} fontFamily={bodyFamily}>
            {line}
          </Text>,
        )
        y += 26
      })
    }
    const items = (slide.items ?? []).slice(0, 6)
    const gridTop = y + 22
    const cgap = 18
    const cardW = (cell.w - padding * 2 - cgap) / 2
    const rowsAvail = Math.ceil(items.length / 2)
    const cardH = Math.max(80, (cell.h - gridTop - padding - (rowsAvail - 1) * cgap) / rowsAvail)
    items.forEach((it, i) => {
      const cx = padding + (i % 2) * (cardW + cgap)
      const cy = gridTop + Math.floor(i / 2) * (cardH + cgap)
      nodes.push(
        <Group key={`c${i}`} x={cx} y={cy}>
          <Rect
            width={cardW}
            height={cardH}
            cornerRadius={14}
            gradient={linearGradient(
              [0, 0],
              [cardW, cardH],
              [
                { offset: 0, color: '#2a1259' },
                { offset: 1, color: accent },
              ],
            )}
          />
          <Rect x={22} y={22} width={20} height={20} cornerRadius={6} fill="#ffffff" opacity={0.9} />
          <Text
            x={22}
            y={52}
            fontSize={21}
            color="#ffffff"
            fontFamily={headingFamily}
            fontWeight={700}
          >
            {it.title}
          </Text>
          {it.body
            ? wrap(it.body, cardW - 44, 15)
                .slice(0, 2)
                .map((line, li) => (
                  <Text
                    key={li}
                    x={22}
                    y={84 + li * 20}
                    fontSize={15}
                    color="#c2cdea"
                    fontFamily={bodyFamily}
                  >
                    {line}
                  </Text>
                ))
            : null}
        </Group>,
      )
    })
    return <Group>{nodes}</Group>
  }

  function renderBullets(cell: Cell, slide: DeckSlide, pal: Pal): ReactElement {
    const nodes: ReactElement[] = []
    const titleSize = 40
    let y = padding + 60
    wrap(slide.title ?? '', cell.w - padding * 2, titleSize).forEach((line, i) => {
      nodes.push(
        <Text
          key={`t${i}`}
          x={padding}
          y={y}
          fontSize={titleSize}
          color={pal.ink}
          fontFamily={headingFamily}
          fontWeight={700}
        >
          {line}
        </Text>,
      )
      y += Math.round(titleSize * 1.06)
    })
    y += 24
    const rows = (slide.bullets ?? []).slice(0, 6)
    rows.forEach((b, i) => {
      nodes.push(
        <Group key={`b${i}`} y={y}>
          <Rect x={padding} y={6} width={22} height={22} cornerRadius={11} fill={accent} />
          <Rect x={padding + 6} y={15} width={10} height={4} cornerRadius={2} fill="#ffffff" />
          {wrap(b, cell.w - padding * 2 - 44, 21)
            .slice(0, 2)
            .map((line, li) => (
              <Text
                key={li}
                x={padding + 40}
                y={li * 26}
                fontSize={21}
                color={pal.ink}
                fontFamily={bodyFamily}
                fontWeight={li === 0 ? 500 : 400}
              >
                {line}
              </Text>
            ))}
        </Group>,
      )
      y += 56
    })
    return <Group>{nodes}</Group>
  }

  function renderAgenda(cell: Cell, slide: DeckSlide, pal: Pal): ReactElement {
    const nodes: ReactElement[] = []
    nodes.push(
      <Text
        key="t"
        x={padding}
        y={padding + 60}
        fontSize={42}
        color={pal.ink}
        fontFamily={headingFamily}
        fontWeight={700}
      >
        {slide.title ?? 'Index'}
      </Text>,
    )
    const items = (slide.bullets ?? []).slice(0, 6)
    let y = padding + 132
    const rowH2 = Math.min(56, (cell.h - y - padding) / Math.max(1, items.length))
    items.forEach((it, i) => {
      nodes.push(
        <Group key={`a${i}`} y={y}>
          <Text
            x={padding}
            y={0}
            fontSize={20}
            color={accent}
            fontFamily={headingFamily}
            fontWeight={700}
            letterSpacing={1}
          >
            {String(i + 1).padStart(2, '0')}
          </Text>
          <Text x={padding + 64} y={0} fontSize={22} color={pal.ink} fontFamily={bodyFamily} fontWeight={500}>
            {it}
          </Text>
          <Rect x={padding} y={rowH2 - 12} width={cell.w - padding * 2} height={1} fill={pal.line} />
        </Group>,
      )
      y += rowH2
    })
    return <Group>{nodes}</Group>
  }

  function renderQuote(cell: Cell, slide: DeckSlide, pal: Pal): ReactElement {
    const nodes: ReactElement[] = []
    const qSize = 36
    nodes.push(
      <Text
        key="mark"
        x={padding}
        y={padding + 30}
        fontSize={90}
        color={accent}
        fontFamily={headingFamily}
        fontWeight={800}
      >
        {'“'}
      </Text>,
    )
    let y = padding + 116
    wrap(slide.title ?? slide.body ?? '', cell.w - padding * 2, qSize).forEach((line, i) => {
      nodes.push(
        <Text
          key={`q${i}`}
          x={padding}
          y={y}
          fontSize={qSize}
          color={pal.ink}
          fontFamily={headingFamily}
          fontWeight={500}
        >
          {line}
        </Text>,
      )
      y += Math.round(qSize * 1.2)
    })
    if (slide.label) {
      nodes.push(
        <Text
          key="attr"
          x={padding}
          y={cell.h - padding - 28}
          fontSize={19}
          color={pal.dim}
          fontFamily={bodyFamily}
          fontWeight={600}
        >
          {slide.label}
        </Text>,
      )
    }
    return <Group>{nodes}</Group>
  }

  function renderStats(cell: Cell, slide: DeckSlide, pal: Pal): ReactElement {
    const nodes: ReactElement[] = []
    if (slide.title) {
      nodes.push(
        <Text
          key="t"
          x={padding}
          y={padding + 56}
          fontSize={38}
          color={pal.ink}
          fontFamily={headingFamily}
          fontWeight={700}
        >
          {slide.title}
        </Text>,
      )
    }
    const stats = (slide.stats ?? []).slice(0, 3)
    const colW2 = (cell.w - padding * 2) / Math.max(1, stats.length)
    const baseY = cell.h - padding - 96
    stats.forEach((s, i) => {
      const sx = padding + i * colW2
      nodes.push(
        <Group key={`s${i}`} x={sx} y={baseY}>
          <Text x={0} y={0} fontSize={82} color={accent} fontFamily={headingFamily} fontWeight={800}>
            {s.value}
          </Text>
          {s.label ? (
            <Text x={2} y={92} fontSize={19} color={pal.dim} fontFamily={bodyFamily} fontWeight={500}>
              {s.label}
            </Text>
          ) : null}
        </Group>,
      )
    })
    return <Group>{nodes}</Group>
  }

  function renderContact(cell: Cell, slide: DeckSlide): ReactElement {
    const nodes: ReactElement[] = []
    // Radial violet→warm glow in the upper-right (over the dark bg).
    nodes.push(
      <Rect
        key="glow"
        width={cell.w}
        height={cell.h}
        cornerRadius={theme.radius}
        gradient={radialGradient([cell.w * 0.74, cell.h * 0.3], cell.w * 0.72, [
          { offset: 0, color: '#7c3aedaa' },
          { offset: 0.42, color: '#fb651433' },
          { offset: 0.7, color: '#3b1d6e44' },
          { offset: 1, color: '#0e0b1a00' },
        ])}
      />,
    )
    // Bottom-anchored lockup — measure the whole block, then place from the
    // bottom up so the body never collides with the CTA (the prior bug).
    const titleSize = 56
    const titleLH = Math.round(titleSize * 1.05)
    const bodyLH = 28
    const ctaH = 50
    const gapTitleBody = 22
    const gapBodyCta = 28
    const titleLines = wrap(slide.title ?? '', cell.w - padding * 2, titleSize)
    const bodyLines = slide.body ? wrap(slide.body, cell.w * 0.64, 21) : []
    const hasCta = Boolean(slide.label)
    const blockH =
      titleLines.length * titleLH +
      (bodyLines.length > 0 ? gapTitleBody + bodyLines.length * bodyLH : 0) +
      (hasCta ? gapBodyCta + ctaH : 0)
    let y = cell.h - padding - blockH
    titleLines.forEach((line, i) => {
      nodes.push(
        <Text
          key={`t${i}`}
          x={padding}
          y={y}
          fontSize={titleSize}
          color="#ffffff"
          fontFamily={headingFamily}
          fontWeight={700}
        >
          {line}
        </Text>,
      )
      y += titleLH
    })
    if (bodyLines.length > 0) {
      y += gapTitleBody
      bodyLines.forEach((line, i) => {
        nodes.push(
          <Text key={`b${i}`} x={padding} y={y} fontSize={21} color="#cfc6ea" fontFamily={bodyFamily}>
            {line}
          </Text>,
        )
        y += bodyLH
      })
    }
    if (slide.label) {
      const pillW = slide.label.length * 13 + 56
      y += gapBodyCta
      nodes.push(
        <Group key="cta" x={padding} y={y}>
          <Rect width={pillW} height={ctaH} cornerRadius={ctaH / 2} fill={accent} />
          <Text x={28} y={13} fontSize={20} color="#ffffff" fontFamily={bodyFamily} fontWeight={600}>
            {slide.label}
          </Text>
        </Group>,
      )
    }
    return <Group>{nodes}</Group>
  }

  // A pure-image slide — the photo fills it (rendered by the base), plus an
  // optional caption (title + label) over a bottom scrim. No logo/page chrome.
  function renderCover(cell: Cell, slide: DeckSlide): ReactElement {
    if (!slide.title && !slide.label) return <Group />
    const nodes: ReactElement[] = []
    const scrimH = Math.round(cell.h * 0.44)
    nodes.push(
      <Rect
        key="scrim"
        y={cell.h - scrimH}
        width={cell.w}
        height={scrimH}
        gradient={linearGradient(
          [0, 0],
          [0, scrimH],
          [
            { offset: 0, color: '#0b0a1600' },
            { offset: 1, color: '#0b0a16e6' },
          ],
        )}
      />,
    )
    let y = cell.h - padding - (slide.label ? 30 : 0) - 38
    if (slide.title) {
      nodes.push(
        <Text
          key="t"
          x={padding}
          y={y}
          fontSize={34}
          color="#ffffff"
          fontFamily={headingFamily}
          fontWeight={700}
        >
          {slide.title}
        </Text>,
      )
      y += 44
    }
    if (slide.label) {
      nodes.push(
        <Text
          key="l"
          x={padding}
          y={y}
          fontSize={18}
          color="#d8d8e6"
          fontFamily={bodyFamily}
          fontWeight={500}
        >
          {slide.label}
        </Text>,
      )
    }
    return (
      <Group clip={{ type: 'rect', width: cell.w, height: cell.h, cornerRadius: theme.radius }}>
        {nodes}
      </Group>
    )
  }

  const renderSlide = (cell: Cell, slideIndex: number, keyId: string): ReactElement | null => {
    const slide = slides[slideIndex]
    if (!slide) return null
    const kind: DeckSlideKind = slide.kind ?? 'features'
    const img =
      typeof slide.image === 'string' && slide.image.length > 0 ? slide.image : null
    // A photo background reads as a dark slide (light text over a scrim), regardless of `dark`.
    const isDark = img !== null || (slide.dark ?? (kind === 'title' || kind === 'contact'))
    const pal = isDark ? DARK : LIGHT

    return (
      <Group key={keyId} x={cell.x} y={cell.y}>
        {/* Slide base: a swapped-in photo (clipped to the slide + scrim) wins; else the
            title's liquid wave; else a flat surface. */}
        {img ? (
          <Group clip={{ type: 'rect', width: cell.w, height: cell.h, cornerRadius: theme.radius }}>
            <Image src={img} width={cell.w} height={cell.h} fit="cover" />
            {/* Text slides dim the photo for legibility; a pure `cover` shows it full. */}
            {kind !== 'cover' ? (
              <Rect width={cell.w} height={cell.h} fill="#0b0a16" opacity={0.5} />
            ) : null}
          </Group>
        ) : kind === 'title' ? (
          <Rect
            width={cell.w}
            height={cell.h}
            cornerRadius={theme.radius}
            gradient={fbmGradient(
              [
                { offset: 0, color: '#a78bfa' },
                { offset: 0.28, color: '#7c3aed' },
                { offset: 0.52, color: '#9d3bd4' },
                { offset: 0.74, color: '#fb6514' },
                { offset: 0.9, color: '#f97316' },
                { offset: 1, color: '#0e0b1a' },
              ],
              { scale: 0.7, warp: 0.5, time: t * 0.16 },
            )}
          />
        ) : (
          <Rect
            width={cell.w}
            height={cell.h}
            cornerRadius={theme.radius}
            fill={pal.bg}
            stroke={pal.line}
            strokeWidth={1}
          />
        )}

        {kind === 'title' ? renderTitle(cell, slide) : null}
        {kind === 'features' ? renderFeatures(cell, slide, pal) : null}
        {kind === 'bullets' ? renderBullets(cell, slide, pal) : null}
        {kind === 'agenda' ? renderAgenda(cell, slide, pal) : null}
        {kind === 'quote' ? renderQuote(cell, slide, pal) : null}
        {kind === 'stats' ? renderStats(cell, slide, pal) : null}
        {kind === 'contact' ? renderContact(cell, slide) : null}
        {kind === 'cover' ? renderCover(cell, slide) : null}

        {/* A pure-image `cover` slide stays clean — no logo/page chrome. */}
        {kind !== 'cover' ? chrome(cell, pal, cell.index + 1) : null}
      </Group>
    )
  }

  // Tile each row's slides across the visible window (with wrap copies) so the
  // marquee is seamless; cull anything outside the current camera frustum.
  const halfW = canvasW / (2 * zoom) + colW
  const halfH = canvasH / (2 * zoom) + rowH
  const instances: ReactElement[] = []
  for (let r = 0; r < rowCount; r++) {
    const y = r * (rowH + gap)
    if (y + rowH < focusY - halfH || y > focusY + halfH) continue
    const shift = rowShift(r)
    const mod = ((shift % rowWidth) + rowWidth) % rowWidth
    for (let k = -1; k <= 2; k++) {
      for (let j = 0; j < cols; j++) {
        const slideIndex = r * cols + j
        if (slideIndex >= slides.length) continue
        const x = j * step + mod + k * rowWidth
        if (x + colW < focusX - halfW || x > focusX + halfW) continue
        const el = renderSlide({ x, y, w: colW, h: rowH, index: slideIndex }, slideIndex, `${r}-${j}-${k}`)
        if (el) instances.push(el)
      }
    }
  }

  return (
    <Group opacity={intro}>
      <Camera focusX={focusX} focusY={focusY} zoom={zoom}>
        {instances}
      </Camera>
    </Group>
  )
}
