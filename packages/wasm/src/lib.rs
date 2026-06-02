//! WebAssembly bindings for the ONDA renderer.
//!
//! This is the real Rust engine — the same `onda-renderer` + cosmic-text that
//! `onda export` uses — compiled to wasm and called from JavaScript. No DOM, no
//! Chromium: the browser just hands over a canvas to blit RGBA into. So a browser
//! preview built on this is pixel-identical to the native/CLI render.
//!
//! The crate is empty on non-wasm targets so it never touches the native build.
#![cfg(target_arch = "wasm32")]

use std::cell::RefCell;
use std::path::Path;

use onda_core::Size;
use onda_renderer::{FontContext, Renderer};
use onda_scene::{Scene, Text};
use onda_typography::StyledRun;
use wasm_bindgen::prelude::*;

/// Measure a text node's rendered size for the layout pass (matches the CLI).
fn measure_text(fonts: &mut FontContext, text: &Text) -> Size {
    let runs = text.resolved_runs();
    let styled: Vec<StyledRun> = runs
        .iter()
        .map(|r| StyledRun {
            text: &r.text,
            font_size: r.font_size,
            color: [0.0, 0.0, 0.0, 1.0],
            family: r.font_family.as_deref(),
            weight: r.weight,
            italic: r.italic,
        })
        .collect();
    let layout = fonts.layout_rich(&styled);
    if layout.glyphs.is_empty() {
        return Size::ZERO;
    }
    let max_x = layout.glyphs.iter().map(|g| g.x).fold(0.0_f32, f32::max);
    let em = runs.iter().map(|r| r.font_size).fold(0.0_f32, f32::max);
    Size::new(max_x + em * 0.55, em * 1.25)
}

/// Whether any node carries a flex layout (skip the layout pass + clone otherwise).
fn has_layout(scene: &Scene) -> bool {
    fn walk(node: &onda_scene::Node) -> bool {
        node.layout.is_some() || node.children.iter().any(walk)
    }
    walk(&scene.root)
}

/// Whether any node is an image (skip the decode pass otherwise).
fn has_images(scene: &Scene) -> bool {
    fn walk(node: &onda_scene::Node) -> bool {
        matches!(node.kind, onda_scene::NodeKind::Image(_)) || node.children.iter().any(walk)
    }
    walk(&scene.root)
}

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
    /// Bundled font context, used to measure text during the layout pass.
    fonts: RefCell<FontContext>,
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
            fonts: RefCell::new(FontContext::with_default_font()),
        }
    }

    /// Render a scene-graph JSON document (onda-scene format) to a frame.
    /// Resolves `data:` images and flex layout first (the same pre-passes the
    /// CLI runs), so an in-browser preview matches `onda export`.
    pub fn render(&mut self, scene_json: &str) -> Result<RenderedFrame, JsError> {
        let mut scene: Scene =
            serde_json::from_str(scene_json).map_err(|e| JsError::new(&e.to_string()))?;
        if has_images(&scene) {
            scene = onda_image::load_images(&scene, Path::new(""))
                .map_err(|e| JsError::new(&e.to_string()))?;
        }
        if has_layout(&scene) {
            let measure = |t: &Text| measure_text(&mut self.fonts.borrow_mut(), t);
            scene = onda_layout::layout(&scene, &measure);
        }
        let framebuffer = self.renderer.render(&scene);
        Ok(RenderedFrame {
            width: framebuffer.width(),
            height: framebuffer.height(),
            pixels: framebuffer.as_bytes().to_vec(),
        })
    }
}
