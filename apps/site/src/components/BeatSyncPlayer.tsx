//! A LIVE beat-synced composition, rendered by the real ONDA wasm engine in the
//! browser (Vello/WebGPU, CPU fallback) — not a baked video. The motion is driven by
//! `beatPulse(frame, BEATS)`, where `BEATS` is the beat grid ONDA's own beat detector
//! found in the kick track (see `cargo run -p onda-audio --example detect`); the
//! `<Audio>` node plays that kick, synced to the timeline, so the punch lands on the
//! beat. Press play (it's unmuted) to see and hear it.

import { beatPulse, framesSinceBeat } from '@onda/components'
import { Player } from '@onda/player'
import { Audio, Composition, Ellipse, Rect, Text, useCurrentFrame } from '@onda/react'
import velloWasmUrl from '@onda/wasm-vello/pkg/onda_wasm_vello_bg.wasm?url'
import cpuWasmUrl from '@onda/wasm/pkg/onda_wasm_bg.wasm?url'
import {
  type CSSProperties,
  type ReactElement,
  createElement as h,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

const W = 1280
const H = 720
const CX = W / 2
const CY = 360
const KICK = '/effects/beat-kick.wav'
// The beat grid ONDA's detector found in the kick track (120.2 BPM → every 15 frames).
const BEATS = [0, 15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165]

function Scene(): ReactElement {
  const f = useCurrentFrame()
  const p = beatPulse(f, BEATS, 9)
  const since = framesSinceBeat(f, BEATS)
  const s = Number.isFinite(since) ? since : 99
  const kr = 130 * (1 + 0.5 * p)
  const kfill = p > 0.6 ? '#ffd166' : p > 0.2 ? '#f5b942' : '#b9892f'
  const ringR = 140 + s * 20
  const ringO = Math.max(0, 0.55 - s * 0.06)
  const bars = [...Array(11)].map((_, i) => {
    const bh =
      34 +
      p * 150 * (0.55 + 0.45 * Math.abs(Math.sin(i * 1.3))) +
      14 * (0.5 + 0.5 * Math.sin(f * 0.3 + i))
    return h(Rect, {
      key: i,
      width: 42,
      height: bh,
      x: CX - 330 + i * 60,
      y: 660 - bh,
      fill: '#22d3ee',
      opacity: 0.45 + 0.55 * p,
    })
  })
  return h(
    'onda-group',
    null,
    h(Rect, { width: W, height: H, fill: '#0a0d17' }),
    h(Ellipse, {
      width: ringR * 2,
      height: ringR * 2,
      x: CX - ringR,
      y: CY - ringR,
      stroke: '#f5b942',
      strokeWidth: 5,
      opacity: ringO,
    }),
    ...bars,
    h(Ellipse, { width: kr * 2, height: kr * 2, x: CX - kr, y: CY - kr, fill: kfill }),
    h(
      Text,
      { fontSize: 42, color: '#e8edff', x: CX - 185, y: 120, opacity: 0.5 + 0.5 * p },
      'SYNCED TO THE BEAT',
    ),
    h(Text, { fontSize: 24, color: '#7c8bb0', x: CX - 150, y: 600 }, '120 BPM · auto-detected'),
    h(Rect, { width: W, height: H, fill: '#ffffff', opacity: 0.1 * p }),
    h(Audio, { src: KICK }),
  )
}

// Boot the wasm engine once the player scrolls into view (GPU, CPU fallback).
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

export default function BeatSyncPlayer(): ReactElement {
  const { ref, gpu, cpu, ready } = useEngine()
  const composition = useMemo(
    () => h(Composition, { width: W, height: H, fps: 30, durationInFrames: 180 }, h(Scene)),
    [],
  )
  return h(
    'div',
    { ref, style: styles.wrap },
    ready && composition
      ? h(Player, {
          composition,
          gpuEngine: gpu ?? undefined,
          engine: cpu ?? undefined,
          loop: true,
          autoPlay: true,
          showStatus: false,
        })
      : h('div', { style: styles.booting }, 'Booting the engine…'),
  )
}

const styles: Record<string, CSSProperties> = {
  wrap: { width: '100%', borderRadius: 14, overflow: 'hidden' },
  booting: {
    aspectRatio: '16 / 9',
    display: 'grid',
    placeItems: 'center',
    background: '#0a0d17',
    color: '#7c8bb0',
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 13,
    borderRadius: 14,
  },
}
