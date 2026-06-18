import type { Scene } from '@onda-engine/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { type RenderEngine, engineDrawer } from './engine-drawer.js'

// Minimal ImageData polyfill for the Node test environment (no DOM).
beforeAll(() => {
  if (typeof (globalThis as { ImageData?: unknown }).ImageData === 'undefined') {
    ;(globalThis as { ImageData: unknown }).ImageData = class {
      data: Uint8ClampedArray
      width: number
      height: number
      constructor(data: Uint8ClampedArray, width: number, height: number) {
        this.data = data
        this.width = width
        this.height = height
      }
    }
  }
})

const scene: Scene = {
  composition: { width: 2, height: 1, fps: 30, duration_in_frames: 1 },
  root: { kind: { type: 'group' } },
}

describe('engineDrawer', () => {
  it('serializes the scene, renders it, and blits the pixels with putImageData', () => {
    const pixels = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255]) // 2 RGBA pixels
    const engine: RenderEngine = {
      render: vi.fn((json: string) => {
        // The drawer must hand us the serialized scene graph.
        expect(JSON.parse(json)).toEqual(scene)
        return { width: 2, height: 1, pixels }
      }),
    }
    const putImageData = vi.fn()
    const ctx = { putImageData } as unknown as CanvasRenderingContext2D

    const draw = engineDrawer(engine)
    draw(ctx, scene)

    expect(engine.render).toHaveBeenCalledOnce()
    expect(putImageData).toHaveBeenCalledOnce()
    const image = putImageData.mock.calls[0][0] as ImageData
    expect(image.width).toBe(2)
    expect(image.height).toBe(1)
    // The RGBA buffer is forwarded as a Uint8ClampedArray for ImageData.
    expect(Array.from(image.data)).toEqual(Array.from(pixels))
  })

  it('accepts an engine that already returns a Uint8ClampedArray', () => {
    const pixels = new Uint8ClampedArray([1, 2, 3, 4])
    const engine: RenderEngine = { render: () => ({ width: 1, height: 1, pixels }) }
    const putImageData = vi.fn()
    const ctx = { putImageData } as unknown as CanvasRenderingContext2D

    engineDrawer(engine)(ctx, scene)
    const image = putImageData.mock.calls[0][0] as ImageData
    expect(image.data).toBe(pixels) // no needless copy
  })
})
