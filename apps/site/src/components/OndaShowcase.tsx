import {
  BarChart,
  BentoGrid,
  CodeDiff,
  EndCard,
  Spotlight,
  StatCard,
  TitleCard,
  Vignette,
} from '@onda-engine/components'
import { Player } from '@onda-engine/player'
import {
  Composition,
  Group,
  Rect,
  TransitionSeries,
  fade,
  linearTiming,
  slide,
  springTiming,
  wipe,
} from '@onda-engine/react'
import velloWasmUrl from '@onda-engine/wasm-vello/pkg/onda_wasm_vello_bg.wasm?url'
import cpuWasmUrl from '@onda-engine/wasm/pkg/onda_wasm_bg.wasm?url'
import { type ReactElement, useEffect, useMemo, useRef, useState } from 'react'

// The ONDA flagship promo — the SAME composition `onda export` renders to MP4,
// here playing live in the browser via the real engine (Vello over WebGPU, CPU
// fallback). Built entirely from `@onda-engine/components`: every scene is a library
// component, sequenced with <TransitionSeries>. Mounted client-only so wasm/
// WebGPU never touches SSR; the engine boots lazily when scrolled into view.

const W = 1280
const H = 720
const ROSE = '#d96b82'
const BG = '#0a0d17'

function buildPromo(): ReactElement {
  return (
    <Composition width={W} height={H} fps={30} durationInFrames={793}>
      <Rect width={W} height={H} fill={BG} />
      <TransitionSeries>
        <TransitionSeries.Sequence durationInFrames={120}>
          <Group>
            <Spotlight
              x={0.5}
              y={0.42}
              radius={48}
              softness={70}
              color={ROSE}
              durationInFrames={30}
            />
            <TitleCard
              title="ONDA"
              subtitle="GPU-native motion graphics — no browser"
              titleSize={140}
              subtitleSize={32}
              delay={8}
            />
          </Group>
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: 18 })}
        />
        <TransitionSeries.Sequence durationInFrames={140}>
          <CodeDiff
            title="renderer.ts"
            fontSize={28}
            width={700}
            chrome
            revealLines
            lineDelay={4}
            delay={6}
            lines={[
              { text: 'function render(scene) {', type: 'context' },
              { text: '  const dom = browser.launch();', type: 'remove' },
              { text: '  const gpu = vello.surface();', type: 'add' },
              { text: '  return gpu.draw(scene);', type: 'add' },
              { text: '}', type: 'context' },
            ]}
          />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={slide({ direction: 'from-right' })}
          timing={springTiming({ durationInFrames: 20 })}
        />
        <TransitionSeries.Sequence durationInFrames={130}>
          <BarChart
            title="Frames per second"
            // Wait for the slide-in (~20f) to land before growing the bars.
            delay={24}
            max={720}
            showValues
            barHeight={46}
            gap={26}
            fontSize={24}
            labelWidth={230}
            trackWidth={680}
            accentColor={ROSE}
            barColor="#8e8e98"
            trackColor="#1c1c22"
            data={[
              { label: 'ONDA', value: 710 },
              { label: 'Remotion', value: 76 },
              { label: 'After Effects', value: 45 },
              { label: 'Lottie', value: 30 },
            ]}
          />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={wipe({ direction: 'from-left' })}
          timing={linearTiming({ durationInFrames: 18 })}
        />
        <TransitionSeries.Sequence durationInFrames={150}>
          <BentoGrid
            columns={3}
            width={900}
            gap={18}
            items={[
              {
                title: '70 components',
                caption: 'Copied into your project.',
                colSpan: 2,
                rowSpan: 1,
              },
              {
                title: 'Render',
                value: '4K',
                caption: 'Deterministic, frame-perfect.',
                colSpan: 1,
              },
              { title: 'Spring physics', caption: 'No overshoot. Calm by default.', colSpan: 1 },
              { title: 'No browser', caption: 'Pure GPU, no Chromium.', colSpan: 2 },
            ]}
          />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: 18 })}
        />
        <TransitionSeries.Sequence durationInFrames={110}>
          <StatCard value="9.3×" label="faster than Remotion" valueSize={190} labelSize={34} />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={slide({ direction: 'from-bottom' })}
          timing={springTiming({ durationInFrames: 18 })}
        />
        <TransitionSeries.Sequence durationInFrames={120}>
          <TitleCard
            title="Write React."
            subtitle="Get GPU."
            titleSize={100}
            subtitleSize={86}
            subtitleColor={ROSE}
            delay={4}
          />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: 15 })}
        />
        <TransitionSeries.Sequence durationInFrames={130}>
          <EndCard
            cta="Made with ONDA"
            handles={['@onda.video', 'onda.video']}
            accent
            ctaFontSize={92}
            handlesFontSize={22}
            accentColor={ROSE}
          />
        </TransitionSeries.Sequence>
      </TransitionSeries>
      <Vignette intensity={0.55} />
    </Composition>
  )
}

export default function OndaShowcase(): ReactElement {
  // biome-ignore lint/suspicious/noExplicitAny: wasm engine types are loaded dynamically.
  const [gpu, setGpu] = useState<any>(null)
  // biome-ignore lint/suspicious/noExplicitAny: wasm engine types are loaded dynamically.
  const [cpu, setCpu] = useState<any>(null)
  const [active, setActive] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  // Defer the engine boot until the island is on screen (the landing reveals it
  // via a toggle), so just loading the page never spins up a GPU.
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
        // No WebGPU here — fall back to the CPU engine (gradients render flat).
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

  const composition = useMemo(() => buildPromo(), [])
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
            aspectRatio: '16 / 9',
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
