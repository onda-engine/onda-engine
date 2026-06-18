#!/usr/bin/env node
// render-comp.mjs — TSX composition -> native render -> MP4.
//
// The delivery path for a premium, flicker-free hero: render the composition
// natively at full quality with the Vello GPU backend, then play it as a plain
// <video>. No browser, no per-frame React in the page.
//
// Pipeline:
//   1. Build a React element tree (root <Composition>) with @onda-engine/react.
//   2. await runEngineWarmers()  — loads any async engine assets (e.g. the wasm
//      text-measurement module @onda-engine/components registers) so components bake
//      exact values instead of estimates. A no-op when nothing's registered.
//   3. renderFramesJSON(element) -> a JSON string: Scene[], one scene per frame.
//      fps + durationInFrames are read from the <Composition> props.
//   4. Write that JSON to a temp file.
//   5. Spawn the onda CLI to encode:
//        onda export-frames <frames.json> <out.mp4> --backend vello
//      (native Vello render + ffmpeg/H.264; fps comes from frames[0].composition.fps).
//
// USAGE
//   # Built-in demo composition (no extra files needed):
//   node apps/site/scripts/render-comp.mjs --demo
//   node apps/site/scripts/render-comp.mjs --demo --out /tmp/onda-test.mp4
//
//   # Your own composition (the real hero, later):
//   node apps/site/scripts/render-comp.mjs --comp ./path/to/hero.comp.mjs \
//        --fps 30 --duration 90 --out /tmp/hero.mp4
//
// SWAPPING IN A REAL COMPOSITION
//   Pass --comp <module>. The module's DEFAULT export is a factory:
//
//       import { createElement as h } from 'react'
//       import { Composition, Rect /* ... */ } from '@onda-engine/react'
//       export default function hero({ fps, durationInFrames, width, height }) {
//         return h(Composition, { width, height, fps, durationInFrames },
//           /* ...children... */)
//       }
//
//   It receives { fps, durationInFrames, width, height } (CLI flags / defaults)
//   and must return a single root <Composition> element. Authoring the children
//   in real .tsx is fine — point --comp at the COMPILED .js/.mjs (or a .mjs
//   wrapper). This script itself stays JSX-free so plain `node` runs it.
//
//   The factory's fps/durationInFrames/width/height are advisory: whatever the
//   returned <Composition> declares wins (renderFramesJSON reads them off it).
//
// FLAGS
//   --demo                 use the built-in test composition
//   --comp <path>          path to a composition module (default-exports the factory)
//   --out <path>           output mp4/png (default /tmp/onda-test.mp4 or /tmp/onda-frame-N.png)
//   --fps <n>              frames per second (default 30)
//   --duration <frames>    duration in frames (default 60)
//   --width <px>           composition width (default 1280)
//   --height <px>          composition height (default 720)
//   --backend <vello|cpu>  render backend (default vello)
//   --frames-json <path>   where to write the intermediate scenes JSON
//                          (default <out>.frames.json, falls back to /tmp)
//   --keep-json            keep the intermediate frames JSON after encoding
//   --no-build             skip `cargo build --release -p onda-cli`
//
// ITERATION FLAGS (fast scene-level feedback loop)
//   --frames N:M           render only frames N..M-1 → short clip (~10–50× faster)
//                          example: --frames 240:360  renders the 4s SceneLog window
//   --frame N              render frame N → PNG (fastest: ~5s per check)
//                          example: --frame 300  → /tmp/onda-frame-300.png

import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { preloadTextMetrics } from '@onda-engine/components'
import {
  Composition,
  Easing,
  Rect,
  Text,
  interpolate,
  linearGradient,
  renderFrame,
  renderFrameRangeJSON,
  renderFramesJSON,
  runEngineWarmers,
  useCurrentFrame,
  useVideoConfig,
} from '@onda-engine/react'
import { createElement as h } from 'react'

