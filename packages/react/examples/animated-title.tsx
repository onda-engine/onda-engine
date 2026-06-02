/** @jsxRuntime automatic @jsxImportSource react */
//! Spike: a kinetic per-glyph TITLE REVEAL authored in @onda/react and rendered
//! by the ONDA engine (no Chromium). Proves the library-authoring recipe for a
//! real *motion-graphics* component using only existing primitives — and it's
//! exactly where ONDA out-classes Remotion: a per-glyph reveal is N DOM nodes
//! through Chromium layout/paint/screenshot in Remotion, vs N glyph runs on one
//! GPU pass here.
//!
//! Run:
//!   pnpm --filter @onda/react exec tsx examples/animated-title.tsx frames.json
//! then encode with the engine (no browser anywhere):
//!   cargo run -p onda-cli -- export-frames frames.json title.mp4 --backend vello

import { writeFileSync } from 'node:fs'
import {
  Composition,
  Easing,
  Group,
  Rect,
  Text,
  clipRect,
  interpolate,
  linearGradient,
  renderFramesJSON,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from '@onda/react'

const W = 1280
const H = 480
const clampEase = { easing: Easing.easeOutCubic, extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const

/** Each glyph fades + rises + springs (center-anchored) in on a stagger, with a
 *  small settling rotation — the per-glyph motion Remotion can only fake. */
function AnimatedTitle({ text, cx, baseline, fontSize, stagger = 5 }: {
  text: string
  cx: number
  baseline: number
  fontSize: number
  stagger?: number
}) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const advance = fontSize * 0.64 // IBM Plex Sans caps ≈ this; uniform reads clean for all-caps
  const startX = cx - (text.length * advance) / 2

  return (
    <Group>
      {[...text].map((ch, i) => {
        const t = frame - i * stagger
        const opacity = interpolate(t, [0, 12], [0, 1], clampEase)
        const rise = interpolate(t, [0, 16], [54, 0], clampEase)
        const scale = interpolate(spring({ frame: t, fps, config: { stiffness: 210, damping: 13 } }), [0, 1], [0.6, 1])
        const rot = interpolate(t, [0, 18], [-7, 0], clampEase)
        // Anchor scale/rotation about the glyph's approx center: place the Group
        // at the slot center, draw the Text offset back by half a cell.
        const slotCenterX = startX + i * advance + advance / 2
        return (
          <Group key={i} x={slotCenterX} y={baseline + rise} scaleX={scale} scaleY={scale} rotation={rot} opacity={opacity}>
            <Text x={-advance / 2} y={-fontSize * 0.74} fontSize={fontSize} color="#f2f2f4" fontFamily="IBM Plex Sans" fontWeight={700}>
              {ch}
            </Text>
          </Group>
        )
      })}
    </Group>
  )
}

/** A gradient underline that wipes in (clip mask grows) after the title lands. */
function Underline({ cx, y, width, delay }: { cx: number; y: number; width: number; delay: number }) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const grow = spring({ frame: frame - delay, fps, config: { stiffness: 90, damping: 18 } })
  const w = interpolate(grow, [0, 1], [0, width])
  return (
    <Group x={cx - width / 2} y={y} clip={clipRect(w, 12)}>
      <Rect width={width} height={12} cornerRadius={6} gradient={linearGradient([0, 0], [width, 0], [
        { offset: 0, color: '#e89aac' },
        { offset: 1, color: '#d96b82' },
      ])} />
    </Group>
  )
}

/** A centered tagline that fades + rises in. */
function Tagline({ text, cx, y, fontSize, delay }: { text: string; cx: number; y: number; fontSize: number; delay: number }) {
  const frame = useCurrentFrame()
  const t = frame - delay
  const opacity = interpolate(t, [0, 16], [0, 1], clampEase)
  const rise = interpolate(t, [0, 16], [16, 0], clampEase)
  const x = cx - (text.length * fontSize * 0.5) / 2
  return (
    <Text x={x} y={y + rise} fontSize={fontSize} color="#8e8e98" fontFamily="IBM Plex Sans" opacity={opacity}>
      {text}
    </Text>
  )
}

const movie = (
  <Composition width={W} height={H} fps={30} durationInFrames={90}>
    <Rect width={W} height={H} fill="#0e0e12" />
    <AnimatedTitle text="ONDA" cx={W / 2} baseline={250} fontSize={170} stagger={6} />
    <Underline cx={W / 2} y={278} width={430} delay={28} />
    <Tagline text="motion, alive." cx={W / 2} y={330} fontSize={40} delay={36} />
  </Composition>
)

const out = process.argv[2] ?? 'title-frames.json'
writeFileSync(out, renderFramesJSON(movie))
console.log(`wrote ${out}`)
