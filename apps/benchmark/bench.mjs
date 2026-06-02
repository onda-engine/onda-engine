// Time a real Remotion render of the equivalent 1080p composition on this
// machine, for an apples-to-apples comparison with `onda-bench`.
//   node bench.mjs [repeats]      (repeats = number of scattered clusters; default 1)
import { bundle } from '@remotion/bundler'
import { renderMedia, selectComposition } from '@remotion/renderer'

const repeats = Number(process.argv[2] ?? '1')
const inputProps = { repeats }

console.log(`Remotion render benchmark — 1920x1080, ${repeats} clusters\n`)

const bundleStart = Date.now()
const serveUrl = await bundle({ entryPoint: new URL('src/index.ts', import.meta.url).pathname })
console.log(`  bundle (cold-start): ${((Date.now() - bundleStart) / 1000).toFixed(2)}s`)

const composition = await selectComposition({ serveUrl, id: 'Bench', inputProps })
const frames = composition.durationInFrames

async function bench(label, concurrency) {
  const start = Date.now()
  await renderMedia({
    serveUrl,
    composition,
    codec: 'h264',
    outputLocation: '/tmp/remotion-bench.mp4',
    concurrency,
    inputProps,
  })
  const secs = (Date.now() - start) / 1000
  console.log(
    `  ${label.padEnd(34)} ${(frames / secs).toFixed(1).padStart(8)} fps   ` +
      `${((secs * 1000) / frames).toFixed(2).padStart(7)} ms/frame   (${secs.toFixed(2)}s for ${frames} frames)`,
  )
}

// concurrency=1 for a per-worker (architecture) comparison; null = Remotion's
// default multi-worker pool for a machine-throughput comparison.
await bench('Remotion (Chromium, 1 worker)', 1)
await bench('Remotion (Chromium, default pool)', null)
process.exit(0)