const __filename = fileURLToPath(import.meta.url)
const REPO_ROOT = path.resolve(path.dirname(__filename), '../../..')

// ---- arg parsing -----------------------------------------------------------

function parseArgs(argv) {
  const opts = {
    demo: false,
    comp: null,
    out: null, // resolved later: depends on mode
    fps: 30,
    duration: 60,
    width: 1280,
    height: 720,
    backend: 'vello',
    framesJson: null,
    keepJson: false,
    build: true,
    fonts: [],
    motionBlur: 1,
    shutter: 0.5,
    // Iteration: --frames N:M renders a sub-range; --frame N renders one frame to PNG
    framesRange: null, // { start: number, end: number } | null
    singleFrame: null, // number | null
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => {
      const v = argv[++i]
      if (v === undefined) throw new Error(`flag ${a} needs a value`)
      return v
    }
    switch (a) {
      case '--demo':
        opts.demo = true
        break
      case '--comp':
        opts.comp = next()
        break
      case '--out':
        opts.out = next()
        break
      case '--fps':
        opts.fps = Number(next())
        break
      case '--duration':
        opts.duration = Number(next())
        break
      case '--width':
        opts.width = Number(next())
        break
      case '--height':
        opts.height = Number(next())
        break
      case '--backend':
        opts.backend = next()
        break
      case '--frames-json':
        opts.framesJson = next()
        break
      case '--keep-json':
        opts.keepJson = true
        break
      case '--font':
        opts.fonts.push(next())
        break
      case '--motion-blur':
        opts.motionBlur = Math.max(1, Math.round(Number(next())))
        break
      case '--shutter':
        opts.shutter = Number(next())
        break
      case '--no-build':
        opts.build = false
        break
      case '--frames': {
        // --frames N:M  renders frames N..M-1
        const val = next()
        const m = val.match(/^(\d+):(\d+)$/)
        if (!m) throw new Error(`--frames expects N:M (e.g. --frames 240:360), got '${val}'`)
        opts.framesRange = { start: Number(m[1]), end: Number(m[2]) }
        break
      }
      case '--frame': {
        // --frame N  renders a single frame to PNG
        const val = next()
        if (!/^\d+$/.test(val))
          throw new Error(`--frame expects an integer frame number, got '${val}'`)
        opts.singleFrame = Number(val)
        break
      }
      case '-h':
      case '--help':
        printUsageAndExit(0)
        break
      default:
        throw new Error(`unknown flag '${a}' (try --help)`)
    }
  }
  if (!opts.demo && !opts.comp) {
    throw new Error('pass --demo for the built-in test composition, or --comp <module>')
  }
  // Resolve default output path based on mode
  if (opts.out === null) {
    if (opts.singleFrame !== null) {
      opts.out = `/tmp/onda-frame-${opts.singleFrame}.png`
    } else {
      opts.out = '/tmp/onda-test.mp4'
    }
  }
  return opts
}

function printUsageAndExit(code) {
  // The big comment block at the top is the canonical reference; keep this short.
  console.log(`render-comp.mjs — TSX composition -> native render -> MP4

  node apps/site/scripts/render-comp.mjs --demo [--out /tmp/onda-test.mp4]
  node apps/site/scripts/render-comp.mjs --comp <module> [--fps N --duration F --out OUT]

Flags: --demo --comp --out --fps --duration --width --height --backend
       --frames-json --keep-json --no-build  (see the header comment for details)`)
  process.exit(code)
}

// ---- the built-in demo composition -----------------------------------------
// A full-screen gradient backdrop + a centered "ONDA" wordmark + an accent bar
// that sweeps across, plus a subtle pulse on the wordmark. Pure @onda-engine/react —
// no @onda-engine/components — so no warmer is required (the warmer call below is still
// made, and is simply a no-op here).

