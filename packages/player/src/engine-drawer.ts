//! Bridge the **real** ONDA renderer (the `@onda-engine/wasm` `OndaEngine`) into a
//! `<Player>` {@link FrameDrawer}.
//!
//! The wasm engine is the same Rust renderer `onda export` uses (cosmic-text +
//! the bundled Open Sans, Vello-class shape/path/gradient/clip semantics), so a
//! preview drawn through it is **pixel-identical to the native/CLI render** — no
//! DOM, no Chromium. This is the charter-true preview path; the Canvas2D
//! {@link drawScene} renderer is the dependency-free fallback.
//!
//! To keep `@onda-engine/player` free of a hard dependency on `@onda-engine/wasm`, the engine
//! is accepted *structurally*: any object exposing `render(json) -> RenderedFrame`
//! works. The app owns wasm init and constructs the engine.

import type { Scene } from '@onda-engine/react'
import type { FrameDrawer } from './canvas-renderer.js'

/** A rendered frame as returned by `@onda-engine/wasm`'s `OndaEngine.render`: a flat
 *  straight-alpha RGBA8 buffer plus dimensions. */
export interface RenderedFrame {
  readonly width: number
  readonly height: number
  readonly pixels: Uint8Array | Uint8ClampedArray
}

/** The minimal shape of `@onda-engine/wasm`'s `OndaEngine` the player needs. Structural
 *  typing avoids a build/runtime dependency on the wasm package. */
export interface RenderEngine {
  /** Rasterize a scene-graph JSON document to RGBA8 pixels. */
  render(sceneJson: string): RenderedFrame
}

/**
 * Build a {@link FrameDrawer} that paints each frame with the real ONDA engine
 * (`@onda-engine/wasm`). Construct the engine once and memoize the returned drawer:
 *
 * ```tsx
 * import { OndaEngine, default as initWasm } from '@onda-engine/wasm'
 * import wasmUrl from '@onda-engine/wasm/pkg/onda_wasm_bg.wasm?url'
 * import { Player, engineDrawer } from '@onda-engine/player'
 *
 * await initWasm(wasmUrl)
 * const engine = new OndaEngine()
 * const draw = engineDrawer(engine) // memoize with useMemo in components
 *
 * <Player composition={hello} draw={draw} />
 * ```
 *
 * The engine renders the scene to RGBA8 and the drawer blits it with
 * `putImageData` — pixel-exact, the real renderer.
 */
export function engineDrawer(engine: RenderEngine): FrameDrawer {
  return (ctx, scene: Scene) => {
    const frame = engine.render(JSON.stringify(scene))
    // `ImageData` needs a `Uint8ClampedArray`; the wasm engine returns a
    // `Uint8Array`, so wrap (no copy) when it isn't already clamped.
    const buffer =
      frame.pixels instanceof Uint8ClampedArray
        ? frame.pixels
        : new Uint8ClampedArray(frame.pixels.buffer, frame.pixels.byteOffset, frame.pixels.length)
    // The DOM lib's ImageDataArray wants an ArrayBuffer-backed view; the runtime
    // value always is one, so assert the element type for the constructor.
    const image = new ImageData(buffer as Uint8ClampedArray<ArrayBuffer>, frame.width, frame.height)
    ctx.putImageData(image, 0, 0)
  }
}
