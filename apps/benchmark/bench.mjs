// Time a real Remotion render of the equivalent 1080p composition on this
// machine, for an apples-to-apples comparison with `onda-bench`.
//   node bench.mjs
import { bundle } from '@remotion/bundler'
import { renderMedia, selectComposition } from '@remotion/renderer'

const fps = 30

console.log('Remotion render benchmark — 1920x1080, 120 frames\n')

const bundleStart = Date.now()
const serveUrl = await bundle({ entryPoint: new URL('src/index.ts', import.meta.url).pathname })
console.log(`  bundle (cold-start): ${((Date.now() - bundleStart) / 1000).toFixed(2)}s`)

const composition = await selectComposition({ serveUrl, id: 'Bench', inputProps: {} })

// concurrency: 1 for a per-worker comparison with single-threaded onda-bench.
const start = Date.now()
await renderMedia({
  serveUrl,
  composition,
  codec: 'h264',
  outputLocation: '/tmp/remotion-bench.mp4',
  concurrency: 1,
  inputProps: {},
})
const secs = (Date.now() - start) / 1000
const frames = composition.durationInFrames
console.log(
  `  Remotion (Chromium, concurrency=1)   ${(frames / secs).toFixed(1).padStart(8)} fps   ` +
    `${((secs * 1000) / frames).toFixed(2).padStart(7)} ms/frame   (${secs.toFixed(2)}s for ${frames} frames)`,
)
process.exit(0)