function DemoScene() {
  const frame = useCurrentFrame()
  const { width, height, durationInFrames } = useVideoConfig()
  const t = durationInFrames > 1 ? frame / (durationInFrames - 1) : 0

  // Accent bar sweeps left -> right with an ease, sitting under the wordmark.
  const barW = Math.round(width * 0.34)
  const barX = interpolate(t, [0, 1], [-barW, width], {
    easing: Easing.easeInOutCubic,
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const barY = Math.round(height * 0.66)

  // Wordmark pulse: scale 1.0 -> 1.06 -> 1.0 over the clip.
  const pulse = interpolate(Math.sin(t * Math.PI), [0, 1], [1, 1.06], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })

  const fontSize = Math.round(height * 0.26)
  // Rough centering: the demo only needs to look balanced, not pixel-perfect.
  const textX = Math.round(width / 2 - fontSize * 1.45)
  const textY = Math.round(height / 2 - fontSize * 0.62)

  return [
    // Backdrop: deep-navy -> indigo diagonal gradient, full-frame.
    h(Rect, {
      key: 'bg',
      width,
      height,
      gradient: linearGradient(
        [0, 0],
        [width, height],
        [
          { offset: 0, color: '#070b1a' },
          { offset: 1, color: '#1a1140' },
        ],
      ),
    }),
    // Sweeping accent bar.
    h(Rect, {
      key: 'accent',
      x: Math.round(barX),
      y: barY,
      width: barW,
      height: Math.round(height * 0.02),
      cornerRadius: Math.round(height * 0.01),
      fill: '#6ea8ff',
      opacity: 0.9,
    }),
    // Wordmark.
    h(
      Text,
      {
        key: 'wordmark',
        x: textX,
        y: textY,
        scaleX: pulse,
        scaleY: pulse,
        originX: fontSize * 1.45,
        originY: fontSize * 0.62,
        fontSize,
        fontWeight: 800,
        color: '#f5f7ff',
      },
      'ONDA',
    ),
  ]
}

function demoComposition({ fps, durationInFrames, width, height }) {
  return h(Composition, { width, height, fps, durationInFrames }, h(DemoScene, null))
}

// ---- composition loading ---------------------------------------------------

async function loadComposition(opts) {
  const cfg = {
    fps: opts.fps,
    durationInFrames: opts.duration,
    width: opts.width,
    height: opts.height,
  }
  if (opts.demo) return demoComposition(cfg)

  const modUrl = pathToFileURL(path.resolve(process.cwd(), opts.comp)).href
  const mod = await import(modUrl)
  const factory = mod.default ?? mod.composition
  if (typeof factory !== 'function') {
    throw new Error(
      `--comp module '${opts.comp}' must default-export a factory (({ fps, durationInFrames, width, height }) => <Composition>)`,
    )
  }
  const el = factory(cfg)
  if (!el || typeof el !== 'object') {
    throw new Error(`--comp factory returned ${el}; expected a <Composition> element`)
  }
  return el
}

// ---- motion blur (temporal supersampling) ----------------------------------
// Emit K sub-frame scenes per output frame, spread across the shutter interval
// (centered on the frame). The composition's hooks read fractional frames (no
// flooring), so each sub-frame is a genuine in-between; the CLI averages each
// group of K into one frame (--motion-blur K). shutter 0.5 = a 180° shutter.

function renderFramesMotionBlurJSON(element, k, shutter) {
  const N = Number(element.props?.durationInFrames)
  if (!Number.isFinite(N) || N < 1) {
    throw new Error('motion blur: the <Composition> needs a positive durationInFrames')
  }
  const scenes = []
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < k; j++) {
      // Sub-frame offset within [-shutter/2, +shutter/2], sampled at bin centers.
      const off = shutter * ((j + 0.5) / k - 0.5)
      scenes.push(renderFrame(element, i + off))
    }
  }
  return JSON.stringify(scenes)
}

// ---- main ------------------------------------------------------------------

