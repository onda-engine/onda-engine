#!/usr/bin/env node
// render-comp.mjs — TSX composition -> native render -> MP4.
//
// The delivery path for a premium, flicker-free hero: render the composition
// natively at full quality with the Vello GPU backend, then play it as a plain
// <video>. No browser, no per-frame React in the page.
//
// Pipeline:
//   1. Build a React element tree (root <Composition>) with @onda/react.
//   2. await runEngineWarmers()  — loads any async engine assets (e.g. the wasm
//      text-measurement module @onda/components registers) so components bake
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
//       import { Composition, Rect /* ... */ } from '@onda/react'
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
//   --out <path>           output mp4 (default /tmp/onda-test.mp4)
//   --fps <n>              frames per second (default 30)
//   --duration <frames>    duration in frames (default 60)
//   --width <px>           composition width (default 1280)
//   --height <px>          composition height (default 720)
//   --backend <vello|cpu>  render backend (default vello)
//   --frames-json <path>   where to write the intermediate scenes JSON
//                          (default <out>.frames.json, falls back to /tmp)
//   --keep-json            keep the intermediate frames JSON after encoding
//   --no-build             skip `cargo build --release -p onda-cli`

import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  Composition,
  Easing,
  Rect,
  Text,
  interpolate,
  linearGradient,
  renderFrame,
  renderFramesJSON,
  runEngineWarmers,
  useCurrentFrame,
  useVideoConfig,
} from '@onda/react'
import { createElement as h } from 'react'

const __filename = fileURLToPath(import.meta.url)
const REPO_ROOT = path.resolve(path.dirname(__filename), '../../..')

// ---- arg parsing -----------------------------------------------------------

function parseArgs(argv) {
  const opts = {
    demo: false,
    comp: null,
    out: '/tmp/onda-test.mp4',
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
// that sweeps across, plus a subtle pulse on the wordmark. Pure @onda/react —
// no @onda/components — so no warmer is required (the warmer call below is still
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

  // 1-3. Build the tree, warm the engine, render every frame to a scenes array.
  // With --motion-blur K, emit K sub-frames per output frame instead.
  const element = await loadComposition(opts)
  await runEngineWarmers()
  const framesJson =
    opts.motionBlur > 1
      ? renderFramesMotionBlurJSON(element, opts.motionBlur, opts.shutter)
      : renderFramesJSON(element)

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

  // 4. Write the intermediate scenes JSON.
  const tmp = mkdtempSync(path.join(tmpdir(), 'onda-frames-'))
  const framesPath = opts.framesJson ?? path.join(tmp, 'frames.json')
  writeFileSync(framesPath, framesJson)
  console.log(`frames JSON -> ${framesPath}`)

  // 5. Build the CLI (release) then encode. Cargo is run at the repo root so the
  //    workspace member `onda-cli` resolves regardless of the invoking cwd.
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
      // Load any --font files so Text can select them by family name (the native
      // render uses bundled fonts otherwise). Repeatable.
      ...opts.fonts.flatMap((f) => ['--font', path.resolve(process.cwd(), f)]),
      // Average each group of K sub-frames into one output frame (motion blur).
      ...(opts.motionBlur > 1 ? ['--motion-blur', String(opts.motionBlur)] : []),
    ],
    REPO_ROOT,
  )

  // Report + cleanup.
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
