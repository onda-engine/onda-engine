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
use onda_renderer::{FontContext, Renderer, TextMetrics};
use onda_scene::{Scene, Text};
use onda_typography::{FontMetrics, StyledRun};
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

/// Whether any node carries a flex layout (skip the layout pass + clone otherwise).
fn has_layout(scene: &Scene) -> bool {
    fn walk(node: &onda_scene::Node) -> bool {
        node.layout.is_some() || node.children.iter().any(walk)
    }
    walk(&scene.root)
}

/// Whether any node is an image or video (skip the decode pass otherwise).
fn has_images(scene: &Scene) -> bool {
    fn walk(node: &onda_scene::Node) -> bool {
        matches!(
            node.kind,
            onda_scene::NodeKind::Image(_) | onda_scene::NodeKind::Video(_)
        ) || node.children.iter().any(walk)
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

/// Rendered text dimensions ([`onda_renderer::TextMetrics`]) for JS — what a
/// component needs to size things to the *actual* text (proportional advance,
/// ascent/descent) instead of a glyph-count guess. Pixels at the measured size.
#[wasm_bindgen]
pub struct TextMetricsJs {
    inner: TextMetrics,
}

#[wasm_bindgen]
impl TextMetricsJs {
    /// Shaped advance width — the true rendered width of the string.
    #[wasm_bindgen(getter)]
    pub fn width(&self) -> f32 {
        self.inner.width
    }
    /// Total laid-out height (line height × line count).
    #[wasm_bindgen(getter)]
    pub fn height(&self) -> f32 {
        self.inner.height
    }
    /// Top of the line box to the baseline.
    #[wasm_bindgen(getter)]
    pub fn ascent(&self) -> f32 {
        self.inner.ascent
    }
    /// Baseline to the bottom of the line box.
    #[wasm_bindgen(getter)]
    pub fn descent(&self) -> f32 {
        self.inner.descent
    }
    /// Baseline-to-baseline line height.
    #[wasm_bindgen(getter, js_name = lineHeight)]
    pub fn line_height(&self) -> f32 {
        self.inner.line_height
    }
}

/// Font-level vertical metrics exposed to JS — distances in pixels at the
/// measured font size. Returned by [`OndaEngine::font_metrics`].
#[wasm_bindgen]
pub struct FontMetricsJs {
    inner: FontMetrics,
}

#[wasm_bindgen]
impl FontMetricsJs {
    /// Distance from the node's `y` to the top of capital letters (px).
    #[wasm_bindgen(getter)]
    pub fn cap_top(&self) -> f32 {
        self.inner.cap_top
    }
    /// Height of capital letters (top of caps to baseline, px).
    #[wasm_bindgen(getter)]
    pub fn cap_height(&self) -> f32 {
        self.inner.cap_height
    }
    /// Distance from the node's `y` to the top of lowercase x (px).
    #[wasm_bindgen(getter)]
    pub fn x_top(&self) -> f32 {
        self.inner.x_top
    }
    /// x-height in px (top of 'x' to baseline).
    #[wasm_bindgen(getter)]
    pub fn x_height(&self) -> f32 {
        self.inner.x_height
    }
    /// Distance from node's `y` to the baseline (same as `TextMetrics.ascent`, px).
    #[wasm_bindgen(getter)]
    pub fn ascent(&self) -> f32 {
        self.inner.ascent
    }
    /// Baseline to bottom of the line box (px).
    #[wasm_bindgen(getter)]
    pub fn descent(&self) -> f32 {
        self.inner.descent
    }
    /// Baseline-to-baseline line height (px).
    #[wasm_bindgen(getter, js_name = lineHeight)]
    pub fn line_height(&self) -> f32 {
        self.inner.line_height
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

    /// Load an additional font (`.ttf`/`.otf` bytes) so text can select it by
    /// family (e.g. a brand display face for kinetic typography). Returns the
    /// family name(s) it provides, newline-joined. Loaded into BOTH the renderer
    /// (which draws the glyphs) and the layout/measurement font context, so
    /// author-time `measureText`/`glyphLayout`/`fontMetrics` — and therefore
    /// `<TextAnimator>`/`KineticText` glyph placement — match what the engine
    /// draws. This is the custom-font parity guarantee: same bytes, same shaping,
    /// for measure and render. Mirrors `VelloEngine::load_font`.
    #[wasm_bindgen(js_name = loadFont)]
    pub fn load_font(&mut self, data: Vec<u8>) -> String {
        let families = self.renderer.load_font(data.clone());
        self.fonts.borrow_mut().load_font(data);
        families.join("\n")
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

    /// World-space (canvas-coordinate) bounds of every identified node in a scene —
    /// the geometry a host's selection overlay needs to put its boxes exactly where
    /// the engine drew each element (re-frames, layout, and animation transforms all
    /// already applied). Runs the SAME flex-layout pre-pass as `render` so laid-out
    /// components report their resolved boxes; skips image decode (bounds use the
    /// layout box). Returns a flat `Float64Array`: `[id, x, y, width, height, …]`
    /// (one 5-tuple per identified node). Pair with `render` for the same frame.
    #[wasm_bindgen(js_name = elementBounds)]
    pub fn element_bounds(&mut self, scene_json: &str) -> Result<Vec<f64>, JsError> {
        let mut scene: Scene =
            serde_json::from_str(scene_json).map_err(|e| JsError::new(&e.to_string()))?;
        if has_layout(&scene) {
            let measure = |t: &Text| measure_text(&mut self.fonts.borrow_mut(), t);
            scene = onda_layout::layout(&scene, &measure);
        }
        let bounds = self.renderer.id_bounds(&scene);
        let mut out = Vec::with_capacity(bounds.len() * 5);
        for (id, x0, y0, x1, y1) in bounds {
            out.push(id as f64);
            out.push(x0 as f64);
            out.push(y0 as f64);
            out.push((x1 - x0) as f64);
            out.push((y1 - y0) as f64);
        }
        Ok(out)
    }

    /// Measure `content` at `font_size` (px) with optional family / weight /
    /// italic, returning its [`TextMetricsJs`]. The same shaping the engine draws,
    /// so a component can size underlines/pills/carets to the real text — in both
    /// the browser preview and (warmed once) the Node export path.
    #[wasm_bindgen(js_name = measureText)]
    pub fn measure_text(
        &self,
        content: &str,
        font_size: f32,
        family: Option<String>,
        weight: Option<u16>,
        italic: Option<bool>,
        letter_spacing: Option<f32>,
    ) -> TextMetricsJs {
        let inner = self.fonts.borrow_mut().measure_with(
            content,
            font_size,
            family.as_deref(),
            weight.unwrap_or(400),
            italic.unwrap_or(false),
            letter_spacing.unwrap_or(0.0),
        );
        TextMetricsJs { inner }
    }

    /// Font-level vertical metrics for `font_size` + optional family/weight/italic.
    /// Derived by rasterizing 'H' (cap height) and 'x' (x-height) — pixel-accurate
    /// for the actual rendered font. Call once per (size, family, weight) combo, not
    /// per frame. Use the returned `capTop`/`capHeight` to vertically center text
    /// without empirical guesswork.
    #[wasm_bindgen(js_name = fontMetrics)]
    pub fn font_metrics(
        &self,
        font_size: f32,
        family: Option<String>,
        weight: Option<u16>,
        italic: Option<bool>,
    ) -> FontMetricsJs {
        let inner = self.fonts.borrow_mut().font_metrics_with(
            font_size,
            family.as_deref(),
            weight.unwrap_or(400),
            italic.unwrap_or(false),
        );
        FontMetricsJs { inner }
    }

    /// Kerning-aware glyph layout for `content` at `font_size`. Returns a
    /// `Float32Array` with 4 floats per cluster: `[start_byte, end_byte, x, advance]`.
    /// Unlike calling `measureText` per character, `advance` includes kern pairs.
    /// Slice with stride 4; the total advance sum equals the shaped line width.
    #[wasm_bindgen(js_name = glyphLayout)]
    pub fn glyph_layout(
        &self,
        content: &str,
        font_size: f32,
        family: Option<String>,
        weight: Option<u16>,
        italic: Option<bool>,
        letter_spacing: Option<f32>,
    ) -> Vec<f32> {
        let glyphs = self.fonts.borrow_mut().glyph_layout_with(
            content,
            font_size,
            family.as_deref(),
            weight.unwrap_or(400),
            italic.unwrap_or(false),
            letter_spacing.unwrap_or(0.0),
        );
        let mut out = Vec::with_capacity(glyphs.len() * 4);
        for g in glyphs {
            out.push(g.start as f32);
            out.push(g.end as f32);
            out.push(g.x);
            out.push(g.advance);
        }
        out
    }
}
