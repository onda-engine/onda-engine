import { Player } from '@onda/player'
import {
  AbsoluteFill,
  Composition,
  Flex,
  Group,
  Rect,
  Text,
  TransitionSeries,
  fade,
  linearTiming,
  slide,
  wipe,
} from '@onda/react'
import velloWasmUrl from '@onda/wasm-vello/pkg/onda_wasm_vello_bg.wasm?url'
import cpuWasmUrl from '@onda/wasm/pkg/onda_wasm_bg.wasm?url'
import { type CSSProperties, type ReactElement, useEffect, useMemo, useRef, useState } from 'react'

// Interactive, in-docs demos rendered by the real engine (Vello/WebGPU, CPU
// fallback). Mounted client-only; the engine boots lazily when scrolled into
// view. `demo` selects which feature to show. Same scene graph as `onda export`.

const W = 1280
const H = 480

// ---------------------------------------------------------------------------
// Lazy engine boot (shared shape with the landing player).
// ---------------------------------------------------------------------------
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
        await initVello(velloWasmUrl)
        const engine = await VelloEngine.create()
        if (!cancelled) setGpu(engine)
      } catch {
        const { default: initCpu, OndaEngine } = await import('@onda/wasm')
        await initCpu(cpuWasmUrl)
        const engine = new OndaEngine()
        if (!cancelled) setCpu(engine)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [active])

  return { ref, gpu, cpu, ready: gpu || cpu }
}

// ---------------------------------------------------------------------------
// Demo compositions.
// ---------------------------------------------------------------------------
type Dir = 'row' | 'column'
type Justify = 'start' | 'center' | 'end' | 'space-between'
type Align = 'start' | 'center' | 'end'

function buildLayout(direction: Dir, justify: Justify, align: Align): ReactElement {
  return (
    <Composition width={W} height={H} fps={30} durationInFrames={1}>
      <Rect width={W} height={H} fill="#0e0e12" />
      <Flex
        x={0}
        y={0}
        width={W}
        height={H}
        direction={direction}
        justify={justify}
        align={align}
        gap={24}
        padding={40}
      >
        <Rect width={200} height={96} cornerRadius={14} fill="#d96b82" />
        <Rect width={130} height={130} cornerRadius={14} fill="#e89aac" />
        <Rect width={170} height={72} cornerRadius={14} fill="#c8576f" />
      </Flex>
    </Composition>
  )
}

type Preset = 'fade' | 'slide' | 'wipe'

function card(label: string, bg: string, fg: string): ReactElement {
  return (
    <Group>
      <Rect width={W} height={H} fill={bg} />
      <AbsoluteFill justify="center" align="center">
        <Text fontSize={150} color={fg} fontFamily="IBM Plex Sans" fontWeight={700}>
          {label}
        </Text>
      </AbsoluteFill>
    </Group>
  )
}

function buildTransition(preset: Preset): ReactElement {
  const presentation =
    preset === 'fade'
      ? fade()
      : preset === 'slide'
        ? slide({ direction: 'from-right' })
        : wipe({ direction: 'from-left' })
  return (
    <Composition width={W} height={H} fps={30} durationInFrames={150}>
      <TransitionSeries>
        <TransitionSeries.Sequence durationInFrames={90}>
          {card('A', '#0e0e12', '#d96b82')}
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={presentation}
          timing={linearTiming({ durationInFrames: 30 })}
        />
        <TransitionSeries.Sequence durationInFrames={90}>
          {card('B', '#1a1014', '#e89aac')}
        </TransitionSeries.Sequence>
      </TransitionSeries>
    </Composition>
  )
}

// ---------------------------------------------------------------------------
// Controls + shell.
// ---------------------------------------------------------------------------
function Seg<T extends string>({
  value,
  options,
  onChange,
}: { value: T; options: readonly T[]; onChange: (v: T) => void }): ReactElement {
  return (
    <span style={styles.seg}>
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          style={value === opt ? styles.segOn : styles.segOff}
        >
          {opt}
        </button>
      ))}
    </span>
  )
}

export default function OndaDemo({ demo }: { demo: 'layout' | 'transitions' }): ReactElement {
  const { ref, gpu, cpu, ready } = useEngine()

  const [direction, setDirection] = useState<Dir>('row')
  const [justify, setJustify] = useState<Justify>('space-between')
  const [align, setAlign] = useState<Align>('center')
  const [preset, setPreset] = useState<Preset>('slide')

  const composition = useMemo(
    () => (demo === 'layout' ? buildLayout(direction, justify, align) : buildTransition(preset)),
    [demo, direction, justify, align, preset],
  )

  return (
    <div ref={ref} style={styles.wrap}>
      <div style={styles.controls}>
        {demo === 'layout' ? (
          <>
            <span style={styles.label}>direction</span>
            <Seg value={direction} options={['row', 'column'] as const} onChange={setDirection} />
            <span style={styles.label}>justify</span>
            <Seg
              value={justify}
              options={['start', 'center', 'end', 'space-between'] as const}
              onChange={setJustify}
            />
            <span style={styles.label}>align</span>
            <Seg value={align} options={['start', 'center', 'end'] as const} onChange={setAlign} />
          </>
        ) : (
          <>
            <span style={styles.label}>transition</span>
            <Seg value={preset} options={['fade', 'slide', 'wipe'] as const} onChange={setPreset} />
          </>
        )}
      </div>
      {ready ? (
        <Player
          composition={composition}
          gpuEngine={gpu ?? undefined}
          engine={cpu ?? undefined}
          loop
        />
      ) : (
        <div style={styles.booting}>Booting the GPU engine…</div>
      )}
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  wrap: { margin: '1.5rem 0' },
  controls: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 12 },
  label: {
    fontFamily: 'var(--sl-font-mono, monospace)',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    opacity: 0.6,
    marginLeft: 6,
  },
  seg: {
    display: 'inline-flex',
    border: '1px solid var(--sl-color-hairline, #333)',
    borderRadius: 8,
    overflow: 'hidden',
  },
  segOff: {
    appearance: 'none',
    border: 'none',
    background: 'transparent',
    color: 'var(--sl-color-gray-2, #aaa)',
    font: 'inherit',
    fontSize: 13,
    padding: '5px 11px',
    cursor: 'pointer',
  },
  segOn: {
    appearance: 'none',
    border: 'none',
    background: '#d96b82',
    color: '#1a1014',
    font: 'inherit',
    fontSize: 13,
    fontWeight: 600,
    padding: '5px 11px',
    cursor: 'pointer',
  },
  booting: {
    aspectRatio: '8 / 3',
    display: 'grid',
    placeItems: 'center',
    color: 'var(--sl-color-gray-3, #888)',
    fontFamily: 'var(--sl-font-mono, monospace)',
    fontSize: 14,
    border: '1px solid var(--sl-color-hairline, #333)',
    borderRadius: 10,
  },
}
