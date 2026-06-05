import { Player } from '@onda/player'
import {
  AbsoluteFill,
  Composition,
  Ellipse,
  Group,
  Rect,
  Text,
  interpolate,
  useCurrentFrame,
} from '@onda/react'
import velloWasmUrl from '@onda/wasm-vello/pkg/onda_wasm_vello_bg.wasm?url'
import cpuWasmUrl from '@onda/wasm/pkg/onda_wasm_bg.wasm?url'
import {
  type CSSProperties,
  type ReactElement,
  createElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { CodeBlock } from './CodeBlock.js'

// The render-to-texture EFFECTS showcase — blur / bloom / grade / goo are node
// PROPS (not components), so they live here (the way transitions get their own
// page) rather than in the component gallery. Each effect plays live, animated,
// rendered by the real engine (Vello/WebGPU, CPU fallback). Mounted client-only
// so wasm/WebGPU never touches SSR.

const W = 960
const H = 540

const ACCENT = '#e85494'
const INK = '#f4f3f7'

const loop = (f: number, lo: number, hi: number): number =>
  interpolate(f, [0, 45, 90], [lo, hi, lo], { extrapolateRight: 'clamp' })

/** blur — a focus pull: the title resolves soft → sharp and softens again. */
function BlurDemo(): ReactElement {
  const f = useCurrentFrame()
  const blur = interpolate(f, [0, 26, 64, 90], [16, 0, 0, 16], { extrapolateRight: 'clamp' })
  return createElement(
    Group,
    null,
    createElement(Rect, { width: W, height: H, fill: '#0a0d17' }),
    createElement(
      Group,
      { blur },
      createElement(
        AbsoluteFill,
        { justify: 'center', align: 'center' },
        createElement(
          Text,
          { fontSize: 168, color: INK, fontWeight: 700, letterSpacing: -4 },
          'ONDA',
        ),
      ),
    ),
  )
}

/** bloom — a bright accent blooms a soft halo that swells and recedes. */
function BloomDemo(): ReactElement {
  const f = useCurrentFrame()
  const sigma = loop(f, 2, 18)
  return createElement(
    Group,
    null,
    createElement(Rect, { width: W, height: H, fill: '#08080c' }),
    createElement(
      Group,
      { bloom: { sigma, threshold: 0.25, intensity: 1.7 } },
      createElement(
        AbsoluteFill,
        { justify: 'center', align: 'center' },
        createElement(
          Text,
          { fontSize: 168, color: ACCENT, fontWeight: 700, letterSpacing: -4 },
          'ONDA',
        ),
      ),
    ),
  )
}

/** grade — a per-pixel color grade swings the same content cool → warm → cool. */
function GradeDemo(): ReactElement {
  const f = useCurrentFrame()
  const temperature = loop(f, -0.3, 0.3)
  return createElement(
    Group,
    null,
    createElement(Rect, { width: W, height: H, fill: '#14141c' }),
    createElement(
      Group,
      { grade: { temperature, contrast: 1.1, saturation: 0.96 } },
      createElement(Rect, {
        x: 150,
        y: 150,
        width: 280,
        height: 240,
        cornerRadius: 18,
        fill: '#4a90d9',
      }),
      createElement(Rect, {
        x: 530,
        y: 150,
        width: 280,
        height: 240,
        cornerRadius: 18,
        fill: '#e8a04a',
      }),
    ),
  )
}

/** goo — two accent blobs drift together and fuse into one metaball, then part. */
function GooDemo(): ReactElement {
  const f = useCurrentFrame()
  const gap = loop(f, 90, -20)
  return createElement(
    Group,
    null,
    createElement(Rect, { width: W, height: H, fill: '#0a0d17' }),
    createElement(
      Group,
      { goo: { sigma: 13, threshold: 0.5 } },
      createElement(Ellipse, {
        x: W / 2 - 170 - gap,
        y: H / 2 - 90,
        width: 180,
        height: 180,
        fill: ACCENT,
      }),
      createElement(Ellipse, {
        x: W / 2 - 10 + gap,
        y: H / 2 - 75,
        width: 150,
        height: 150,
        fill: ACCENT,
      }),
    ),
  )
}

interface EffectDef {
  name: string
  Demo: () => ReactElement
  blurb: string
  snippet: string
}

const EFFECTS: EffectDef[] = [
  {
    name: 'blur',
    Demo: BlurDemo,
    blurb:
      'A real gaussian blur on any node — depth of field, soft reveals, focus pulls. The subtree is rendered to a texture, blurred, and composited back; deterministic on the CPU reference and identical on the GPU.',
    snippet: ['<Group blur={8}>', '  <Title />', '</Group>'].join('\n'),
  },
  {
    name: 'bloom',
    Demo: BloomDemo,
    blurb:
      'Bright pixels bloom a soft halo — the single biggest “premium” tell. Bright-pass → large-σ blur → additive composite over the sharp subtree.',
    snippet: ['<Group bloom={{ sigma: 12 }}>', '  <Accent />', '</Group>'].join('\n'),
  },
  {
    name: 'grade',
    Demo: GradeDemo,
    blurb:
      'A per-pixel color grade — exposure, contrast, saturation, temperature, tint. Unifies mixed (AI-generated) media into one cinematographer’s look. See FilmGrade for named presets.',
    snippet: ['<Group grade={{ temperature: 0.2, contrast: 1.1 }}>', '  <Footage />', '</Group>'].join(
      '\n',
    ),
  },
  {
    name: 'goo',
    Demo: GooDemo,
    blurb:
      'Gooey / metaball morph — overlapping shapes fuse into liquid forms with smooth necks. Blur → alpha-threshold, the same texture seam as bloom.',
    snippet: ['<Group goo={{ sigma: 12 }}>', '  <BlobA />', '  <BlobB />', '</Group>'].join('\n'),
  },
]

function useEngine() {
  // biome-ignore lint/suspicious/noExplicitAny: wasm engine types load dynamically.
  const [gpu, setGpu] = useState<any>(null)
  // biome-ignore lint/suspicious/noExplicitAny: wasm engine types load dynamically.
  const [cpu, setCpu] = useState<any>(null)
  const [active, setActive] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el || !('IntersectionObserver' in window)) {
      setActive(true)
      return
    }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setActive(true)
        io.disconnect()
      }
    })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (!active) return
    let cancelled = false
    ;(async () => {
      try {
        const { default: initVello, VelloEngine } = await import('@onda/wasm-vello')
        await initVello({ module_or_path: velloWasmUrl })
        const e = await VelloEngine.create()
        if (!cancelled) setGpu(e)
      } catch {
        const { default: initCpu, OndaEngine } = await import('@onda/wasm')
        await initCpu({ module_or_path: cpuWasmUrl })
        if (!cancelled) setCpu(new OndaEngine())
      }
    })()
    return () => {
      cancelled = true
    }
  }, [active])

  return { ref, gpu, cpu, ready: gpu || cpu }
}

