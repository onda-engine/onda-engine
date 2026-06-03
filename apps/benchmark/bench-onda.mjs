// Time a full ONDA export of the equivalent 1080p composition (Vello raster +
// readback + ffmpeg encode → mp4) via @onda/render — the engine-side analog of
// bench.mjs's Remotion render, for an apples-to-apples full-pipeline compare.
//   node bench-onda.mjs [frames] [clusters]   (clusters scales scene complexity)
import { fileURLToPath } from 'node:url'
import { Composition, Ellipse, Group, Rect, Text } from '@onda/react'
import { renderToFile } from '@onda/render'
import { createElement as h } from 'react'

const frames = Number(process.argv[2] ?? 120)
const clusters = Number(process.argv[3] ?? 1)
const ONDA = fileURLToPath(new URL('../../target/release/onda', import.meta.url))

// Matches onda-bench's cluster(i) / Bench.tsx <Cluster i> exactly (same geometry,
// colors and scatter). Translucent fills as #rrggbbaa: 0.25→0x40, 0.22→0x38.
const ox = (i) => (i * 53) % 700
const oy = (i) => (i * 97) % 380
const cluster = (i) => {
  const x = ox(i)
  const y = oy(i)
  return [
    h(
      Group,
      { x: 180 + x, y: 120 + y },
      h(Ellipse, { width: 520, height: 520, fill: '#2974f240' }),
    ),
    h(
      Group,
      { x: 1200 - x, y: 420 + y },
      h(Ellipse, { width: 420, height: 420, fill: '#e64d6638' }),
    ),
    h(Group, { x: 160 + x, y: 640 + y }, h(Rect, { width: 900, height: 12, fill: '#2974f2' })),
    h(
      Group,
      { x: 160 + x, y: 430 + y },
      h(Text, { fontSize: 140, color: '#ffffff' }, 'ONDA Benchmark'),
    ),
    h(
      Group,
      { x: 164 + x, y: 690 + y },
      h(Text, { fontSize: 48, color: '#b3bfd9' }, 'GPU-native motion graphics, no browser'),
    ),
  ]
}
const composition = () => {
  const children = [h(Rect, { width: 1920, height: 1080, fill: '#0a0d17' })]
  for (let i = 0; i < Math.max(1, clusters); i++) children.push(...cluster(i))
  return h(
    Composition,
    { width: 1920, height: 1080, fps: 30, durationInFrames: frames },
    h(Group, null, ...children),
  )
}

console.log(`ONDA full export benchmark — 1920x1080, ${clusters} clusters, ${frames} frames\n`)

// Warm-up (shader compile / cache fills), not timed.
await renderToFile(composition(), {
  output: '/tmp/onda-bench-warm.mp4',
  ondaBin: ONDA,
  encoder: 'libx264',
})

async function bench(label, encoder) {
  const start = Date.now()
  await renderToFile(composition(), { output: '/tmp/onda-bench.mp4', ondaBin: ONDA, encoder })
  const secs = (Date.now() - start) / 1000
  console.log(
    `  ${label.padEnd(34)} ${(frames / secs).toFixed(1).padStart(8)} fps   ` +
      `${((secs * 1000) / frames).toFixed(2).padStart(7)} ms/frame   (${secs.toFixed(2)}s for ${frames} frames)`,
  )
}

// libx264 for an apples-to-apples encoder match with Remotion; 'auto' shows the
// hardware-encode advantage of the full ONDA pipeline.
await bench('ONDA (Vello + libx264)', 'libx264')
await bench('ONDA (Vello + hardware encode)', 'auto')
process.exit(0)
