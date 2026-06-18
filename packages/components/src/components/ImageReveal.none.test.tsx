import { Composition, type Scene, renderFrame } from '@onda-engine/react'
import { createElement as h } from 'react'
import { describe, expect, it } from 'vitest'
import { ImageReveal } from './ImageReveal.js'

const SRC = 'https://picsum.photos/seed/onda-none/1920/1080'

function sceneAt(motion: string, frame: number): Scene {
  const el = h(
    Composition,
    { width: 1280, height: 720, fps: 30, durationInFrames: 120 },
    h(ImageReveal, { src: SRC, motion }),
  )
  return renderFrame(el, frame)
}

describe("ImageReveal motion:'none'", () => {
  it('renders an image node', () => {
    const scene = sceneAt('none', 0)
    expect(JSON.stringify(scene)).toContain(SRC)
  })

  it('is byte-identical across frames (truly static — no entrance)', () => {
    const a = JSON.stringify(sceneAt('none', 0))
    const b = JSON.stringify(sceneAt('none', 60))
    expect(a).toBe(b)
  })

  it("control: motion:'blur' DOES change across the entrance", () => {
    const a = JSON.stringify(sceneAt('blur', 0))
    const b = JSON.stringify(sceneAt('blur', 6))
    expect(a).not.toBe(b)
  })
})
