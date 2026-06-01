import { Player } from '@onda/player'
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
} from '@onda/react'
import { OndaEngine } from '@onda/wasm'
import { type ReactElement, useMemo, useState } from 'react'

const W = 1280
const H = 480

/** A title that springs up and fades in (frame-driven, deterministic). */
function Title({ label, color = '#e8edf7' }: { label: string; color?: string }): ReactElement {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const rise = spring({ frame, fps, config: { damping: 13, stiffness: 120 } })
  const opacity = interpolate(frame, [0, 14], [0, 1], { extrapolateRight: 'clamp' })
  const y = interpolate(rise, [0, 1], [210, 168])
  return (
    <Text x={96} y={y} fontSize={104} color={color} opacity={opacity}>
      {label}
    </Text>
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
        gradient={linearGradient([0, 0], [720, 0], [
          { offset: 0, color: '#3b82f6' },
          { offset: 0.5, color: '#22d3ee' },
          { offset: 1, color: '#f25a8c' },
        ])}
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
      <Path
        d="M0 80 q40 -64 80 0 t80 0 t80 0 t80 0"
        stroke="#3b82f6"
        strokeWidth={7}
      />
      <Path
        d="M0 130 q40 -64 80 0 t80 0 t80 0 t80 0"
        stroke="#22d3ee"
        strokeWidth={7}
        opacity={0.8}
      />
      <Path
        d="M0 180 q40 -64 80 0 t80 0 t80 0 t80 0"
        stroke="#f25a8c"
        strokeWidth={7}
        opacity={0.6}
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
      <Ellipse x={-(28 * s) / 2 + 14} y={-(28 * s) / 2 + 14} width={28 * s} height={28 * s} fill="#22d3ee" />
    </Group>
  )
}

// The demo composition: a dark backdrop, an accent pulse, two spring titles
// played back-to-back with <Series>, and a gradient underline that wipes in
// through a clip mask. Uses Text + gradient + clip + spring/interpolate over
// frames — the latest @onda/react surface.
//
// `withPaths` adds a vector <Path> wave. The in-browser WASM engine is the CPU
// reference oracle and predates arbitrary paths, so we include the wave only in
// the Canvas2D-preview view (where it — and the true gradient/clip — render).
// The GPU/Vello backend renders all of it; that's what `onda export --backend
// vello` produces.
function buildDemo(withPaths: boolean): ReactElement {
  return (
    <Composition width={W} height={H} fps={30} durationInFrames={150}>
      <Rect width={W} height={H} fill="#0a0d17" />
      {withPaths && <Wave />}
      <Pulse />
      <Series>
        <Series.Sequence durationInFrames={75}>
          <Title label="Motion at GPU speed" />
        </Series.Sequence>
        <Series.Sequence durationInFrames={75}>
          <Title label="No browser." color="#22d3ee" />
        </Series.Sequence>
      </Series>
      <Underline />
    </Composition>
  )
}

/** The ONDA mark (three blue→cyan waves) — inline SVG, per assets/brand. */
function OndaMark(): ReactElement {
  return (
    <svg width="40" height="40" viewBox="0 0 48 48" fill="none" role="img" aria-label="ONDA">
      <defs>
        <linearGradient id="onda-grad" x1="5" y1="14" x2="44" y2="34" gradientUnits="userSpaceOnUse">
          <stop stopColor="#3b82f6" />
          <stop offset="1" stopColor="#22d3ee" />
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
  useCurrentFrame } from '@onda/react'

const grow = spring({ frame, fps })

<Group clip={clipRect(grow * 720, 14)}>
  <Rect width={720} height={14} cornerRadius={7}
    gradient={linearGradient([0,0],[720,0], [
      { offset: 0, color: '#3b82f6' },
      { offset: 1, color: '#f25a8c' }])} />
</Group>`

export function App(): ReactElement {
  // Construct the real engine once. main.tsx initializes wasm before mount.
  const engine = useMemo(() => new OndaEngine(), [])
  const [useEngine, setUseEngine] = useState(true)

  // The engine view renders an engine-safe scene (no arbitrary paths); the
  // Canvas2D preview adds the vector <Path> wave on top.
  const composition = useMemo(() => buildDemo(!useEngine), [useEngine])

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
        A real-time preview of a composition authored in <code style={styles.code}>@onda/react</code>{' '}
        — Text, a vector <code style={styles.code}>&lt;Path&gt;</code>, a gradient underline that
        wipes in through a clip mask, all animated with <code style={styles.code}>spring</code> and{' '}
        <code style={styles.code}>interpolate</code> over frames. Drag the scrubber or press play.
      </p>

      <section style={styles.card}>
        <Player composition={composition} engine={useEngine ? engine : undefined} loop />
      </section>

      <label style={styles.toggle}>
        <input
          type="checkbox"
          checked={useEngine}
          onChange={(e) => setUseEngine(e.target.checked)}
        />
        <span>
          Render with the WASM engine{' '}
          <span style={styles.muted}>(off = Canvas2D preview, adds the vector &lt;Path&gt; wave)</span>
        </span>
      </label>

      <p style={styles.note}>
        The in-browser <strong>WASM engine</strong> is the real Rust renderer (the CPU reference
        oracle): pixel-identical to <code style={styles.code}>onda render</code> for rects, ellipses
        and text. It is the deterministic correctness oracle, so it intentionally renders flat fills
        — arbitrary <code style={styles.code}>&lt;Path&gt;</code>, true gradients, rounded corners
        and clip masks are the GPU/<strong>Vello</strong> backend's job (
        <code style={styles.code}>onda export --backend vello</code>) and show up in the Canvas2D
        preview here. A WebGPU present path (see{' '}
        <code style={styles.code}>packages/player/WEBGPU.md</code>) would make the in-browser preview
        == the Vello export at real-time speed.
      </p>

      <section style={styles.codeCard}>
        <div style={styles.codeHeader}>composition.tsx</div>
        <pre style={styles.pre}>
          <code style={styles.codeBlock}>{CODE}</code>
        </pre>
      </section>

      <footer style={styles.footer}>
        Open source · MIT / Apache-2.0 ·{' '}
        <a style={styles.link} href="https://github.com/degueba/onda-engine">
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
    color: 'var(--cyan)',
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
    background: 'var(--grad-cool)',
    WebkitBackgroundClip: 'text',
    backgroundClip: 'text',
    color: 'transparent',
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
  link: { color: 'var(--primary)', textDecoration: 'none' },
}
