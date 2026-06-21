//! WebAssembly bindings for the ONDA **Vello (GPU)** renderer.
//!
//! This runs the *real* GPU vector renderer — `onda-vello` (Vello 0.3 / wgpu 22)
//! — in the browser over **WebGPU**, with no DOM and no Chromium. Unlike the CPU
//! `@onda-engine/wasm` engine, it draws the full vector feature set (anti-aliased
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

use std::cell::RefCell;
use std::path::Path;

use onda_core::Size;
use onda_scene::{Scene, Text};
use onda_typography::{FontContext, StyledRun};
use onda_vello::VelloRenderer;
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
            letter_spacing: text.letter_spacing,
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

/// Whether any node carries a flex layout (so we skip the layout pass — and its
/// clone — when nothing needs it; matters for real-time per-frame playback).
fn has_layout(scene: &Scene) -> bool {
    fn walk(node: &onda_scene::Node) -> bool {
        node.layout.is_some() || node.children.iter().any(walk)
    }
    walk(&scene.root)
}

/// Whether any node is an image or video (so we skip the decode pass otherwise).
fn has_images(scene: &Scene) -> bool {
    fn walk(node: &onda_scene::Node) -> bool {
        matches!(
            node.kind,
            onda_scene::NodeKind::Image(_) | onda_scene::NodeKind::Video(_)
        ) || node.children.iter().any(walk)
    }
    walk(&scene.root)
}

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
    /// Bundled font context, used to measure text during the layout pass.
    fonts: RefCell<FontContext>,
}

#[wasm_bindgen]
impl VelloEngine {
    /// Acquire a WebGPU device and build the renderer. Async (returns a JS
    /// `Promise`); rejects when WebGPU is unavailable so the caller can fall
    /// back to the CPU engine or Canvas2D.
    pub async fn create() -> Result<VelloEngine, JsError> {
        console_error_panic_hook::set_once();
        match VelloRenderer::try_new_async().await {
            Ok(renderer) => Ok(VelloEngine {
                renderer,
                fonts: RefCell::new(FontContext::with_default_font()),
            }),
            Err(reason) => Err(JsError::new(&format!("WebGPU init failed: {reason}"))),
        }
    }

    /// Load an additional font (`.ttf`/`.otf` bytes) so text can select it by
    /// family (e.g. a premium display face for Apple-tier type). Returns the
    /// family name(s) it provides, newline-joined. Loaded into BOTH the renderer
    /// (which draws the glyphs) and the layout/measurement font context, so the
    /// in-browser preview's text metrics match what it draws.
    pub fn load_font(&mut self, data: Vec<u8>) -> String {
        let families = self.renderer.load_font(data.clone());
        self.fonts.borrow_mut().load_font(data);
        families.join("\n")
    }

    /// Render a scene-graph JSON document (onda-scene format) to a frame.
    /// Resolves `data:` images and flex layout first (the same pre-passes the
    /// CLI runs), so an in-browser preview matches `onda export`. Async: the GPU
    /// readback awaits the buffer map rather than blocking.
    pub async fn render(&mut self, scene_json: String) -> Result<RenderedFrame, JsError> {
        let mut scene: Scene =
            serde_json::from_str(&scene_json).map_err(|e| JsError::new(&e.to_string()))?;
        // Decode any data:/embedded images (no filesystem in the browser).
        if has_images(&scene) {
            scene = onda_image::load_images(&scene, Path::new(""))
                .map_err(|e| JsError::new(&e.to_string()))?;
        }
        // Resolve flex layout to absolute transforms, measuring text with our fonts.
        if has_layout(&scene) {
            let measure = |t: &Text| measure_text(&mut self.fonts.borrow_mut(), t);
            scene = onda_layout::layout(&scene, &measure);
        }
        let frame = self.renderer.render_async(&scene).await;
        Ok(RenderedFrame {
            width: frame.width,
            height: frame.height,
            pixels: frame.pixels,
        })
    }

    /// Flatten any NLE timeline to the active clip's plain Video at composition
    /// `frame`, returning the resolved scene JSON — the same resolution `onda
    /// export` runs natively. A preview host calls this BEFORE its video-decode
    /// step (to learn which clip + source-time to seek), then decodes and renders.
    /// No-op for scenes without a timeline.
    #[wasm_bindgen(js_name = resolveTimeline)]
    pub fn resolve_timeline(&self, scene_json: &str, frame: u32) -> Result<String, JsError> {
        let scene: Scene =
            serde_json::from_str(scene_json).map_err(|e| JsError::new(&e.to_string()))?;
        let fps = scene.composition.fps;
        let resolved = onda_scene::resolve_timeline(&scene, frame, fps);
        serde_json::to_string(&resolved).map_err(|e| JsError::new(&e.to_string()))
    }
}
