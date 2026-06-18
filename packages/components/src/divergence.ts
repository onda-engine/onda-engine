//! Backend divergence — "what I SEE vs what SHIPS", queryable.
//!
//! The reference render is the native Vello GPU export ('export'). Three other
//! backends draw the same scene JSON with documented gaps:
//!
//! - `preview-webgpu` — `@onda-engine/wasm-vello` in the browser. Runs the SAME
//!   renderer (per-node effects AND the composition `finish` chain are applied
//!   — `LinearFinish` is a pure texture→texture compute chain that runs
//!   identically on native and web). Remaining gaps: `lightWrap` (export/
//!   native only — nodes draw un-wrapped), fBm gradients (degrade to a smooth
//!   gradient), the `linear` HDR pipeline (gamma fallback), and composition
//!   motion blur (export-time temporal supersampling — a live player renders
//!   single frames).
//! - `preview-cpu` / `native-cpu` — the CPU reference (tiny-skia; `@onda-engine/wasm`
//!   in the browser, `--backend cpu` natively). Faithful for fills/strokes/
//!   gradients/paths/text, but: no rotation, no clip, blend modes composite
//!   normal, no video decode, per-run text colors collapse to the base style,
//!   `goo`/`lightWrap` skipped, fBm degrades, and the composition
//!   `finish`/`linear` chain is not applied.
//!
//! {@link divergenceReport} walks a rendered scene and returns every node/
//! feature whose render on the target backend diverges from export — the
//! Studio agent (and any author) can ask BEFORE judging a preview. Sources of
//! truth: the scene-rs `Effect`/`Node`/`Transform` doc comments and
//! `ENGINE_CAPABILITIES` in fidelity.ts; component-level capability lives in
//! `COMPONENT_FIDELITY.backend` ('gpu_only').

import type { Scene } from '@onda-engine/react'

/** The render backends a scene can be judged on. `'export'` is the reference. */
export type RenderBackend = 'export' | 'preview-webgpu' | 'preview-cpu' | 'native-cpu'

/** One feature that renders differently on the target backend than on export. */
export interface Divergence {
  /** Slash path of node indices from the root (e.g. `root/0/2`); `composition`
   *  for composition-level features. */
  path: string
  /** The node's `id`, when it has one. */
  nodeId?: string
  /** What diverges — `transform:rotation`, `node:clip`, `node:blend`,
   *  `node:video`, `text:runs`, `effect:light_wrap`, `effect:goo`,
   *  `gradient:fbm`, `composition:finish`, `composition:linear`,
   *  `composition:motionBlur`. */
  feature: string
  /** `missing` = not drawn/applied at all; `degraded` = drawn approximately. */
  severity: 'missing' | 'degraded'
  /** Human note (mirrors the engine doc comments). */
  note: string
}

interface SceneNode {
  id?: string
  transform?: { rotate?: number }
  clip?: unknown
  blend?: string
  effects?: { effect?: string }[]
  kind?: {
    type?: string
    runs?: unknown[]
    gradient?: { gradient?: string }
  }
  children?: SceneNode[]
}

interface SceneShape {
  composition?: { finish?: unknown; linear?: boolean }
  root?: SceneNode
}

/** Options for composition-level features that do NOT survive into per-frame
 *  scene JSON (and so can't be detected by walking it). */
export interface DivergenceOpts {
  /** The composition declares `<Composition motionBlur={…}>` (an export-time
   *  frame expansion — pass it explicitly, the per-frame scene can't show it). */
  motionBlur?: boolean
}

const CPU_BACKENDS: RenderBackend[] = ['preview-cpu', 'native-cpu']

/** Every node/effect/composition feature in `scene` whose render on `backend`
 *  diverges from the native export. Empty for `'export'` (modulo
 *  `opts.motionBlur`, which only export applies). */