async function main() {
  const opts = parseArgs(process.argv.slice(2))

  const element = await loadComposition(opts)
  await runEngineWarmers()
  await preloadTextMetrics()

  // ── Mode A: --frame N → single frame PNG (fastest iteration, ~5s) ──────────
  if (opts.singleFrame !== null) {
    const N = opts.singleFrame
    console.log(`rendering frame ${N} → ${opts.out}`)
    const scene = renderFrame(element, N)
    const tmp = mkdtempSync(path.join(tmpdir(), 'onda-frame-'))
    const scenePath = path.join(tmp, 'scene.json')
    writeFileSync(scenePath, JSON.stringify(scene))
    if (opts.build) {
      run('cargo', ['build', '--release', '-p', 'onda-cli'], REPO_ROOT)
    }
    run(
      'cargo',
      [
        'run',
        '--release',
        '-p',
        'onda-cli',
        '--',
        'render',
        scenePath,
        opts.out,
        '--backend',
        opts.backend,
        ...opts.fonts.flatMap((f) => ['--font', path.resolve(process.cwd(), f)]),
      ],
      REPO_ROOT,
    )
    const { size } = statSync(opts.out)
    console.log(`\nOK  ${opts.out}  (${(size / 1024).toFixed(0)} KiB)`)
    rmSync(tmp, { recursive: true, force: true })
    return
  }

  // ── Mode B: --frames N:M → sub-range clip (scene-level iteration, ~20-60s) ──
  // ── Mode C: full render (default) ──────────────────────────────────────────
  let framesJson
  if (opts.framesRange) {
    const { start, end } = opts.framesRange
    console.log(`rendering frames ${start}:${end} (${end - start} frames)…`)
    framesJson = renderFrameRangeJSON(element, start, end)
  } else if (opts.motionBlur > 1) {
    framesJson = renderFramesMotionBlurJSON(element, opts.motionBlur, opts.shutter)
  } else {
    framesJson = renderFramesJSON(element)
  }

  // Sanity: must be a non-empty array of scenes whose first carries a composition.
  const parsed = JSON.parse(framesJson)
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('renderFramesJSON produced no frames')
  }
  const comp0 = parsed[0]?.composition
  if (!comp0 || typeof comp0.fps !== 'number') {
    throw new Error('first scene is missing a composition.fps (the CLI reads fps from it)')
  }
  console.log(
    `rendered ${parsed.length} frame(s) @ ${comp0.fps}fps, ` +
      `${comp0.width}x${comp0.height} (${(framesJson.length / 1024).toFixed(0)} KiB JSON)`,
  )

  const tmp = mkdtempSync(path.join(tmpdir(), 'onda-frames-'))
  const framesPath = opts.framesJson ?? path.join(tmp, 'frames.json')
  writeFileSync(framesPath, framesJson)
  console.log(`frames JSON -> ${framesPath}`)

  if (opts.build) {
    console.log('building onda CLI (release)…')
    run('cargo', ['build', '--release', '-p', 'onda-cli'], REPO_ROOT)
  }
  console.log(`encoding -> ${opts.out} (backend: ${opts.backend})`)
  run(
    'cargo',
    [
      'run',
      '--release',
      '-p',
      'onda-cli',
      '--',
      'export-frames',
      framesPath,
      opts.out,
      '--backend',
      opts.backend,
      ...opts.fonts.flatMap((f) => ['--font', path.resolve(process.cwd(), f)]),
      ...(opts.motionBlur > 1 ? ['--motion-blur', String(opts.motionBlur)] : []),
    ],
    REPO_ROOT,
  )

  const { size } = statSync(opts.out)
  console.log(`\nOK  ${opts.out}  (${(size / 1024).toFixed(0)} KiB)`)
  if (!opts.keepJson && !opts.framesJson) {
    rmSync(tmp, { recursive: true, force: true })
  }
}

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit' })
  if (r.error) throw r.error
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} exited with code ${r.status}`)
  }
}

main().catch((err) => {
  console.error(`render-comp: ${err.message ?? err}`)
  process.exit(1)
})
