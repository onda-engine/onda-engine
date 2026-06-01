import type { Scene } from '@onda/react'
import { describe, expect, it, vi } from 'vitest'
import { cssColor, drawScene } from './canvas-renderer.js'

describe('cssColor', () => {
  it('converts 0..1 sRGB to rgba(), clamping', () => {
    expect(cssColor({ r: 1, g: 0, b: 0 })).toBe('rgba(255, 0, 0, 1)')
    expect(cssColor({ r: 0, g: 0, b: 0, a: 0.5 })).toBe('rgba(0, 0, 0, 0.5)')
    expect(cssColor({ r: 2, g: -1, b: 0.5 })).toBe('rgba(255, 0, 128, 1)')
  })
})

/** A recording stand-in for CanvasRenderingContext2D. */
function stubContext() {
  const calls: string[] = []
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push(`${name}(${args.join(',')})`)
    }
  const ctx = {
    calls,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    globalAlpha: 1,
    font: '',
    textBaseline: '',
    save: record('save'),
    restore: record('restore'),
    clearRect: record('clearRect'),
    translate: record('translate'),
    scale: record('scale'),
    beginPath: record('beginPath'),
    rect: record('rect'),
    roundRect: record('roundRect'),
    ellipse: record('ellipse'),
    fill: record('fill'),
    stroke: record('stroke'),
    fillText: vi.fn(),
  }
  return ctx
}

describe('drawScene', () => {
  it('walks the scene graph, applying transforms and drawing primitives', () => {
    const scene: Scene = {
      composition: { width: 100, height: 50, fps: 30, duration_in_frames: 1 },
      root: {
        kind: { type: 'group' },
        children: [
          {
            kind: {
              type: 'shape',
              geometry: { shape: 'rect', size: { width: 100, height: 50 } },
              fill: { r: 0, g: 0, b: 0 },
            },
          },
          {
            transform: { translate: { x: 10, y: 20 } },
            kind: { type: 'text', content: 'Hi', font_size: 24, color: { r: 1, g: 1, b: 1 } },
          },
        ],
      },
    }

    const ctx = stubContext()
    drawScene(ctx as unknown as CanvasRenderingContext2D, scene)

    expect(ctx.calls).toContain('clearRect(0,0,100,50)')
    expect(ctx.calls).toContain('rect(0,0,100,50)') // backdrop
    expect(ctx.calls).toContain('translate(10,20)') // text placement
    expect(ctx.fillText).toHaveBeenCalledWith('Hi', 0, 0)
    // save/restore are balanced.
    const saves = ctx.calls.filter((c) => c === 'save()').length
    const restores = ctx.calls.filter((c) => c === 'restore()').length
    expect(saves).toBe(restores)
  })
})
