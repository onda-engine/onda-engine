import { Player } from '@onda/player'
import {
  AbsoluteFill,
  Composition,
  Group,
  Rect,
  Text,
  TransitionSeries,
  clockWipe,
  depthPush,
  dipToColor,
  fade,
  flip,
  iris,
  linearTiming,
  none,
  push,
  slide,
  wipe,
  zoom,
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

// The transitions showcase — every @onda/react TransitionSeries presentation,
// played A→B live by the real engine (Vello/WebGPU, CPU fallback), with the
// copyable usage code. Mounted client-only so wasm/WebGPU never touches SSR.

const W = 960
const H = 540

interface TransitionDef {
  name: string
  // biome-ignore lint/suspicious/noExplicitAny: presentation factory return type.
  make: () => any
  call: string
  blurb: string
}

const TRANSITIONS: TransitionDef[] = [
  { name: 'fade', make: () => fade(), call: 'fade()', blurb: 'Cross-fade via opacity.' },
  {
    name: 'slide',
    make: () => slide({ direction: 'from-right' }),
    call: "slide({ direction: 'from-right' })",
    blurb: 'The scenes slide across; the incoming enters from an edge.',
  },
  {
    name: 'wipe',
    make: () => wipe({ direction: 'from-left' }),
    call: "wipe({ direction: 'from-left' })",
    blurb: 'The incoming scene wipes over the outgoing behind a growing mask.',
  },
  {
    name: 'flip',
    make: () => flip(),
    call: 'flip()',
    blurb: 'A 2D card flip about the centre line.',
  },
  {
    name: 'clockWipe',
    make: () => clockWipe(),
    call: 'clockWipe()',
    blurb: 'An angular sweep, clockwise from 12 o’clock.',
  },
  {
    name: 'iris',
    make: () => iris(),
    call: 'iris()',
    blurb: 'A circular reveal expanding from the centre.',
  },
  {
    name: 'push',
    make: () => push({ direction: 'left' }),
    call: "push({ direction: 'left' })",
    blurb: 'Both scenes translate together, like a camera pan.',
  },
  {
    name: 'zoom',
    make: () => zoom(),
    call: 'zoom()',
    blurb: 'A scale-and-fade punch toward (or away from) the viewer.',
  },
  {
    name: 'depthPush',
    make: () => depthPush({ direction: 'left' }),
    call: "depthPush({ direction: 'left' })",
    blurb: 'A push with parallax depth — a camera dolly between scenes.',
  },
  {
    name: 'dipToColor',
    make: () => dipToColor(),
    call: 'dipToColor()',
    blurb: 'Outgoing fades to a colour, incoming fades up from it.',
  },
  {
    name: 'none',
    make: () => none(),
    call: 'none()',
    blurb: 'A hard cut — the overlap timing with no visual effect.',
  },
]

/** A labelled, full-canvas scene (a coloured card + a big letter). */
function scene(label: string, fill: string): ReactElement {
  return createElement(
    Group,
    null,
    createElement(Rect, { width: W, height: H, fill }),
    createElement(
      AbsoluteFill,
      { justify: 'center', align: 'center' },
      createElement(Text, { fontSize: 240, color: '#ffffff', fontWeight: 700 }, label),
    ),
  )
}

function snippetFor(t: TransitionDef): string {
  return [
    `import { TransitionSeries, ${t.name}, linearTiming } from '@onda/react'`,
    '',
    '<TransitionSeries>',
    '  <TransitionSeries.Sequence durationInFrames={50}>',
    '    <SceneA />',
    '  </TransitionSeries.Sequence>',
    '  <TransitionSeries.Transition',
    `    presentation={${t.call}}`,
    '    timing={linearTiming({ durationInFrames: 25 })}',
    '  />',
    '  <TransitionSeries.Sequence durationInFrames={50}>',
    '    <SceneB />',
    '  </TransitionSeries.Sequence>',
    '</TransitionSeries>',
  ].join('\n')
}

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

export default function TransitionsGallery(): ReactElement {
  const { ref, gpu, cpu, ready } = useEngine()
  const [name, setName] = useState('iris')
  const selected = TRANSITIONS.find((t) => t.name === name) ?? TRANSITIONS[0]

  const composition = useMemo(
    () =>
      createElement(
        Composition,
        { width: W, height: H, fps: 30, durationInFrames: 90 },
        createElement(
          TransitionSeries,
          null,
          createElement(TransitionSeries.Sequence, { durationInFrames: 50 }, scene('A', '#d96b82')),
          createElement(TransitionSeries.Transition, {
            presentation: selected.make(),
            timing: linearTiming({ durationInFrames: 25 }),
          }),
          createElement(TransitionSeries.Sequence, { durationInFrames: 50 }, scene('B', '#2974f2')),
        ),
      ),
    [selected],
  )

  const snippet = snippetFor(selected)

  return (
    <div ref={ref} style={styles.wrap}>
      <div style={styles.pills}>
        <span style={styles.pillsLabel}>Transition</span>
        {TRANSITIONS.map((t) => (
          <button
            key={t.name}
            type="button"
            onClick={() => setName(t.name)}
            style={t.name === name ? { ...styles.pill, ...styles.pillOn } : styles.pill}
          >
            {t.name}
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
        <CodeBlock code={snippet} />
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
  pillOn: { background: '#d96b82', border: '1px solid #d96b82', color: '#0e0e12', fontWeight: 600 },
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
