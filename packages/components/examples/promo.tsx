/** @jsxRuntime automatic @jsxImportSource react */
//! The ONDA flagship promo — a ~26s, 7-scene story authored entirely from
//! `@onda/components` on `@onda/react`, sequenced with `<TransitionSeries>`.
//! Renders to MP4 through the GPU engine with NO browser anywhere:
//!
//!   pnpm --filter @onda/react exec tsx packages/components/examples/render-promo.tsx /tmp/promo-frames.json
//!   onda export-frames /tmp/promo-frames.json /tmp/promo.mp4 --backend vello
//!
//! This is the thesis made tangible: a real, multi-scene motion-graphics video
//! that Remotion would render through headless Chromium, produced here as N
//! glyph/shape runs on one GPU pass per frame.

import {
  BarChart,
  BentoGrid,
  CodeDiff,
  EndCard,
  Spotlight,
  StatCard,
  TitleCard,
  Vignette,
} from '@onda/components'
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
} from '@onda/react'

const W = 1920
const H = 1080
const FPS = 30
const BG = '#0a0d17'
const ROSE = '#d96b82'

// --- Scenes -----------------------------------------------------------------

function Hero() {
  return (
    <Group>
      <Spotlight x={0.5} y={0.42} radius={48} softness={70} color={ROSE} durationInFrames={30} />
      <TitleCard
        title="ONDA"
        subtitle="GPU-native motion graphics — no browser"
        titleSize={210}
        subtitleSize={46}
        delay={8}
      />
    </Group>
  )
}

function NoBrowser() {
  return (
    <CodeDiff
      title="renderer.ts"
      fontSize={42}
      width={1040}
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
  )
}

function Speed() {
  return (
    <BarChart
      max={720}
      showValues
      barHeight={70}
      gap={40}
      fontSize={36}
      labelWidth={340}
      trackWidth={1040}
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
  )
}

function Library() {
  return (
    <BentoGrid
      columns={3}
      width={1320}
      gap={28}
      items={[
        { title: '70 components', caption: 'Copied into your project.', colSpan: 2, rowSpan: 1 },
        { title: 'Render', value: '4K', caption: 'Deterministic, frame-perfect.', colSpan: 1 },
        { title: 'Spring physics', caption: 'No overshoot. Calm by default.', colSpan: 1 },
        { title: 'No browser', caption: 'Pure GPU, no Chromium.', colSpan: 2 },
      ]}
    />
  )
}

function Stat() {
  return <StatCard value="9.3×" label="faster than Remotion" valueSize={280} labelSize={48} />
}

function Pitch() {
  return (
    <TitleCard
      title="Write React."
      subtitle="Get GPU."
      titleSize={150}
      subtitleSize={130}
      subtitleColor={ROSE}
      delay={4}
    />
  )
}

function Outro() {
  return (
    <EndCard
      cta="Made with ONDA"
      handles={['@onda.video', 'onda.video']}
      accent
      ctaFontSize={140}
      handlesFontSize={34}
      accentColor={ROSE}
    />
  )
}

// --- Composition ------------------------------------------------------------
// Sequences sum to 900; transitions overlap (−107) → 793 frames ≈ 26.4s.

export function Promo() {
  return (
    <Composition width={W} height={H} fps={FPS} durationInFrames={793}>
      <Rect width={W} height={H} fill={BG} />
      <TransitionSeries>
        <TransitionSeries.Sequence durationInFrames={120}>
          <Hero />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: 18 })}
        />
        <TransitionSeries.Sequence durationInFrames={140}>
          <NoBrowser />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={slide({ direction: 'from-right' })}
          timing={springTiming({ durationInFrames: 20 })}
        />
        <TransitionSeries.Sequence durationInFrames={130}>
          <Speed />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={wipe({ direction: 'from-left' })}
          timing={linearTiming({ durationInFrames: 18 })}
        />
        <TransitionSeries.Sequence durationInFrames={150}>
          <Library />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: 18 })}
        />
        <TransitionSeries.Sequence durationInFrames={110}>
          <Stat />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={slide({ direction: 'from-bottom' })}
          timing={springTiming({ durationInFrames: 18 })}
        />
        <TransitionSeries.Sequence durationInFrames={120}>
          <Pitch />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: 15 })}
        />
        <TransitionSeries.Sequence durationInFrames={130}>
          <Outro />
        </TransitionSeries.Sequence>
      </TransitionSeries>
      <Vignette intensity={0.55} />
    </Composition>
  )
}
