import { Player } from 'onda-engine/player'
import {
  Composition,
  Ellipse,
  Group,
  Path,
  Rect,
  Series,
  Text,
  clipRect,
  interpolate,
  linearGradient,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'onda-engine/react'
import initCpu, { OndaEngine } from 'onda-engine/wasm'
import initVello, { VelloEngine } from 'onda-engine/wasm-vello'
import velloWasmUrl from 'onda-engine/wasm-vello/pkg/onda_wasm_vello_bg.wasm?url'
import cpuWasmUrl from 'onda-engine/wasm/pkg/onda_wasm_bg.wasm?url'
import { type ReactElement, useEffect, useMemo, useState } from 'react'

const W = 1280
const H = 480

/** The bundled font families, selectable live in the playground. Open Sans
 *  ships Regular only; IBM Plex Sans ships Regular/Bold/Italic, so weight and
 *  italic only visibly change with it. Load more via `onda render --font` (CLI)
 *  or `@onda-engine/react`'s font props. */
const FAMILIES = ['IBM Plex Sans', 'Open Sans'] as const

/** The font the demo's text renders in — driven by the picker. */
interface FontSettings {
  family: string
  weight: number
  italic: boolean
}

/** A title that springs up and fades in (frame-driven, deterministic). Renders
 *  in the picked font. */
function Title({
  label,
  font,
  color = '#f2f2f4',
}: { label: string; font: FontSettings; color?: string }): ReactElement {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const rise = spring({ frame, fps, config: { damping: 13, stiffness: 120 } })
  const opacity = interpolate(frame, [0, 14], [0, 1], { extrapolateRight: 'clamp' })
  const y = interpolate(rise, [0, 1], [210, 168])
  return (
    <Text
      x={96}
      y={y}
      fontSize={104}
      color={color}
      opacity={opacity}
      fontFamily={font.family}
      fontWeight={font.weight}
      italic={font.italic}
    >
      {label}
    </Text>
  )
}

/** A subtitle that fades in and shows the picked family in three styles at once
 *  — Regular, Bold and Italic in a single line — via rich `runs`, which the
 *  engine lays out across the right face per run (multi-font in one Text). */
function Subtitle({ font }: { font: FontSettings }): ReactElement {
  const frame = useCurrentFrame()
  const opacity = interpolate(frame, [12, 30], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  return (
    <Text
      x={96}
      y={352}
      fontSize={30}
      opacity={opacity}
      runs={[
        { text: `${font.family}  ·  `, fontFamily: font.family, color: '#7f8590' },
        { text: 'Regular  ', fontFamily: font.family, fontWeight: 400, color: '#cfd3da' },
        { text: 'Bold  ', fontFamily: font.family, fontWeight: 700, color: '#f2f2f4' },
        { text: 'Italic', fontFamily: font.family, italic: true, color: '#e89aac' },
      ]}
    />
  )
}

/** A gradient underline that wipes in left-to-right via a clip mask. The clip
 *  width is driven by a spring, so the bar "draws" itself on. */
function Underline(): ReactElement {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const grow = spring({ frame, fps, config: { damping: 18, stiffness: 90 } })
  const width = interpolate(grow, [0, 1], [0, 720])
  return (
    <Group x={96} y={300} clip={clipRect(width, 14)}>
      <Rect
        width={720}
        height={14}
        cornerRadius={7}
        gradient={linearGradient(
          [0, 0],
          [720, 0],
          [
            { offset: 0, color: '#e89aac' },
            { offset: 1, color: '#d96b82' },
          ],
        )}
      />
    </Group>
  )
}

/** A vector "wave" drawn from SVG path data (the latest <Path> feature). It
 *  travels across the canvas while fading. Renders on the GPU/Vello backend and
 *  in the Canvas2D preview; the CPU oracle skips arbitrary paths. */
function Wave(): ReactElement {
  const frame = useCurrentFrame()
  const { fps, durationInFrames } = useVideoConfig()
  const drift = spring({ frame, fps, config: { damping: 20, stiffness: 60 } })
  const x = interpolate(drift, [0, 1], [W, W - 540])
  const opacity = interpolate(
    frame,
    [0, 18, durationInFrames - 18, durationInFrames],
    [0, 0.9, 0.9, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  )
  return (
    <Group x={x} y={120} opacity={opacity}>
      <Path d="M0 80 q40 -64 80 0 t80 0 t80 0 t80 0" stroke="#e89aac" strokeWidth={7} />
      <Path
        d="M0 130 q40 -64 80 0 t80 0 t80 0 t80 0"
        stroke="#d96b82"
        strokeWidth={7}
        opacity={0.85}
      />
      <Path
        d="M0 180 q40 -64 80 0 t80 0 t80 0 t80 0"
        stroke="#c8576f"
        strokeWidth={7}
        opacity={0.7}
      />
    </Group>
  )
}

/** A pulsing dot that marks the brand accent (renders pixel-exact on every
 *  backend — a solid ellipse). */
function Pulse(): ReactElement {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const pop = spring({ frame, fps, config: { damping: 8, stiffness: 200 } })
  const s = interpolate(pop, [0, 1], [0, 1])
  return (
    <Group x={96} y={96}>
      <Ellipse
        x={-(28 * s) / 2 + 14}
        y={-(28 * s) / 2 + 14}
        width={28 * s}
        height={28 * s}
        fill="#d96b82"
      />
    </Group>
  )
}

// The demo composition: a dark backdrop, an accent pulse, a vector <Path> wave,
// two spring titles played back-to-back with <Series>, and a gradient underline
// that wipes in through a clip mask — Text + Path + gradient + clip +
// spring/interpolate. The GPU (Vello/WebGPU) engine renders all of it, pixel-
// identical to `onda export`.
function buildDemo(font: FontSettings): ReactElement {
  return (
    <Composition width={W} height={H} fps={30} durationInFrames={150}>
      <Rect width={W} height={H} fill="#0e0e12" />
      <Wave />
      <Pulse />
      <Series>
        <Series.Sequence durationInFrames={75}>
          <Title label="Motion at GPU speed" font={font} />
        </Series.Sequence>
        <Series.Sequence durationInFrames={75}>
          <Title label="No browser." color="#d96b82" font={font} />
        </Series.Sequence>
      </Series>
      <Underline />
      <Subtitle font={font} />
    </Composition>
  )
}

/** The ONDA mark (three rose waves) — inline SVG, per assets/brand. */
function OndaMark(): ReactElement {
  return (
    <svg width="40" height="40" viewBox="0 0 48 48" fill="none" role="img" aria-label="ONDA">
      <defs>
        <linearGradient
          id="onda-grad"
          x1="5"
          y1="14"
          x2="44"
          y2="34"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#e89aac" />
          <stop offset="1" stopColor="#d96b82" />
        </linearGradient>
      </defs>
      <g stroke="url(#onda-grad)" strokeWidth="3.6" strokeLinecap="round" fill="none">
        <path d="M5 17 q6.5 -9 13 0 t13 0 t13 0" />
        <path d="M5 24 q6.5 -9 13 0 t13 0 t13 0" opacity="0.85" />
        <path d="M5 31 q6.5 -9 13 0 t13 0 t13 0" opacity="0.7" />
      </g>
    </svg>
  )
}

const CODE = `import { Composition, Rect, Text, Path,
  linearGradient, clipRect, spring, interpolate,
  useCurrentFrame } from '@onda-engine/react'

const grow = spring({ frame, fps })

<Group clip={clipRect(grow * 720, 14)}>
  <Rect width={720} height={14} cornerRadius={7}
    gradient={linearGradient([0,0],[720,0], [
      { offset: 0, color: '#e89aac' },
      { offset: 1, color: '#d96b82' }])} />
</Group>`

export function App(): ReactElement {
  // Select the renderer on mount: the GPU engine (Vello over WebGPU) when
  // available, else the CPU engine. The Player prefers whichever it's given and
  // falls back to Canvas2D if neither is ready yet.
  const [gpu, setGpu] = useState<VelloEngine | null>(null)
  const [cpu, setCpu] = useState<OndaEngine | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        await initVello(velloWasmUrl)
        const engine = await VelloEngine.create()
        if (!cancelled) setGpu(engine)
      } catch {
        // No WebGPU here — fall back to the CPU engine.
        await initCpu(cpuWasmUrl)
        const engine = new OndaEngine()
        if (!cancelled) setCpu(engine)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // The font the demo's text renders in — driven by the picker below.
  const [family, setFamily] = useState<string>(FAMILIES[0])
  const [weight, setWeight] = useState<number>(700)
  const [italic, setItalic] = useState<boolean>(false)
  const font = useMemo<FontSettings>(() => ({ family, weight, italic }), [family, weight, italic])
  const composition = useMemo(() => buildDemo(font), [font])

  return (
    <main style={styles.main}>
      <header style={styles.header}>
        <OndaMark />
        <span style={styles.wordmark}>ONDA</span>
        <span style={styles.pill}>Player</span>
      </header>

      <h1 style={styles.h1}>
        Motion graphics at GPU speed. <span style={styles.gradientText}>No browser.</span>
      </h1>
      <p style={styles.lede}>
        A real-time preview of a composition authored in{' '}
        <code style={styles.code}>@onda-engine/react</code> — Text, a vector{' '}
        <code style={styles.code}>&lt;Path&gt;</code>, a gradient underline that wipes in through a
        clip mask, all animated with <code style={styles.code}>spring</code> and{' '}
        <code style={styles.code}>interpolate</code> over frames. Rendered live by the GPU engine
        (Vello over WebGPU) — pixel-identical to <code style={styles.code}>onda export</code>, with
        no Chromium. Drag the scrubber or press play.
      </p>

      <div style={styles.fontBar}>
        <span style={styles.fontBarLabel}>Font</span>
        <div style={styles.segGroup}>
          {FAMILIES.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFamily(f)}
              style={family === f ? styles.segActive : styles.seg}
            >
              {f}
            </button>
          ))}
        </div>
        <div style={styles.segGroup}>
          {[
            { label: 'Regular', w: 400 },
            { label: 'Bold', w: 700 },
          ].map(({ label, w }) => (
            <button
              key={w}
              type="button"
              onClick={() => setWeight(w)}
              style={weight === w ? styles.segActive : styles.seg}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setItalic((v) => !v)}
          style={italic ? styles.segActive : styles.seg}
          aria-pressed={italic}
        >
          <span style={{ fontStyle: 'italic' }}>Italic</span>
        </button>
      </div>
      <p style={styles.fontHint}>
        Both families ship with the engine — zero setup, deterministic on any machine. Open Sans is
        Regular-only, so weight &amp; italic show on IBM Plex Sans. Load your own with{' '}
        <code style={styles.code}>onda render --font Brand.ttf</code>.
      </p>

      <section style={styles.card}>
        <Player
          composition={composition}
          gpuEngine={gpu ?? undefined}
          engine={cpu ?? undefined}
          loop
        />
      </section>

      <section style={styles.codeCard}>
        <div style={styles.codeHeader}>composition.tsx</div>
        <pre style={styles.pre}>
          <code style={styles.codeBlock}>{CODE}</code>
        </pre>
      </section>

      <footer style={styles.footer}>
        Source-available · FSL-1.1-Apache-2.0 ·{' '}
        <a style={styles.link} href="https://github.com/onda-engine/onda-engine">
          GitHub
        </a>
      </footer>
    </main>
  )
}

const styles: Record<string, React.CSSProperties> = {
  main: {
    maxWidth: 920,
    margin: '0 auto',
    padding: '64px 24px 96px',
    fontFamily: 'var(--font-body)',
  },
  header: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 40 },
  wordmark: {
    fontFamily: 'var(--font-head)',
    fontWeight: 700,
    fontSize: 22,
    letterSpacing: '0.02em',
  },
  pill: {
    fontFamily: 'var(--font-mono)',
    fontSize: 12,
    color: 'var(--accent)',
    border: '1px solid var(--border)',
    borderRadius: 999,
    padding: '2px 10px',
    background: 'var(--surface)',
  },
  h1: {
    fontFamily: 'var(--font-head)',
    fontWeight: 700,
    fontSize: 'clamp(32px, 5vw, 48px)',
    lineHeight: 1.1,
    letterSpacing: '-0.01em',
    margin: '0 0 16px',
  },
  gradientText: {
    color: 'var(--accent)',
  },
  lede: {
    color: 'var(--text-muted)',
    fontSize: 18,
    maxWidth: '68ch',
    margin: '0 0 32px',
  },
  card: {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 14,
    padding: 24,
    boxShadow: '0 1px 0 rgba(255,255,255,.04) inset, 0 8px 30px rgba(0,0,0,.4)',
  },
  toggle: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    margin: '20px 0 8px',
    fontSize: 14,
    cursor: 'pointer',
  },
  fontBar: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
    margin: '4px 0 10px',
  },
  fontBarLabel: {
    fontFamily: 'var(--font-mono)',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    color: 'var(--text-muted)',
    marginRight: 2,
  },
  segGroup: {
    display: 'inline-flex',
    border: '1px solid var(--border)',
    borderRadius: 10,
    overflow: 'hidden',
    background: 'var(--surface)',
  },
  seg: {
    appearance: 'none',
    border: 'none',
    background: 'transparent',
    color: 'var(--text-muted)',
    font: 'inherit',
    fontSize: 13.5,
    padding: '7px 14px',
    cursor: 'pointer',
  },
  segActive: {
    appearance: 'none',
    border: 'none',
    background: 'var(--accent)',
    color: '#1a1014',
    font: 'inherit',
    fontSize: 13.5,
    fontWeight: 600,
    padding: '7px 14px',
    cursor: 'pointer',
  },
  fontHint: {
    color: 'var(--text-muted)',
    fontSize: 13.5,
    lineHeight: 1.7,
    margin: '0 0 24px',
  },
  muted: { color: 'var(--text-muted)' },
  note: {
    color: 'var(--text-muted)',
    fontSize: 13.5,
    lineHeight: 1.7,
    maxWidth: '74ch',
    margin: '0 0 32px',
  },
  code: {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.875em',
    color: 'var(--text)',
    background: 'var(--surface-2)',
    borderRadius: 6,
    padding: '1px 6px',
  },
  codeCard: {
    background: '#070a11',
    border: '1px solid var(--border)',
    borderRadius: 14,
    overflow: 'hidden',
  },
  codeHeader: {
    fontFamily: 'var(--font-mono)',
    fontSize: 12,
    color: 'var(--text-muted)',
    padding: '10px 16px',
    borderBottom: '1px solid var(--border)',
    background: 'var(--surface)',
  },
  pre: { margin: 0, padding: '16px 20px', overflowX: 'auto' },
  codeBlock: {
    fontFamily: 'var(--font-mono)',
    fontSize: 13,
    lineHeight: 1.7,
    color: '#cdd6e6',
    whiteSpace: 'pre',
  },
  footer: {
    marginTop: 48,
    paddingTop: 24,
    borderTop: '1px solid var(--border)',
    color: 'var(--text-muted)',
    fontSize: 13,
  },
  link: { color: 'var(--accent)', textDecoration: 'none' },
}
