import { Player } from '@onda/player'
import {
  Composition,
  Ellipse,
  Group,
  Img,
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
// page) rather than in the component gallery. Each effect is shown as a BEFORE ↔
// AFTER split: the SAME content is drawn twice, side by side — the left half
// plain ("OFF"), the right half wrapped in the effect ("ON") — so a viewer reads
// the exact transformation at a glance. The strength gently breathes for life,
// but both halves always share the same underlying content (an honest compare).
// Rendered by the real engine (Vello/WebGPU, CPU fallback). Mounted client-only
// so wasm/WebGPU never touches SSR.

const W = 960
const H = 540
const HALF = W / 2 // 480 — width of each comparison region

const ACCENT = '#e85494'
const INK = '#f4f3f7'

const loop = (f: number, lo: number, hi: number): number =>
  interpolate(f, [0, 45, 90], [lo, hi, lo], { extrapolateRight: 'clamp' })

// Shared split chrome: the centre divider + the "OFF" / "ON" corner labels. The
// two content copies sit beneath it; this draws on top so the labels stay crisp.
function SplitChrome(): ReactElement {
  // A dark rounded backing chip keeps each label legible over any content
  // (e.g. the bright grade gradient), without tinting the comparison itself.
  const chip = (x: number): ReactElement =>
    createElement(Rect, {
      x,
      y: 18,
      width: 62,
      height: 32,
      cornerRadius: 7,
      fill: '#06060a',
      opacity: 0.66,
    })
  return createElement(
    Group,
    null,
    createElement(Rect, { x: HALF - 1, y: 0, width: 2, height: H, fill: '#ffffff', opacity: 0.5 }),
    chip(18),
    chip(HALF + 18),
    createElement(
      Text,
      { x: 28, y: 21, fontSize: 22, color: INK, fontWeight: 700, letterSpacing: 1, opacity: 0.85 },
      'OFF',
    ),
    createElement(
      Text,
      { x: HALF + 28, y: 21, fontSize: 22, color: ACCENT, fontWeight: 700, letterSpacing: 1 },
      'ON',
    ),
  )
}

// A split demo: the same `content(originX)` drawn at x=0 (plain) and x=HALF
// (wrapped in `effectProps`), over a shared `bg`, with the divider + labels.
function Split(
  bg: ReactElement,
  content: (originX: number) => ReactElement[],
  effectProps: Record<string, unknown>,
): ReactElement {
  return createElement(
    Group,
    null,
    bg,
    createElement(Group, { x: 0, y: 0 }, ...content(0)),
    createElement(Group, { x: HALF, y: 0, ...effectProps }, ...content(0)),
    createElement(SplitChrome),
  )
}

/** blur — depth-of-field: a sharp word over a busy field. ON = lens defocus. */
function BlurDemo(): ReactElement {
  const f = useCurrentFrame()
  const blur = loop(f, 4, 13)
  // A busy background (scattered chips) so "ON" reads as a real defocus, plus a
  // bold foreground word. Both halves get the identical scene; only ON is blurred.
  const chips = [
    { x: 40, y: 90, w: 70, h: 70, c: '#2d6cdf' },
    { x: 150, y: 360, w: 90, h: 60, c: '#27b78d' },
    { x: 300, y: 70, w: 80, h: 80, c: '#e8a04a' },
    { x: 360, y: 410, w: 76, h: 76, c: '#8b5cf6' },
    { x: 60, y: 250, w: 60, h: 100, c: '#e2566f' },
    { x: 250, y: 230, w: 64, h: 64, c: '#4ec3e0' },
  ]
  const content = (_o: number): ReactElement[] => [
    ...chips.map((c, i) =>
      createElement(Rect, {
        key: `chip${i}`,
        x: c.x,
        y: c.y,
        width: c.w,
        height: c.h,
        cornerRadius: 12,
        fill: c.c,
        opacity: 0.85,
      }),
    ),
    createElement(Rect, {
      key: 'bar',
      x: 36,
      y: 286,
      width: 300,
      height: 96,
      cornerRadius: 14,
      fill: '#11131c',
      opacity: 0.82,
    }),
    createElement(
      Text,
      { key: 'word', x: 56, y: 296, fontSize: 76, color: INK, fontWeight: 700, letterSpacing: -2 },
      'FOCUS',
    ),
  ]
  return Split(createElement(Rect, { width: W, height: H, fill: '#0a0d17' }), content, { blur })
}

/** bloom — bright accents on near-black. ON glows a soft halo. */
function BloomDemo(): ReactElement {
  const f = useCurrentFrame()
  const sigma = loop(f, 8, 18)
  const content = (_o: number): ReactElement[] => [
    createElement(Ellipse, {
      key: 'orb',
      x: HALF / 2 - 44,
      y: 110,
      width: 88,
      height: 88,
      fill: '#ffd5e6',
    }),
    createElement(Ellipse, {
      key: 'core',
      x: HALF / 2 - 26,
      y: 128,
      width: 52,
      height: 52,
      fill: ACCENT,
    }),
    createElement(
      Text,
      {
        key: 'word',
        x: 64,
        y: 280,
        fontSize: 110,
        color: ACCENT,
        fontWeight: 700,
        letterSpacing: -3,
      },
      'GLOW',
    ),
    createElement(Rect, {
      key: 'line',
      x: 70,
      y: 410,
      width: 320,
      height: 8,
      cornerRadius: 4,
      fill: '#ff7fb0',
    }),
  ]
  return Split(createElement(Rect, { width: W, height: H, fill: '#070709' }), content, {
    bloom: { sigma, threshold: 0.25, intensity: 1.7 },
  })
}

/** grade — REAL footage, ungraded vs graded. The whole point of a color grade:
 *  the same shot reads raw/flat on the left and warm + cinematic on the right. */
function GradeDemo(): ReactElement {
  const f = useCurrentFrame()
  // A clearly cinematic warm grade, gently breathing but always strong enough to
  // read against the raw left half (the synthetic version was too subtle).
  const temperature = loop(f, 0.24, 0.34)
  // A bundled photo (a night skyline) so OFF is the raw clip and ON is the graded
  // clip — exactly what "grade your footage into one look" means.
  const content = (_o: number): ReactElement[] => [
    createElement(Img, {
      key: 'shot',
      x: 0,
      y: 0,
      width: HALF,
      height: H,
      src: '/gallery-sample.jpg',
      fit: 'cover',
    }),
  ]
  return Split(createElement(Rect, { width: W, height: H, fill: '#000000' }), content, {
    grade: { temperature, contrast: 1.24, saturation: 1.12, exposure: 0.03 },
  })
}

/** goo — two overlapping blobs. OFF = separate; ON = fused metaball. */
function GooDemo(): ReactElement {
  const f = useCurrentFrame()
  const sigma = loop(f, 11, 15)
  const content = (_o: number): ReactElement[] => [
    createElement(Ellipse, {
      key: 'a',
      x: HALF / 2 - 130,
      y: H / 2 - 95,
      width: 170,
      height: 170,
      fill: ACCENT,
    }),
    createElement(Ellipse, {
      key: 'b',
      x: HALF / 2 - 5,
      y: H / 2 - 80,
      width: 140,
      height: 140,
      fill: ACCENT,
    }),
  ]
  return Split(createElement(Rect, { width: W, height: H, fill: '#0a0d17' }), content, {
    goo: { sigma, threshold: 0.5 },
  })
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
      'Left, the raw scene. Right, the same nodes under a real gaussian blur — depth of field, soft reveals, focus pulls. The subtree is rendered to a texture, blurred, and composited back; deterministic on the CPU reference and identical on the GPU.',
    snippet: ['<Group blur={9}>', '  <Scene />', '</Group>'].join('\n'),
  },
  {
    name: 'bloom',
    Demo: BloomDemo,
    blurb:
      'Same accents, left and right — but on the right the bright pixels bloom a soft halo, the single biggest “premium” tell. Bright-pass → large-σ blur → additive composite over the sharp subtree.',
    snippet: ['<Group bloom={{ sigma: 14 }}>', '  <Accent />', '</Group>'].join('\n'),
  },
  {
    name: 'grade',
    Demo: GradeDemo,
    blurb:
      'Left is raw footage; right is graded — a per-pixel color grade (exposure, contrast, saturation, temperature, tint) that unifies mixed, AI-generated media into one cinematographer’s look. See FilmGrade for named presets.',
    snippet: [
      '<Group grade={{ temperature: 0.3, contrast: 1.24, saturation: 1.12 }}>',
      '  <Img src="clip.jpg" />',
      '</Group>',
    ].join('\n'),
  },
  {
    name: 'goo',
    Demo: GooDemo,
    blurb:
      'Two blobs — separate on the left, fused on the right. The gooey / metaball morph melts overlapping shapes into liquid forms with smooth necks. Blur → alpha-threshold, the same texture seam as bloom.',
    snippet: ['<Group goo={{ sigma: 13 }}>', '  <BlobA />', '  <BlobB />', '</Group>'].join('\n'),
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
