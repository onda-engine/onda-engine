//! WebAssembly bindings for the ONDA **Vello (GPU)** renderer.
//!
//! This runs the *real* GPU vector renderer — `onda-vello` (Vello 0.3 / wgpu 22)
//! — in the browser over **WebGPU**, with no DOM and no Chromium. Unlike the CPU
//! `@onda/wasm` engine, it draws the full vector feature set (anti-aliased
//! fills + strokes, arbitrary paths, gradients, clip masks, native glyph text),
//! so an in-browser preview built on it is pixel-identical to
//! `onda export --backend vello`.
//!
//! Step 1 of the WebGPU player (see `packages/player/WEBGPU.md`): offscreen
//! render + async readback to RGBA bytes (blit via `putImageData`). The
//! swapchain *present* path replaces the readback in a later step.
//!
//! Everything is async: WebGPU device acquisition and buffer mapping genuinely
//! can't block the browser's main thread.
//!
//! The crate is empty on non-wasm targets so it never touches the native build.
#![cfg(target_arch = "wasm32")]

use onda_scene::Scene;
use onda_vello::VelloRenderer;
use wasm_bindgen::prelude::*;

/// A rendered frame: straight-alpha RGBA8 pixels (`width * height * 4`) plus
/// dimensions — ready for an `ImageData` + `putImageData`.
#[wasm_bindgen]
pub struct RenderedFrame {
    width: u32,
    height: u32,
    pixels: Vec<u8>,
}

#[wasm_bindgen]
impl RenderedFrame {
    #[wasm_bindgen(getter)]
    pub fn width(&self) -> u32 {
        self.width
    }

    #[wasm_bindgen(getter)]
    pub fn height(&self) -> u32 {
        self.height
    }

    #[wasm_bindgen(getter)]
    pub fn pixels(&self) -> Vec<u8> {
        self.pixels.clone()
    }
}

/// The GPU engine: holds a Vello renderer bound to a WebGPU device. Build it
/// once with [`VelloEngine::create`] (async — it acquires the GPU), then reuse
/// it across frames.
#[wasm_bindgen]
pub struct VelloEngine {
    renderer: VelloRenderer,
}

#[wasm_bindgen]
impl VelloEngine {
    /// Acquire a WebGPU device and build the renderer. Async (returns a JS
    /// `Promise`); rejects when WebGPU is unavailable so the caller can fall
    /// back to the CPU engine or Canvas2D.
    pub async fn create() -> Result<VelloEngine, JsError> {
        console_error_panic_hook::set_once();
        match VelloRenderer::new_async().await {
            Some(renderer) => Ok(VelloEngine { renderer }),
            None => Err(JsError::new(
                "WebGPU is not available in this browser/context",
            )),
        }
    }

    /// Render a scene-graph JSON document (onda-scene format) to a frame.
    /// Async: the GPU readback awaits the buffer map rather than blocking.
    pub async fn render(&mut self, scene_json: String) -> Result<RenderedFrame, JsError> {
        let scene: Scene =
            serde_json::from_str(&scene_json).map_err(|e| JsError::new(&e.to_string()))?;
        let frame = self.renderer.render_async(&scene).await;
        Ok(RenderedFrame {
            width: frame.width,
            height: frame.height,
            pixels: frame.pixels,
        })
    }
}
