//! `@onda/render` — render `@onda/react` compositions to a file via the ONDA
//! engine. The no-Chromium equivalent of Remotion's `renderMedia`: the scene
//! graph is generated in-process (`renderFramesJSON`) and handed to the `onda`
//! CLI, which rasterizes on the GPU (Vello) and encodes with ffmpeg.

import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderFrame, renderFramesJSON } from '@onda/react'
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

/**
 * Render a composition to a video file. Generates every frame's scene graph
 * in-process, then hands it to the `onda` CLI to rasterize + encode.
 */
export async function renderToFile(
  composition: ReactElement,
  options: RenderToFileOptions,
): Promise<void> {
  const { output, backend = 'auto', encoder = 'auto', onProgress, ondaBin } = options
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
  const sceneJson = JSON.stringify(renderFrame(composition, frame))
  const dir = await mkdtemp(join(tmpdir(), 'onda-still-'))
  const scenePath = join(dir, 'scene.json')
  try {
    await writeFile(scenePath, sceneJson)
    await runOnda(resolveBin(ondaBin), ['render', scenePath, output, '--backend', backend])
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
