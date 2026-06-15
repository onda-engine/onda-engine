//! `@onda/render` — render `@onda/react` compositions to a file via the ONDA
//! engine. The no-Chromium equivalent of Remotion's `renderMedia`: the scene
//! graph is generated in-process (`renderFramesJSON`) and handed to the `onda`
//! CLI, which rasterizes on the GPU (Vello) and encodes with ffmpeg.

import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  motionBlurConfig,
  registeredFonts,
  renderFrame,
  renderFramesJSON,
  runEngineWarmers,
} from '@onda/react'
import type { ReactElement } from 'react'

export type Backend = 'auto' | 'vello' | 'cpu'
export type Encoder = 'auto' | 'videotoolbox' | 'nvenc' | 'qsv' | 'libx264'

export interface RenderProgress {
  renderedFrames: number
  totalFrames: number
}

export interface RenderToFileOptions {
  /** Output path — `.mp4` (or `.gif`). */
  output: string
  /** Rendering backend. Default `'auto'` (Vello/GPU if available, else CPU). */
  backend?: Backend
  /** H.264 encoder for mp4. Default `'auto'` (probes for hardware, else libx264). */
  encoder?: Encoder
  /** Called once per rendered frame. */
  onProgress?: (progress: RenderProgress) => void
  /** Path to the `onda` binary. Default: `$ONDA_BIN`, else `onda` on PATH. */
  ondaBin?: string
  /** Spatial supersampling factor (1–4, default 1 = off): the CLI renders each
   *  frame at N× resolution then box-downscales to native, area-averaging away the
   *  minification aliasing detailed images shimmer with under motion. N=2 is the
   *  sweet spot (matches the image decoder's 2× headroom). Costs ~N² render time. */
  superSample?: number
}

export interface RenderStillOptions {
  /** Output path — `.png`. */
  output: string
  /** Which frame to render. Default `0`. */
  frame?: number
  backend?: Backend
  ondaBin?: string
}

const resolveBin = (override?: string): string => override ?? process.env.ONDA_BIN ?? 'onda'

/** Materialize any fonts the composition declared via `loadFont` into `dir` and
 *  return the `--font <path>` CLI args, so the renderer draws with the SAME bytes
 *  the author-time measurement used (single-source — no manual `--font`). Empty
 *  when no custom font was registered. Call AFTER rendering, so fonts declared
 *  during the render are included. */
async function fontArgs(dir: string): Promise<string[]> {
  const fonts = registeredFonts()
  const args: string[] = []
  for (let i = 0; i < fonts.length; i++) {
    const fontPath = join(dir, `font-${i}.ttf`)
    await writeFile(fontPath, fonts[i] as Uint8Array)
    args.push('--font', fontPath)
  }
  return args
}

/**
 * Render a composition to a video file. Generates every frame's scene graph
 * in-process, then hands it to the `onda` CLI to rasterize + encode.
 */
export async function renderToFile(
  composition: ReactElement,
  options: RenderToFileOptions,
): Promise<void> {
  const { output, backend = 'auto', encoder = 'auto', onProgress, ondaBin, superSample } = options
  // Warm async engine assets (e.g. wasm text measurement) before the sync render,
  // so components bake real values into the frames instead of estimates.
  await runEngineWarmers()
  // `renderFramesJSON` already expands each frame to its motion-blur sub-frames; the
  // CLI averages each group of K back into one frame, so pass the matching K.
  const motionBlur = motionBlurConfig(composition)
  const framesJson = renderFramesJSON(composition)
  const dir = await mkdtemp(join(tmpdir(), 'onda-render-'))
  const framesPath = join(dir, 'frames.json')
  try {
    await writeFile(framesPath, framesJson)
    await runOnda(
      resolveBin(ondaBin),
      [
        'export-frames',
        framesPath,
        output,
        '--backend',
        backend,
        '--encoder',
        encoder,
        '--progress',
        ...(motionBlur ? ['--motion-blur', String(motionBlur.samples)] : []),
        ...(superSample && superSample > 1 ? ['--supersample', String(Math.min(4, Math.round(superSample)))] : []),
        ...(await fontArgs(dir)),
      ],
      onProgress,
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** Render a single frame to a PNG (e.g. a poster frame or a vision check). */
export async function renderStillToFile(
  composition: ReactElement,
  options: RenderStillOptions,
): Promise<void> {
  const { output, frame = 0, backend = 'auto', ondaBin } = options
  await runEngineWarmers()
  const sceneJson = JSON.stringify(renderFrame(composition, frame))
  const dir = await mkdtemp(join(tmpdir(), 'onda-still-'))
  const scenePath = join(dir, 'scene.json')
  try {
    await writeFile(scenePath, sceneJson)
    await runOnda(resolveBin(ondaBin), [
      'render',
      scenePath,
      output,
      '--backend',
      backend,
      ...(await fontArgs(dir)),
    ])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** Spawn the `onda` CLI, stream `[onda-progress]` lines to `onProgress`, and
 *  resolve on a clean exit (reject with stderr otherwise). */
function runOnda(
  bin: string,
  args: string[],
  onProgress?: (progress: RenderProgress) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    let buffer = ''
    child.stdout?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString()
      let nl = buffer.indexOf('\n')
      while (nl !== -1) {
        const line = buffer.slice(0, nl)
        buffer = buffer.slice(nl + 1)
        const match = line.match(/^\[onda-progress\](\{.*\})/)
        if (match?.[1] && onProgress) {
          try {
            const p = JSON.parse(match[1]) as { frame: number; total: number }
            onProgress({ renderedFrames: p.frame, totalFrames: p.total })
          } catch {
            // ignore a malformed progress line
          }
        }
        nl = buffer.indexOf('\n')
      }
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('error', (err) =>
      reject(
        new Error(`failed to launch onda ('${bin}' — installed and on PATH?): ${err.message}`),
      ),
    )
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`onda exited with code ${code}${stderr ? `: ${stderr.trim()}` : ''}`))
    })
  })
}
