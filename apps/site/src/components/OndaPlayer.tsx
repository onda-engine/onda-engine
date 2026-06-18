import { Player } from '@onda-engine/player'
import {
  Composition,
  Ellipse,
  Flex,
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
} from '@onda-engine/react'
import velloWasmUrl from '@onda-engine/wasm-vello/pkg/onda_wasm_vello_bg.wasm?url'
import cpuWasmUrl from '@onda-engine/wasm/pkg/onda_wasm_bg.wasm?url'
import { type ReactElement, useEffect, useMemo, useRef, useState } from 'react'

// The wasm engine modules (@onda-engine/wasm-vello runs a WebGPU shim at import time)
// are loaded dynamically inside the effect so this island is safe to SSR.

// A live ONDA composition, rendered by the real engine (Vello over WebGPU, with
// a CPU fallback) — the same scene graph `onda export` would render to a file.
// Mounted as a client-only React island so the wasm/WebGPU never touches SSR.

const W = 1280
const H = 480

/** A spring-up, fade-in title (frame-driven, deterministic). */
function Title({ label, color = '#f2f2f4' }: { label: string; color?: string }): ReactElement {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const rise = spring({ frame, fps, config: { damping: 13, stiffness: 120 } })
  const opacity = interpolate(frame, [0, 14], [0, 1], { extrapolateRight: 'clamp' })
  const y = interpolate(rise, [0, 1], [210, 168])
  return (
    <Text x={96} y={y} fontSize={104} color={color} opacity={opacity} fontFamily="IBM Plex Sans">
      {label}
    </Text>
  )
}

/** A gradient underline that wipes in left-to-right via a clip mask. */
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

/** A vector "wave" (SVG path data) that drifts across while fading. */
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

/** A pulsing accent dot (pixel-exact on every backend). */
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

function buildDemo(): ReactElement {
  return (
    <Composition width={W} height={H} fps={30} durationInFrames={150}>
      <Rect width={W} height={H} fill="#0e0e12" />
      <Wave />
      <Pulse />
      <Series>
        <Series.Sequence durationInFrames={75}>
          <Title label="Motion at GPU speed" />
        </Series.Sequence>
        <Series.Sequence durationInFrames={75}>
          <Title label="No browser." color="#d96b82" />
        </Series.Sequence>
      </Series>
      <Underline />
      {/* A flex row, centered by the layout engine (no absolute x math). */}
      <Flex x={0} y={408} width={W} direction="row" justify="center" gap={16}>
        <Rect width={150} height={34} cornerRadius={17} fill="#18181d" />
        <Rect width={150} height={34} cornerRadius={17} fill="#18181d" />
        <Rect width={150} height={34} cornerRadius={17} fill="#18181d" />
      </Flex>
    </Composition>
  )
}

export default function OndaPlayer(): ReactElement {
  // biome-ignore lint/suspicious/noExplicitAny: wasm engine types are loaded dynamically.
  const [gpu, setGpu] = useState<any>(null)
  // biome-ignore lint/suspicious/noExplicitAny: wasm engine types are loaded dynamically.
  const [cpu, setCpu] = useState<any>(null)
  const [active, setActive] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  // Defer the engine boot until the island is actually on screen (the landing
  // reveals it via a toggle), so just loading the page never spins up a GPU.
  useEffect(() => {
    const el = rootRef.current
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
        const { default: initVello, VelloEngine } = await import('@onda-engine/wasm-vello')
        await initVello({ module_or_path: velloWasmUrl })
        const engine = await VelloEngine.create()
        if (!cancelled) setGpu(engine)
      } catch {
        // No WebGPU here — fall back to the CPU engine.
        const { default: initCpu, OndaEngine } = await import('@onda-engine/wasm')
        await initCpu({ module_or_path: cpuWasmUrl })
        const engine = new OndaEngine()
        if (!cancelled) setCpu(engine)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [active])

  const composition = useMemo(() => buildDemo(), [])
  const ready = gpu || cpu

  return (
    <div ref={rootRef}>
      {ready ? (
        <Player
          composition={composition}
          gpuEngine={gpu ?? undefined}
          engine={cpu ?? undefined}
          loop
        />
      ) : (
        <div
          style={{
            aspectRatio: '8 / 3',
            display: 'grid',
            placeItems: 'center',
            color: '#8e8e98',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 14,
          }}
        >
          Booting the GPU engine…
        </div>
      )}
    </div>
  )
}
