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
  const gradient = { addColorStop: vi.fn() }
  const ctx = {
    calls,
    gradient,
    fillStyle: '' as string | typeof gradient,
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
    clip: record('clip'),
    fill: record('fill'),
    stroke: record('stroke'),
    createLinearGradient: (...args: number[]) => {
      record('createLinearGradient')(...args)
      return gradient
    },
    createRadialGradient: (...args: number[]) => {
      record('createRadialGradient')(...args)
      return gradient
    },
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
    // Text is placed at top-left then nudged down by ~the ascent (size * 0.8).
    expect(ctx.fillText).toHaveBeenCalledWith('Hi', 0, 24 * 0.8)
    // save/restore are balanced.
    const saves = ctx.calls.filter((c) => c === 'save()').length
    const restores = ctx.calls.filter((c) => c === 'restore()').length
    expect(saves).toBe(restores)
  })

  it('paints a linear gradient fill via createLinearGradient + addColorStop', () => {
    const scene: Scene = {
      composition: { width: 100, height: 10, fps: 30, duration_in_frames: 1 },
      root: {
        kind: {
          type: 'shape',
          geometry: { shape: 'rect', size: { width: 100, height: 10 } },
          gradient: {
            gradient: 'linear',
            start: { x: 0, y: 0 },
            end: { x: 100, y: 0 },
            stops: [
              { offset: 0, color: { r: 0.23, g: 0.51, b: 0.96 } },
              { offset: 1, color: { r: 0.95, g: 0.35, b: 0.55 } },
            ],
          },
        },
      },
    }

    const ctx = stubContext()
    drawScene(ctx as unknown as CanvasRenderingContext2D, scene)

    expect(ctx.calls).toContain('createLinearGradient(0,0,100,0)')
    expect(ctx.gradient.addColorStop).toHaveBeenCalledTimes(2)
    expect(ctx.fillStyle).toBe(ctx.gradient) // gradient takes precedence over solid fill
  })

  it('applies a clip region before drawing the subtree', () => {
    const scene: Scene = {
      composition: { width: 100, height: 100, fps: 30, duration_in_frames: 1 },
      root: {
        clip: { shape: 'ellipse', size: { width: 80, height: 80 } },
        kind: { type: 'group' },
        children: [
          {
            kind: {
              type: 'shape',
              geometry: { shape: 'rect', size: { width: 100, height: 100 } },
              fill: { r: 1, g: 1, b: 1 },
            },
          },
        ],
      },
    }

    const ctx = stubContext()
    drawScene(ctx as unknown as CanvasRenderingContext2D, scene)

    expect(ctx.calls).toContain('ellipse(40,40,40,40,0,0,6.283185307179586)') // clip geometry
    expect(ctx.calls).toContain('clip()')
    // clip() must precede the clipped rect fill.
    expect(ctx.calls.indexOf('clip()')).toBeLessThan(ctx.calls.indexOf('rect(0,0,100,100)'))
  })

  it('skips image and svg nodes (rendered faithfully only by the WASM engine)', () => {
    const scene: Scene = {
      composition: { width: 10, height: 10, fps: 30, duration_in_frames: 1 },
      root: {
        kind: { type: 'group' },
        children: [
          { kind: { type: 'image', src: 'x.png' } },
          { kind: { type: 'svg', markup: '<svg/>' } },
        ],
      },
    }
    const ctx = stubContext()
    expect(() =>
      drawScene(ctx as unknown as CanvasRenderingContext2D, scene),
    ).not.toThrow()
    const saves = ctx.calls.filter((c) => c === 'save()').length
    const restores = ctx.calls.filter((c) => c === 'restore()').length
    expect(saves).toBe(restores)
  })
})
