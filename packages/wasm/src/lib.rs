//! WebAssembly bindings for the ONDA renderer.
//!
//! This is the real Rust engine — the same `onda-renderer` + cosmic-text that
//! `onda export` uses — compiled to wasm and called from JavaScript. No DOM, no
//! Chromium: the browser just hands over a canvas to blit RGBA into. So a browser
//! preview built on this is pixel-identical to the native/CLI render.
//!
//! The crate is empty on non-wasm targets so it never touches the native build.
#![cfg(target_arch = "wasm32")]

use onda_renderer::Renderer;
use onda_scene::Scene;
use wasm_bindgen::prelude::*;

/// A rendered frame: RGBA8 pixels plus dimensions.
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

    /// Straight-alpha RGBA8 bytes (`width * height * 4`), ready for an
    /// `ImageData` and `putImageData`.
    #[wasm_bindgen(getter)]
    pub fn pixels(&self) -> Vec<u8> {
        self.pixels.clone()
    }
}

/// The engine: holds a renderer (with the bundled default font) and rasterizes
/// scene-graph JSON to frames. Construct once and reuse across frames.
#[wasm_bindgen]
pub struct OndaEngine {
    renderer: Renderer,
}

#[wasm_bindgen]
impl OndaEngine {
    // The JS constructor must be `new`; a `Default` impl wouldn't be exported.
    #[allow(clippy::new_without_default)]
    #[wasm_bindgen(constructor)]
    pub fn new() -> OndaEngine {
        console_error_panic_hook::set_once();
        OndaEngine {
            renderer: Renderer::with_default_font(),
        }
    }

    /// Render a scene-graph JSON document (onda-scene format) to a frame.
    pub fn render(&mut self, scene_json: &str) -> Result<RenderedFrame, JsError> {
        let scene: Scene =
            serde_json::from_str(scene_json).map_err(|e| JsError::new(&e.to_string()))?;
        let framebuffer = self.renderer.render(&scene);
        Ok(RenderedFrame {
            width: framebuffer.width(),
            height: framebuffer.height(),
            pixels: framebuffer.as_bytes().to_vec(),
        })
    }
}
