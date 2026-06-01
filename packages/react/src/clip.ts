//! Author-facing clip shapes, normalized into the engine's {@link ShapeGeometry}.

import type { ShapeGeometry } from './scene.js'

/** A clip region as authored: a rect (optionally rounded), ellipse, or path. */
export type ClipInput =
  | { type: 'rect'; width: number; height: number; cornerRadius?: number }
  | { type: 'ellipse'; width: number; height: number }
  | { type: 'path'; d: string }

/** Normalize a {@link ClipInput} into the engine's {@link ShapeGeometry}. */
export function parseClip(input: ClipInput): ShapeGeometry {
  switch (input.type) {
    case 'rect':
      return {
        shape: 'rect',
        size: { width: input.width, height: input.height },
        ...(input.cornerRadius != null ? { corner_radius: input.cornerRadius } : {}),
      }
    case 'ellipse':
      return { shape: 'ellipse', size: { width: input.width, height: input.height } }
    case 'path':
      return { shape: 'path', data: input.d }
  }
}

/** A rounded/square rectangle clip. */
export function clipRect(width: number, height: number, cornerRadius?: number): ClipInput {
  return { type: 'rect', width, height, cornerRadius }
}

/** An ellipse clip inscribed in `width`×`height`. */
export function clipEllipse(width: number, height: number): ClipInput {
  return { type: 'ellipse', width, height }
}

/** An arbitrary clip from SVG path data. */
export function clipPath(d: string): ClipInput {
  return { type: 'path', d }
}
