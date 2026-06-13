#!/usr/bin/env node
// Render specific frames from flows-full.comp.mjs for visual spot-checking.
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { preloadTextMetrics } from '@onda/components'
import { renderFrame, runEngineWarmers } from '@onda/react'

const REPO = '/Users/rodrigosilva/dev/onda-engine'
const COMP = path.join(REPO, 'apps/site/scripts/flows-full.comp.mjs')
const ONDA = path.join(REPO, 'target/release/onda')
const OUT = '/Users/rodrigosilva/.claude/jobs/1eadbbff/tmp'

// Frames to render: [frameN, label]
const FRAMES = [
  [0, 's1-intro'],
  [90, 's2-prompt'],
  [200, 's3-macro'],
  [270, 's4a-log'],
  [310, 's4a-log-mid'],
  [363, 's4b-sel-3f'],
  [372, 's4b-sel-12f'],
  [385, 's4b-sel-25f'],
  [390, 's4b-selector'],
  [450, 's4c-nodes-start'],
  [480, 's4c-nodes-mid'],
  [540, 's4c-nodes-full'],
  [620, 's5a-hero'],
  [680, 's5b-think'],
  [770, 's5c-res'],
  [870, 's5d-audio'],
  [1000, 's6-matrix'],
  [1200, 's6-matrix-late'],
  [1310, 's7a-flood'],
  [1410, 's7b-logo'],
]

const cfg = { fps: 30, durationInFrames: 1470, width: 1280, height: 720 }
const mod = await import(pathToFileURL(COMP).href)
const root = mod.default(cfg)
await runEngineWarmers()
await preloadTextMetrics()

console.log('Generating frames JSON...')
for (const [frameN, label] of FRAMES) {
  const scene = renderFrame(root, frameN)
  const jsonPath = `${OUT}/frame-${label}.json`
  writeFileSync(jsonPath, JSON.stringify([scene]))

  const pngPath = `${OUT}/frame-${label}.png`
  const r = spawnSync(
    ONDA,
    ['render-frame', jsonPath, pngPath, '--backend', 'cpu', '--frame', '0'],
    {
      cwd: REPO,
      stdio: ['ignore', 'inherit', 'inherit'],
    },
  )
  if (r.status === 0) {
    console.log(`✓ f${String(frameN).padStart(4)} ${label} -> ${pngPath}`)
  } else {
    console.error(`✗ f${frameN} ${label} FAILED (exit ${r.status})`)
  }
}
console.log('Done.')
