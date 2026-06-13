import {
  AbsoluteFill,
  Composition,
  Group,
  Rect,
  Text,
  fbmGradient,
  useCurrentFrame,
} from '@onda/react'
// FLOWS AGENT — replication, shot 1 (the title on the warm cloud gradient).
// Matching ElevenLabs' opening frame (refs/flows-agent.mp4 @ ~1.5s). The cloud
// gradient is ONDA's fBm gradient; grain is the Effect::Grain pass; type is the
// bundled IBM Plex Sans (clean neutral grotesque, close to their brand sans).
import { createElement as h } from 'react'

const FPS = 30
// Warm billowing cloud stops sampled from the reference (coral → orange → peach → cream).
const CLOUD = [
  { offset: 0.0, color: '#B23420' },
  { offset: 0.3, color: '#DA541F' },
  { offset: 0.55, color: '#EC7C40' },
  { offset: 0.74, color: '#EFA070' },
  { offset: 0.88, color: '#C98A86' }, // peach → mauve transition
  { offset: 1.0, color: '#8A7AA8' }, // lavender corner (the cool balance)
]

function Hero({ width, height }) {
  const frame = useCurrentFrame()
  const t = frame / FPS

  // The cloud field: an fBm (domain-warped noise) gradient that slowly billows.
  const field = h(Rect, {
    key: 'cloud',
    x: 0,
    y: 0,
    width,
    height,
    gradient: fbmGradient(CLOUD, { scale: 0.42, warp: 0.6, time: t * 0.06 }),
  })

  // "Flows  Agent" centered white (layout-centered via AbsoluteFill).
  const title = h(
    AbsoluteFill,
    { key: 'title', justify: 'center', align: 'center' },
    h(
      Text,
      {
        fontSize: 50,
        fontFamily: 'IBM Plex Sans',
        fontWeight: 400,
        color: '#FBF7F2',
        letterSpacing: 0.4,
      },
      'Flows      Agent',
    ),
  )

  // Grain over the whole composite (the filmic texture the reference carries).
  return h(Group, { grain: { intensity: 0.05, size: 1.1, seed: frame } }, field, title)
}

export default function flowsHero({ fps, durationInFrames, width, height }) {
  return h(
    Composition,
    { width, height, fps, durationInFrames, linear: true },
    h(Hero, { width, height }),
  )
}