export default function EffectsGallery(): ReactElement {
  const { ref, gpu, cpu, ready } = useEngine()
  const [name, setName] = useState('blur')
  const selected = EFFECTS.find((e) => e.name === name) ?? EFFECTS[0]

  const composition = useMemo(
    () =>
      createElement(
        Composition,
        { width: W, height: H, fps: 30, durationInFrames: 90 },
        createElement(selected.Demo),
      ),
    [selected],
  )

  return (
    <div ref={ref} style={styles.wrap}>
      <div style={styles.pills}>
        <span style={styles.pillsLabel}>Effect</span>
        {EFFECTS.map((e) => (
          <button
            key={e.name}
            type="button"
            onClick={() => setName(e.name)}
            style={e.name === name ? { ...styles.pill, ...styles.pillOn } : styles.pill}
          >
            {e.name}
          </button>
        ))}
      </div>

      <div style={styles.stage}>
        {ready && composition ? (
          <Player
            key={name}
            composition={composition}
            gpuEngine={gpu ?? undefined}
            engine={cpu ?? undefined}
            showStatus={false}
            loop
          />
        ) : (
          <div style={styles.booting}>Booting the GPU engine…</div>
        )}
      </div>

      <div style={styles.meta}>
        <h2 style={styles.name}>{selected.name}</h2>
        <p style={styles.blurb}>{selected.blurb}</p>
        <CodeBlock code={selected.snippet} />
      </div>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  wrap: {
    maxWidth: 960,
    color: '#f2f2f4',
    fontFamily: "'Space Grotesk', ui-sans-serif, system-ui, sans-serif",
  },
  pills: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap' },
  pillsLabel: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 11,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: '#56565f',
    marginRight: 4,
  },
  pill: {
    appearance: 'none',
    border: '1px solid #26262c',
    background: 'transparent',
    color: '#b8b8c0',
    fontFamily: 'inherit',
    fontSize: 13,
    padding: '5px 13px',
    borderRadius: 999,
    cursor: 'pointer',
  },
  pillOn: { background: '#e85494', border: '1px solid #e85494', color: '#0e0e12', fontWeight: 600 },
  stage: {
    borderRadius: 14,
    overflow: 'hidden',
    background: '#08080a',
    border: '1px solid #26262c',
  },
  booting: {
    aspectRatio: '16 / 9',
    display: 'grid',
    placeItems: 'center',
    color: '#8e8e98',
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 14,
  },
  meta: { marginTop: 22 },
  name: { fontSize: 26, fontWeight: 600, margin: '0 0 6px', letterSpacing: '-0.01em' },
  blurb: { color: '#8e8e98', fontSize: 16, margin: '0 0 18px', maxWidth: '60ch' },
}