export function divergenceReport(
  scene: Scene,
  backend: RenderBackend,
  opts: DivergenceOpts = {},
): Divergence[] {
  const out: Divergence[] = []
  const s = scene as unknown as SceneShape
  const isCpu = CPU_BACKENDS.includes(backend)
  const isPreview = backend !== 'export'

  // ── composition-level ───────────────────────────────────────────────────────
  if (opts.motionBlur && isPreview) {
    out.push({
      path: 'composition',
      feature: 'composition:motionBlur',
      severity: 'missing',
      note: 'Motion blur is export-time temporal supersampling (N sub-frames per frame); a live preview renders single frames sharp.',
    })
  }
  if (s.composition?.finish && isCpu) {
    out.push({
      path: 'composition',
      feature: 'composition:finish',
      severity: 'missing',
      note: 'The cinematic finish chain (bloom/halation/grade/vignette/grain + ACES) runs on the Vello GPU renderer (native AND WebGPU preview); the CPU reference renders un-finished.',
    })
  }
  if (s.composition?.linear) {
    if (isCpu) {
      out.push({
        path: 'composition',
        feature: 'composition:linear',
        severity: 'missing',
        note: 'Linear-light HDR pipeline — the CPU reference falls back to the gamma path.',
      })
    } else if (backend === 'preview-webgpu') {
      out.push({
        path: 'composition',
        feature: 'composition:linear',
        severity: 'degraded',
        note: 'Linear-light HDR pipeline — the WebGPU preview falls back to the gamma path (scene-rs Composition::linear); judge HDR roll-off on the native render.',
      })
    }
  }

  // ── per-node walk ───────────────────────────────────────────────────────────
  const visit = (node: SceneNode | undefined, path: string) => {
    if (!node) return
    const push = (feature: string, severity: Divergence['severity'], note: string) =>
      out.push({ path, ...(node.id ? { nodeId: node.id } : {}), feature, severity, note })

    if (isCpu) {
      if (node.transform?.rotate) {
        push(
          'transform:rotation',
          'missing',
          'The CPU reference ignores rotation (Vello-only); the node draws un-rotated.',
        )
      }
      if (node.clip != null) {
        push('node:clip', 'missing', 'The CPU reference ignores clip regions (Vello-only).')
      }
      if (node.blend && node.blend !== 'normal') {
        push(
          'node:blend',
          'degraded',
          `Blend mode '${node.blend}' composites as normal (src-over) on the CPU reference.`,
        )
      }
      if (node.kind?.type === 'video') {
        push('node:video', 'missing', 'The CPU reference does not decode video.')
      }
      if (Array.isArray(node.kind?.runs) && node.kind.runs.length > 0) {
        push(
          'text:runs',
          'degraded',
          'Per-run text styling draws on the GPU path; the CPU reference draws the concatenated text in the base style.',
        )
      }
    }

    for (const fx of node.effects ?? []) {
      const kind = fx?.effect
      if (kind === 'light_wrap' && isPreview) {
        push(
          'effect:light_wrap',
          'missing',
          'Light-wrap is export/native only — previews draw the node un-wrapped (graceful degrade).',
        )
      }
      if (kind === 'goo' && isCpu) {
        push('effect:goo', 'missing', 'Goo/metaball is GPU-only; the CPU reference skips it.')
      }
    }

    const gradient = node.kind?.gradient?.gradient
    if (gradient === 'fbm' && (isCpu || backend === 'preview-webgpu')) {
      push(
        'gradient:fbm',
        'degraded',
        'fBm fractal-noise gradients degrade to a smooth gradient off the native GPU — judge on the native render.',
      )
    }

    node.children?.forEach((child, i) => visit(child, `${path}/${i}`))
  }
  visit(s.root, 'root')

  return out
}

/** True when `scene` renders identically to export on `backend`. */
export function matchesExport(
  scene: Scene,
  backend: RenderBackend,
  opts: DivergenceOpts = {},
): boolean {
  return divergenceReport(scene, backend, opts).length === 0
}
