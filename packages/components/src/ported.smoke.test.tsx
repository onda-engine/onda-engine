import { Composition, type Scene, Text, renderFrame } from '@onda/react'
import { createElement as h } from 'react'
import type { FunctionComponent } from 'react'
import { describe, expect, it } from 'vitest'
import * as Lib from './index.js'

// Generated from the verified demo cases — a regression guard that every ported
// component renders to a non-empty scene without throwing, at the frame used to
// visually verify it. (Visual correctness was checked by rendering each via the
// Vello backend; this keeps them from silently breaking.)
const CASES: { name: string; frame: number; props: Record<string, unknown> }[] = [
  {
    name: 'RotateIn',
    frame: 8,
    props: {
      fromDegrees: -8,
      delay: 0,
      durationInFrames: 18,
    },
  },
  {
    name: 'PulsingIndicator',
    frame: 15,
    props: {
      color: '#d96b82',
      size: 40,
      label: 'LIVE',
      labelColor: '#8e8e98',
      fontSize: 48,
      period: 45,
      x: 760,
      y: 500,
    },
  },
  {
    name: 'Typewriter',
    frame: 14,
    props: {
      text: 'motion graphics',
      durationInFrames: 24,
      cursor: true,
      cursorColor: '#d96b82',
      color: '#f2f2f4',
      fontSize: 80,
      fontWeight: 500,
    },
  },
  {
    name: 'CountUp',
    frame: 16,
    props: {
      from: 0,
      to: 12847,
      prefix: '$',
      suffix: '+',
      decimals: 0,
      fontSize: 140,
      fontWeight: 700,
      color: '#F2F2F4',
      x: 120,
      y: 360,
      durationInFrames: 24,
    },
  },
  {
    name: 'ProgressBar',
    frame: 30,
    props: {
      value: 72,
      width: 720,
      height: 16,
      accentColor: '#d96b82',
      trackColor: '#26262e',
      color: '#f2f2f4',
      fontSize: 32,
      showValue: true,
    },
  },
  {
    name: 'Marquee',
    frame: 75,
    props: {
      items: ['ONDA', 'TYPESCRIPT', 'REACT', 'GPU NATIVE', 'VELLO'],
      speed: 60,
      direction: 'left',
      gap: 80,
      color: '#9aa4b2',
      fontSize: 64,
      fontWeight: 600,
      height: 120,
    },
  },
  {
    name: 'Spotlight',
    frame: 24,
    props: {
      x: 0.5,
      y: 0.45,
      radius: 45,
      delay: 0,
      durationInFrames: 24,
      color: '#ffe9b0',
      softness: 65,
    },
  },
  {
    name: 'Vignette',
    frame: 0,
    props: {
      intensity: 0.7,
      innerRadius: 35,
      color: '#000000',
    },
  },
  {
    name: 'Highlight',
    frame: 36,
    props: {
      text: 'motion graphics',
      fontSize: 72,
      color: '#f2f2f4',
      accentColor: '#d96b82',
      fontWeight: 600,
      paddingX: 10,
      x: 120,
      y: 120,
    },
  },
  {
    name: 'Underline',
    frame: 60,
    props: {
      text: 'motion graphics',
      fontSize: 96,
      color: '#f2f2f4',
      accentColor: '#d96b82',
      lineThickness: 4,
      lineOffset: 10,
      delay: 0,
      duration: 18,
      lineDelay: 8,
      lineDuration: 10,
    },
  },
  {
    name: 'BarChart',
    frame: 48,
    props: {
      data: [
        {
          label: 'Remotion',
          value: 92,
        },
        {
          label: 'After Effects',
          value: 64,
        },
        {
          label: 'Lottie',
          value: 38,
        },
      ],
      max: 100,
      showValues: true,
      accentColor: '#d96b82',
      barColor: '#8e8e98',
      trackColor: '#1c1c22',
      color: '#f2f2f4',
      barHeight: 40,
      gap: 24,
      fontSize: 26,
      labelWidth: 240,
      trackWidth: 760,
    },
  },
  {
    name: 'WordStagger',
    frame: 28,
    props: {
      text: 'motion that moves you',
      fontSize: 96,
      color: '#f2f2f4',
      width: 1080,
      fontWeight: 600,
      justify: 'center',
      stagger: 4,
    },
  },
]

const registry = Lib as Record<string, unknown>
const sample = () => h(Text, { fontSize: 80, color: '#ffffff', fontWeight: 700 }, 'Onda')

describe('ported components render without throwing', () => {
  for (const c of CASES) {
    it(`${c.name} @ frame ${c.frame}`, () => {
      const Comp = registry[c.name] as FunctionComponent<Record<string, unknown>> | undefined
      expect(typeof Comp).toBe('function')
      const el = h(
        Composition,
        { width: 1280, height: 720, fps: 30, durationInFrames: 120 },
        h(Comp as FunctionComponent<Record<string, unknown>>, c.props, sample()),
      )
      const scene: Scene = renderFrame(el, c.frame)
      expect((scene.root.children ?? []).length).toBeGreaterThan(0)
    })
  }
})
