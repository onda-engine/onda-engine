//! ONDA renderer — CPU reference rasterizer.
//!
//! It walks a [`Scene`] and produces an in-memory RGBA8 [`Framebuffer`] on the
//! CPU — no GPU — so it renders anywhere (headless servers, CI, browsers without
//! WebGPU via `@onda/wasm`) and pins down the scene-graph → pixels *contract*
//! (transform/opacity inheritance, src-over compositing, coordinate conventions)
//! deterministically.
//!
//! Shapes — rects, rounded rects, ellipses and arbitrary SVG paths, with solid or
//! linear/radial gradient fills and strokes, anti-aliased — are rasterized by
//! [`tiny_skia`] (the pure-Rust Skia raster pipeline behind resvg) into a temp
//! pixmap and composited into the framebuffer. Images blit per [`ImageFit`]; text
//! composites `onda-typography` coverage masks when the [`Renderer`] has a
//! [`FontContext`]. Deferred (Vello/GPU only): rotation ([`Transform::then`]
//! drops it on the CPU path), clipping, blend modes, and blur/filter passes.
//!
//! Coordinate convention: pixel space, origin top-left, +x right, +y down. A
//! shape's geometry is authored in its own local space with origin at top-left;
//! the node's (composed) transform places it on the canvas.

use kurbo::{BezPath, PathEl, Shape as _};
use onda_core::{Color, Transform, Vec2};
use onda_scene::{
    Gradient, GradientStop, ImageData, ImageFit, Node, NodeKind, Scene, Shape, ShapeGeometry, Text,
};
pub use onda_typography::{FontContext, TextMetrics, TextRaster};
use tiny_skia as tsk;

/// An RGBA8 image: `width * height * 4` bytes, row-major, top-left origin.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Framebuffer {
    width: u32,
    height: u32,
    pixels: Vec<u8>,
}

impl Framebuffer {
    /// A fully transparent framebuffer.
    pub fn new(width: u32, height: u32) -> Self {
        Framebuffer {
            width,
            height,
            pixels: vec![0; (width as usize) * (height as usize) * 4],
        }
    }

    /// Wrap raw straight-alpha RGBA8 bytes (row-major, top-left origin) as a
    /// framebuffer — e.g. a frame read back from a GPU backend. Panics if
    /// `pixels.len()` isn't exactly `width * height * 4`.
    pub fn from_rgba(width: u32, height: u32, pixels: Vec<u8>) -> Self {
        let expected = (width as usize) * (height as usize) * 4;
        assert_eq!(
            pixels.len(),
            expected,
            "expected {expected} RGBA bytes for {width}x{height}, got {}",
            pixels.len()
        );
        Framebuffer {
            width,
            height,
            pixels,
        }
    }

    /// A framebuffer flood-filled with `color`.
    pub fn filled(width: u32, height: u32, color: Color) -> Self {
        let [r, g, b, a] = color.to_rgba8();
        let mut pixels = Vec::with_capacity((width as usize) * (height as usize) * 4);
        for _ in 0..(width as usize) * (height as usize) {
            pixels.extend_from_slice(&[r, g, b, a]);
        }
        Framebuffer {
            width,
            height,
            pixels,
        }
    }

    pub fn width(&self) -> u32 {
        self.width
    }

    pub fn height(&self) -> u32 {
        self.height
    }

    /// Raw RGBA8 bytes (row-major, top-left origin).
    pub fn as_bytes(&self) -> &[u8] {
        &self.pixels
    }

    /// The `[r, g, b, a]` at `(x, y)`. Panics if out of bounds.
    pub fn pixel(&self, x: u32, y: u32) -> [u8; 4] {
        let i = self.index(x, y);
        [
            self.pixels[i],
            self.pixels[i + 1],
            self.pixels[i + 2],
            self.pixels[i + 3],
        ]
    }

    fn index(&self, x: u32, y: u32) -> usize {
        assert!(
            x < self.width && y < self.height,
            "pixel ({x}, {y}) out of bounds"
        );
        ((y as usize) * (self.width as usize) + (x as usize)) * 4
    }

    /// Composite `src` over the existing pixel at `(x, y)` (straight-alpha
    /// src-over). No-op if out of bounds, so callers can rasterize freely.
    fn blend(&mut self, x: u32, y: u32, src: Color) {
        if x >= self.width || y >= self.height || src.a <= 0.0 {
            return;
        }
        let i = self.index(x, y);
        let dst = Color::from_rgba8(
            self.pixels[i],
            self.pixels[i + 1],
            self.pixels[i + 2],
            self.pixels[i + 3],
        );
        let out = over(src, dst).to_rgba8();
        self.pixels[i..i + 4].copy_from_slice(&out);
    }

    /// A new framebuffer holding the `[x, y, w, h]` sub-rectangle, clamped to the
    /// framebuffer's bounds (an over-large region just yields what exists). Used by
    /// the agent-vision zoom (`onda render-frame --crop`) and frame tiling.
    pub fn crop(&self, x: u32, y: u32, w: u32, h: u32) -> Framebuffer {
        let x = x.min(self.width);
        let y = y.min(self.height);
        let w = w.min(self.width - x);
        let h = h.min(self.height - y);
        let row_bytes = (w as usize) * 4;
        let mut pixels = Vec::with_capacity((h as usize) * row_bytes);
        for row in 0..h as usize {
            let start = (((y as usize) + row) * (self.width as usize) + (x as usize)) * 4;
            pixels.extend_from_slice(&self.pixels[start..start + row_bytes]);
        }
        Framebuffer::from_rgba(w, h, pixels)
    }
}

#[cfg(feature = "png")]
impl Framebuffer {
    /// Encode and write the framebuffer as a straight-alpha RGBA8 PNG.
    ///
    /// Available with the `png` feature. Encoding lives behind a feature so the
    /// renderer's default build stays free of image-codec dependencies.
    pub fn write_png(&self, path: impl AsRef<std::path::Path>) -> Result<(), png::EncodingError> {
        let file = std::io::BufWriter::new(std::fs::File::create(path)?);
        let mut encoder = png::Encoder::new(file, self.width, self.height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header()?;
        writer.write_image_data(&self.pixels)?;
        Ok(())
    }
}

/// Encode a sequence of equally-sized frames as an animated GIF (looping).
///
/// Available with the `gif` feature. Pure Rust — no external tools — so it is
/// the portable, deterministic video-export path. `fps` sets the playback rate;
/// GIF delays have centisecond resolution, so very high fps is approximated.
#[cfg(feature = "gif")]
pub fn encode_gif<W: std::io::Write>(
    frames: &[Framebuffer],
    fps: f32,
    out: W,
) -> std::io::Result<()> {
    let Some(first) = frames.first() else {
        return Err(std::io::Error::other("no frames to encode"));
    };
    let width = u16::try_from(first.width).map_err(std::io::Error::other)?;
    let height = u16::try_from(first.height).map_err(std::io::Error::other)?;
    let delay = if fps > 0.0 {
        (100.0 / fps).round().max(1.0) as u16
    } else {
        10
    };

    let mut encoder = gif::Encoder::new(out, width, height, &[]).map_err(std::io::Error::other)?;
    encoder
        .set_repeat(gif::Repeat::Infinite)
        .map_err(std::io::Error::other)?;
    for frame in frames {
        if frame.width != first.width || frame.height != first.height {
            return Err(std::io::Error::other(
                "all frames must share the same dimensions",
            ));
        }
        let mut rgba = frame.pixels.clone();
        // speed 10 balances quantization quality against encode time (1=best, 30=fastest).
        let mut gif_frame = gif::Frame::from_rgba_speed(width, height, &mut rgba, 10);
        gif_frame.delay = delay;
        encoder
            .write_frame(&gif_frame)
            .map_err(std::io::Error::other)?;
    }
    Ok(())
}

/// Straight-alpha "source over destination" Porter-Duff compositing.
fn over(src: Color, dst: Color) -> Color {
    let out_a = src.a + dst.a * (1.0 - src.a);
    if out_a <= 0.0 {
        return Color::TRANSPARENT;
    }
    let blend = |s: f32, d: f32| (s * src.a + d * dst.a * (1.0 - src.a)) / out_a;
    Color::new(
        blend(src.r, dst.r),
        blend(src.g, dst.g),
        blend(src.b, dst.b),
        out_a,
    )
}

/// Walks a [`Scene`] into a [`Framebuffer`]. Holds an optional [`FontContext`];
/// without one, text nodes are skipped (everything else still renders). Construct
/// once and reuse across frames — building a system [`FontContext`] is not cheap.
pub struct Renderer {
    fonts: Option<FontContext>,
}

impl Renderer {
    /// A renderer that cannot draw text (no fonts). Shapes still render.
    pub fn new() -> Self {
        Renderer { fonts: None }
    }

    /// A renderer using the host's installed fonts, able to draw text.
    pub fn with_system_fonts() -> Self {
        Renderer {
            fonts: Some(FontContext::with_system_fonts()),
        }
    }

    /// A renderer using the bundled default font — draws text deterministically
    /// (same scene in, same pixels out, on any machine). Recommended default.
    pub fn with_default_font() -> Self {
        Renderer {
            fonts: Some(FontContext::with_default_font()),
        }
    }

    /// A renderer using a caller-provided font context.
    pub fn with_fonts(fonts: FontContext) -> Self {
        Renderer { fonts: Some(fonts) }
    }

    /// Load an additional font (`.ttf`/`.otf` bytes), returning the family
    /// name(s) it provides — select them by family on a `Text`/run. A renderer
    /// with no font context gains the bundled default first, so loaded fonts
    /// always have a default to fall back to.
    pub fn load_font(&mut self, data: Vec<u8>) -> Vec<String> {
        self.fonts
            .get_or_insert_with(FontContext::with_default_font)
            .load_font(data)
    }

    /// Render `scene` to a fresh, transparent framebuffer sized to its composition.
    pub fn render(&mut self, scene: &Scene) -> Framebuffer {
        let mut fb = Framebuffer::new(scene.composition.width, scene.composition.height);
        self.render_node(&mut fb, &scene.root, Transform::IDENTITY, 1.0);
        fb
    }

    fn render_node(
        &mut self,
        fb: &mut Framebuffer,
        node: &Node,
        parent: Transform,
        parent_opacity: f32,
    ) {
        let transform = parent.then(&node.transform);
        let opacity = parent_opacity * node.opacity;

        match &node.kind {
            NodeKind::Group => {}
            NodeKind::Shape(shape) => rasterize_shape(fb, shape, transform, opacity),
            NodeKind::Text(text) => self.rasterize_text(fb, text, transform, opacity),
            // Draws the decoded pixels (attached by the onda-image pass); an
            // unresolved image (no pixels) is skipped. A Video draws its current
            // frame the same way — pixels attached by a decode pass.
            NodeKind::Image(image) => rasterize_image(
                fb,
                image.data.as_ref(),
                image.width,
                image.height,
                image.fit,
                transform,
                opacity,
            ),
            NodeKind::Video(video) => rasterize_image(
                fb,
                video.data.as_ref(),
                video.width,
                video.height,
                video.fit,
                transform,
                opacity,
            ),
            // Audio is non-visual — the player plays it; the renderer skips it.
            NodeKind::Audio(_) => {}
            // SVG nodes are expanded to shapes (onda-svg) before rendering; the
            // CPU backend can't draw paths anyway, so an unexpanded one is a no-op.
            NodeKind::Svg(_) => {}
        }

        for child in &node.children {
            self.render_node(fb, child, transform, opacity);
        }
    }

    fn rasterize_text(
        &mut self,
        fb: &mut Framebuffer,
        text: &Text,
        transform: Transform,
        opacity: f32,
    ) {
        let base_alpha = text.color.a * opacity;
        if base_alpha <= 0.0 {
            return;
        }
        let Some(fonts) = self.fonts.as_mut() else {
            return; // no fonts loaded -> text is skipped
        };
        // Rich runs render per-run color/size on the GPU (Vello) backend; the CPU
        // reference draws their concatenated text in the node's color/size.
        let content = if text.runs.is_empty() {
            text.content.clone()
        } else {
            text.runs
                .iter()
                .map(|r| r.text.as_str())
                .collect::<String>()
        };
        let Some(raster) = fonts.rasterize_with(
            &content,
            text.font_size,
            text.font_family.as_deref(),
            text.weight.unwrap_or(400),
            text.italic.unwrap_or(false),
        ) else {
            return;
        };

        // v0 honors translation; non-unit scale/rotation of text is deferred.
        let origin_x = transform.translate.x.round() as i32;
        let origin_y = transform.translate.y.round() as i32;

        for ty in 0..raster.height {
            for tx in 0..raster.width {
                let coverage = raster.coverage_at(tx, ty);
                if coverage == 0 {
                    continue;
                }
                let src = Color::new(
                    text.color.r,
                    text.color.g,
                    text.color.b,
                    (coverage as f32 / 255.0) * base_alpha,
                );
                let px = origin_x + raster.offset_x + tx as i32;
                let py = origin_y + raster.offset_y + ty as i32;
                if px >= 0 && py >= 0 {
                    fb.blend(px as u32, py as u32, src);
                }
            }
        }
    }
}

impl Default for Renderer {
    fn default() -> Self {
        Renderer::new()
    }
}

/// Render a scene with no fonts (shapes only; text is skipped). Convenience for
/// shape-only or fully headless rendering; use [`Renderer::with_system_fonts`] to
/// draw text.
pub fn render(scene: &Scene) -> Framebuffer {
    Renderer::new().render(scene)
}

/// Render many scenes in parallel across CPU cores, returning frames in input
/// order. Offline rendering is a pure function of the scene, so it parallelizes
/// cleanly; `make_renderer` is called once per worker thread (each gets its own
/// font context, since cosmic-text isn't shareable). Available with the
/// `parallel` feature.
#[cfg(feature = "parallel")]
pub fn render_frames_parallel<F>(scenes: &[Scene], make_renderer: F) -> Vec<Framebuffer>
where
    F: Fn() -> Renderer + Sync + Send,
{
    use rayon::prelude::*;
    scenes
        .par_iter()
        .map_init(make_renderer, |renderer, scene| renderer.render(scene))
        .collect()
}

/// onda `Color` (straight-alpha, 0..1) → tiny-skia color.
fn skia_color(c: Color) -> tsk::Color {
    tsk::Color::from_rgba(
        c.r.clamp(0.0, 1.0),
        c.g.clamp(0.0, 1.0),
        c.b.clamp(0.0, 1.0),
        c.a.clamp(0.0, 1.0),
    )
    .unwrap_or(tsk::Color::TRANSPARENT)
}

/// Composed onda transform → tiny-skia. Translate + scale only: `Transform::then`
/// drops rotation, so the CPU path never carries it (Vello rotates on the GPU).
fn skia_transform(t: Transform) -> tsk::Transform {
    tsk::Transform::from_row(t.scale.x, 0.0, 0.0, t.scale.y, t.translate.x, t.translate.y)
}

/// A kurbo Bézier path → tiny-skia path (used for rounded rects + SVG path data).
fn kurbo_to_skia(bez: &BezPath) -> Option<tsk::Path> {
    let mut pb = tsk::PathBuilder::new();
    for el in bez.elements() {
        match el {
            PathEl::MoveTo(p) => pb.move_to(p.x as f32, p.y as f32),
            PathEl::LineTo(p) => pb.line_to(p.x as f32, p.y as f32),
            PathEl::QuadTo(c, p) => pb.quad_to(c.x as f32, c.y as f32, p.x as f32, p.y as f32),
            PathEl::CurveTo(a, b, p) => pb.cubic_to(
                a.x as f32, a.y as f32, b.x as f32, b.y as f32, p.x as f32, p.y as f32,
            ),
            PathEl::ClosePath => pb.close(),
        }
    }
    pb.finish()
}

/// Build the tiny-skia path for a geometry, in the shape's LOCAL space (origin
/// top-left). Rounded rects + SVG paths route through kurbo; plain rects/ellipses
/// use tiny-skia builders directly.
fn build_path(geometry: &ShapeGeometry) -> Option<tsk::Path> {
    match geometry {
        ShapeGeometry::Rect {
            size,
            corner_radius,
        } => {
            let (w, h) = (size.width, size.height);
            if !(w > 0.0 && h > 0.0) {
                return None;
            }
            let r = corner_radius.clamp(0.0, w.min(h) / 2.0);
            if r <= 0.0 {
                let mut pb = tsk::PathBuilder::new();
                pb.push_rect(tsk::Rect::from_xywh(0.0, 0.0, w, h)?);
                pb.finish()
            } else {
                let rr = kurbo::RoundedRect::new(0.0, 0.0, w as f64, h as f64, r as f64);
                kurbo_to_skia(&rr.to_path(0.1))
            }
        }
        ShapeGeometry::Ellipse { size } => {
            let (w, h) = (size.width, size.height);
            if !(w > 0.0 && h > 0.0) {
                return None;
            }
            let mut pb = tsk::PathBuilder::new();
            pb.push_oval(tsk::Rect::from_xywh(0.0, 0.0, w, h)?);
            pb.finish()
        }
        // Arbitrary SVG path data, parsed by kurbo (handles abs/rel + arcs).
        ShapeGeometry::Path { data } => kurbo_to_skia(&BezPath::from_svg(data).ok()?),
    }
}

/// A gradient → tiny-skia shader. The gradient's points are in the shape's LOCAL
/// space; the shader transform is identity because `fill_path`'s transform (the
/// canvas matrix) already maps both the path AND the shader local→device — the
/// analog of Vello filling with `brush_transform: None`.
fn gradient_shader(gradient: &Gradient) -> Option<tsk::Shader<'static>> {
    let to_stops = |stops: &[GradientStop]| -> Vec<tsk::GradientStop> {
        stops
            .iter()
            .map(|s| tsk::GradientStop::new(s.offset, skia_color(s.color)))
            .collect()
    };
    match gradient {
        Gradient::Linear { start, end, stops } => tsk::LinearGradient::new(
            tsk::Point::from_xy(start.x, start.y),
            tsk::Point::from_xy(end.x, end.y),
            to_stops(stops),
            tsk::SpreadMode::Pad,
            tsk::Transform::identity(),
        ),
        Gradient::Radial {
            center,
            radius,
            stops,
        } => tsk::RadialGradient::new(
            tsk::Point::from_xy(center.x, center.y),
            tsk::Point::from_xy(center.x, center.y),
            *radius,
            to_stops(stops),
            tsk::SpreadMode::Pad,
            tsk::Transform::identity(),
        ),
    }
}

/// Rasterize a shape via tiny-skia (the Skia raster pipeline behind resvg):
/// anti-aliased fills, linear/radial gradients, strokes, rounded rects and SVG
/// paths. The shape is drawn into a temporary pixmap sized to its transformed
/// bounds, then composited (straight-alpha src-over, `opacity` folded in) into
/// the framebuffer — so text/image compositing is unchanged.
fn rasterize_shape(fb: &mut Framebuffer, shape: &Shape, transform: Transform, opacity: f32) {
    if opacity <= 0.0
        || (shape.fill.is_none() && shape.gradient.is_none() && shape.stroke.is_none())
    {
        return;
    }
    let Some(path) = build_path(&shape.geometry) else {
        return; // empty/invalid geometry, or unparseable path data
    };
    let ts = skia_transform(transform); // local → canvas
    let Some(dev_path) = path.clone().transform(ts) else {
        return;
    };

    // Canvas bounds of the transformed path, inflated by half the (scaled) stroke
    // width plus 1px for the AA fringe, then clamped to the framebuffer.
    let bounds = dev_path.bounds();
    let max_scale = transform.scale.x.abs().max(transform.scale.y.abs());
    let inflate = shape.stroke.as_ref().map_or(0.0, |s| s.width.max(0.0)) * max_scale * 0.5 + 1.0;
    let x0 = (bounds.left() - inflate).floor().max(0.0);
    let y0 = (bounds.top() - inflate).floor().max(0.0);
    let x1 = (bounds.right() + inflate).ceil().min(fb.width() as f32);
    let y1 = (bounds.bottom() + inflate).ceil().min(fb.height() as f32);
    if x1 <= x0 || y1 <= y0 {
        return; // fully off-canvas
    }
    let (ox, oy) = (x0 as u32, y0 as u32);
    let (pw, ph) = ((x1 - x0) as u32, (y1 - y0) as u32);
    if pw == 0 || ph == 0 {
        return;
    }
    let Some(mut pixmap) = tsk::Pixmap::new(pw, ph) else {
        return;
    };
    // local → temp-pixmap space (canvas, shifted by the pixmap's origin).
    let into_temp = tsk::Transform::from_translate(-x0, -y0).pre_concat(ts);

    // Fill (gradient wins over solid, matching the scene contract).
    if shape.gradient.is_some() || shape.fill.is_some() {
        let shader = match &shape.gradient {
            Some(g) => gradient_shader(g),
            None => shape.fill.map(|c| tsk::Shader::SolidColor(skia_color(c))),
        };
        if let Some(shader) = shader {
            let paint = tsk::Paint {
                shader,
                anti_alias: true,
                ..Default::default()
            };
            pixmap.fill_path(&path, &paint, tsk::FillRule::Winding, into_temp, None);
        }
    }
    // Stroke (solid; the scene `Stroke` is color + width).
    if let Some(stroke) = &shape.stroke {
        if stroke.width > 0.0 && stroke.color.a > 0.0 {
            let paint = tsk::Paint {
                shader: tsk::Shader::SolidColor(skia_color(stroke.color)),
                anti_alias: true,
                ..Default::default()
            };
            let sk_stroke = tsk::Stroke {
                width: stroke.width,
                ..Default::default()
            };
            pixmap.stroke_path(&path, &paint, &sk_stroke, into_temp, None);
        }
    }

    // Composite the temp pixmap (premultiplied) into the framebuffer (straight),
    // folding node opacity into each pixel's alpha.
    for ty in 0..ph {
        for tx in 0..pw {
            let Some(p) = pixmap.pixel(tx, ty) else {
                continue;
            };
            if p.alpha() == 0 {
                continue;
            }
            let c = p.demultiply();
            let color = Color::new(
                c.red() as f32 / 255.0,
                c.green() as f32 / 255.0,
                c.blue() as f32 / 255.0,
                (c.alpha() as f32 / 255.0) * opacity,
            );
            fb.blend(ox + tx, oy + ty, color);
        }
    }
}

/// Blit a decoded [`Image`] into the framebuffer. The image's box (its
/// `width`×`height` if set, else its natural pixel size) is mapped through
/// `transform` to an axis-aligned canvas box (translate + scale; no rotation);
/// each destination pixel samples the source per [`Image::fit`] (cover/contain/
/// fill), nearest-neighbor, composited straight-alpha with `opacity` folded in.
/// Rasterize decoded RGBA pixels into the optional `box_width`×`box_height` box
/// per `fit` — shared by Image and Video nodes (a video frame is just an image).
fn rasterize_image(
    fb: &mut Framebuffer,
    data: Option<&ImageData>,
    box_width: Option<f32>,
    box_height: Option<f32>,
    fit: ImageFit,
    transform: Transform,
    opacity: f32,
) {
    let Some(data) = data else {
        return; // unresolved (no pixels) — nothing to draw
    };
    if data.width == 0 || data.height == 0 || opacity <= 0.0 {
        return;
    }

    let (iw, ih) = (data.width as f32, data.height as f32);
    // The layout box the image fills (default: its intrinsic size).
    let (box_w, box_h) = match (box_width, box_height) {
        (Some(w), Some(h)) if w > 0.0 && h > 0.0 => (w, h),
        _ => (iw, ih),
    };
    // Source→box scale per fit mode, plus the centering offset of the scaled
    // image within the box (negative for cover, which overflows + crops).
    let (fsx, fsy) = match fit {
        ImageFit::Fill => (box_w / iw, box_h / ih),
        ImageFit::Cover => {
            let s = (box_w / iw).max(box_h / ih);
            (s, s)
        }
        ImageFit::Contain => {
            let s = (box_w / iw).min(box_h / ih);
            (s, s)
        }
    };
    let off_x = (box_w - iw * fsx) / 2.0;
    let off_y = (box_h - ih * fsy) / 2.0;

    // Destination box = the layout box mapped through the transform.
    let a = transform.apply(Vec2::ZERO);
    let b = transform.apply(Vec2::new(box_w, box_h));
    let (x0, x1) = (a.x.min(b.x), a.x.max(b.x));
    let (y0, y1) = (a.y.min(b.y), a.y.max(b.y));
    let (bw, bh) = ((x1 - x0).max(f32::EPSILON), (y1 - y0).max(f32::EPSILON));

    let px_min = x0.floor().max(0.0) as u32;
    let py_min = y0.floor().max(0.0) as u32;
    let px_max = (x1.ceil() as i64).clamp(0, fb.width() as i64) as u32;
    let py_max = (y1.ceil() as i64).clamp(0, fb.height() as i64) as u32;

    for py in py_min..py_max {
        for px in px_min..px_max {
            let (sx, sy) = (px as f32 + 0.5, py as f32 + 0.5);
            if sx < x0 || sx >= x1 || sy < y0 || sy >= y1 {
                continue;
            }
            // Map the destination pixel back into box space, then into the source
            // via the fit scale/offset. Samples outside the source (contain's
            // letterbox) are skipped → the backing shows through.
            let u = (sx - x0) / bw * box_w;
            let v = (sy - y0) / bh * box_h;
            let src_x = (u - off_x) / fsx;
            let src_y = (v - off_y) / fsy;
            if src_x < 0.0 || src_x >= iw || src_y < 0.0 || src_y >= ih {
                continue;
            }
            let ix = (src_x as i64).clamp(0, data.width as i64 - 1);
            let iy = (src_y as i64).clamp(0, data.height as i64 - 1);
            let i = (iy as usize * data.width as usize + ix as usize) * 4;
            let Some(texel) = data.rgba.get(i..i + 4) else {
                continue;
            };
            let src = Color::new(
                texel[0] as f32 / 255.0,
                texel[1] as f32 / 255.0,
                texel[2] as f32 / 255.0,
                texel[3] as f32 / 255.0,
            );
            let src = src.with_alpha(src.a * opacity);
            if src.a > 0.0 {
                fb.blend(px, py, src);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use onda_core::Size;
    use onda_scene::Composition;

    fn comp(w: u32, h: u32) -> Composition {
        Composition::new(w, h, 30.0, 1)
    }

    #[test]
    fn empty_scene_is_transparent_and_correctly_sized() {
        let fb = render(&Scene::new(comp(4, 3)));
        assert_eq!((fb.width(), fb.height()), (4, 3));
        assert!(fb.as_bytes().iter().all(|&b| b == 0));
    }

    #[test]
    fn crop_extracts_subrect_and_clamps_to_bounds() {
        // 4×4 where the red channel encodes x*10 + y, so each pixel is identifiable.
        let mut bytes = vec![0u8; 4 * 4 * 4];
        for y in 0..4u32 {
            for x in 0..4u32 {
                let i = ((y * 4 + x) * 4) as usize;
                bytes[i] = (x * 10 + y) as u8;
                bytes[i + 3] = 255;
            }
        }
        let fb = Framebuffer::from_rgba(4, 4, bytes);

        let c = fb.crop(1, 1, 2, 2);
        assert_eq!((c.width(), c.height()), (2, 2));
        assert_eq!(c.pixel(0, 0), [11, 0, 0, 255]); // src (1,1)
        assert_eq!(c.pixel(1, 0), [21, 0, 0, 255]); // src (2,1)
        assert_eq!(c.pixel(1, 1), [22, 0, 0, 255]); // src (2,2)

        // A region running past the edge is clamped to what exists.
        let c2 = fb.crop(3, 3, 10, 10);
        assert_eq!((c2.width(), c2.height()), (1, 1));
        assert_eq!(c2.pixel(0, 0), [33, 0, 0, 255]); // src (3,3)
    }

    #[test]
    fn full_canvas_rect_fills_every_pixel() {
        let red = Color::rgb(1.0, 0.0, 0.0);
        let scene = Scene::new(comp(8, 8)).with_root(
            Node::group().with_child(Node::shape(Shape::rect(Size::new(8.0, 8.0)).with_fill(red))),
        );
        let fb = render(&scene);
        for y in 0..8 {
            for x in 0..8 {
                assert_eq!(fb.pixel(x, y), [255, 0, 0, 255]);
            }
        }
    }

    #[test]
    fn rect_respects_translation() {
        let blue = Color::rgb(0.0, 0.0, 1.0);
        let shape = Node::shape(Shape::rect(Size::new(2.0, 2.0)).with_fill(blue)).with_transform(
            Transform {
                translate: Vec2::new(4.0, 4.0),
                scale: Vec2::splat(1.0),
                ..Transform::IDENTITY
            },
        );
        let fb = render(&Scene::new(comp(8, 8)).with_root(Node::group().with_child(shape)));
        assert_eq!(fb.pixel(5, 5), [0, 0, 255, 255]); // inside [4,6)x[4,6)
        assert_eq!(fb.pixel(0, 0), [0, 0, 0, 0]); // outside -> untouched
        assert_eq!(fb.pixel(6, 6), [0, 0, 0, 0]); // just past the far edge
    }

    #[test]
    fn scale_grows_the_shape() {
        // A 1x1 unit rect scaled 10x covers a 10x10 px block.
        let shape = Node::shape(Shape::rect(Size::new(1.0, 1.0)).with_fill(Color::WHITE))
            .with_transform(Transform {
                translate: Vec2::ZERO,
                scale: Vec2::splat(10.0),
                ..Transform::IDENTITY
            });
        let fb = render(&Scene::new(comp(16, 16)).with_root(Node::group().with_child(shape)));
        let covered = (0..16)
            .flat_map(|y| (0..16).map(move |x| (x, y)))
            .filter(|&(x, y)| fb.pixel(x, y) == [255, 255, 255, 255])
            .count();
        assert_eq!(covered, 100);
    }

    #[test]
    fn node_opacity_scales_alpha() {
        let shape =
            Node::shape(Shape::rect(Size::new(4.0, 4.0)).with_fill(Color::rgb(1.0, 0.0, 0.0)))
                .with_opacity(0.5);
        let fb = render(&Scene::new(comp(4, 4)).with_root(Node::group().with_child(shape)));
        let [r, g, b, a] = fb.pixel(0, 0);
        assert_eq!([r, g, b], [255, 0, 0]); // color preserved over transparent
        assert_eq!(a, 128); // round(0.5 * 255)
    }

    #[test]
    fn group_opacity_multiplies_into_children() {
        let shape = Node::shape(Shape::rect(Size::new(4.0, 4.0)).with_fill(Color::WHITE));
        let root = Node::group()
            .with_opacity(0.5)
            .with_child(shape.with_opacity(0.5));
        let fb = render(&Scene::new(comp(4, 4)).with_root(root));
        assert_eq!(fb.pixel(0, 0)[3], 64); // 0.5 * 0.5 = 0.25 -> round(63.75) = 64
    }

    #[test]
    fn opaque_layers_composite_with_src_over() {
        let red =
            Node::shape(Shape::rect(Size::new(4.0, 4.0)).with_fill(Color::rgb(1.0, 0.0, 0.0)));
        // Blue covers only the right half via translation.
        let blue =
            Node::shape(Shape::rect(Size::new(2.0, 4.0)).with_fill(Color::rgb(0.0, 0.0, 1.0)))
                .with_transform(Transform {
                    translate: Vec2::new(2.0, 0.0),
                    scale: Vec2::splat(1.0),
                    ..Transform::IDENTITY
                });
        let fb =
            render(&Scene::new(comp(4, 4)).with_root(Node::group().with_children([red, blue])));
        assert_eq!(fb.pixel(0, 0), [255, 0, 0, 255]); // red half
        assert_eq!(fb.pixel(3, 0), [0, 0, 255, 255]); // blue painted last
    }

    #[test]
    fn ellipse_fills_center_not_corner() {
        let shape = Node::shape(Shape::ellipse(Size::new(8.0, 8.0)).with_fill(Color::WHITE));
        let fb = render(&Scene::new(comp(8, 8)).with_root(Node::group().with_child(shape)));
        assert_eq!(fb.pixel(4, 4), [255, 255, 255, 255]); // center filled
        assert_eq!(fb.pixel(0, 0), [0, 0, 0, 0]); // corner outside the ellipse
    }

    #[test]
    fn nested_transforms_compose() {
        // Parent translates by (3,0); child by (2,0); a 1x1 rect should land at x=5.
        let inner = Node::shape(Shape::rect(Size::new(1.0, 1.0)).with_fill(Color::WHITE))
            .with_transform(Transform {
                translate: Vec2::new(2.0, 0.0),
                scale: Vec2::splat(1.0),
                ..Transform::IDENTITY
            });
        let root = Node::group()
            .with_transform(Transform {
                translate: Vec2::new(3.0, 0.0),
                scale: Vec2::splat(1.0),
                ..Transform::IDENTITY
            })
            .with_child(inner);
        let fb = render(&Scene::new(comp(8, 2)).with_root(root));
        assert_eq!(fb.pixel(5, 0), [255, 255, 255, 255]);
        assert_eq!(fb.pixel(4, 0), [0, 0, 0, 0]);
    }

    fn translate(x: f32, y: f32) -> Transform {
        Transform {
            translate: Vec2::new(x, y),
            scale: Vec2::splat(1.0),
            ..Transform::IDENTITY
        }
    }

    fn inked_pixels(fb: &Framebuffer) -> usize {
        (0..fb.height())
            .flat_map(|y| (0..fb.width()).map(move |x| (x, y)))
            .filter(|&(x, y)| fb.pixel(x, y)[3] > 0)
            .count()
    }

    // Text tests use the host's fonts (the only v0 path). They assert structural
    // properties that hold for any reasonable Latin font, not exact pixels.

    #[test]
    fn renders_text_with_system_fonts() {
        let mut renderer = Renderer::with_system_fonts();
        let scene = Scene::new(comp(200, 64)).with_root(
            Node::group().with_child(Node::text("Hello ONDA").with_transform(translate(8.0, 8.0))),
        );
        let fb = renderer.render(&scene);
        assert!(inked_pixels(&fb) > 0, "text should produce visible pixels");
    }

    #[test]
    fn empty_text_produces_no_ink() {
        let mut renderer = Renderer::with_system_fonts();
        let scene = Scene::new(comp(64, 32)).with_root(Node::group().with_child(Node::text("")));
        let fb = renderer.render(&scene);
        assert!(fb.as_bytes().iter().all(|&b| b == 0));
    }

    #[test]
    fn renderer_without_fonts_skips_text() {
        let mut renderer = Renderer::new();
        let scene =
            Scene::new(comp(64, 32)).with_root(Node::group().with_child(Node::text("Hello")));
        let fb = renderer.render(&scene);
        assert!(fb.as_bytes().iter().all(|&b| b == 0));
    }

    #[test]
    fn text_default_color_is_white() {
        let mut renderer = Renderer::with_system_fonts();
        let scene = Scene::new(comp(64, 48)).with_root(
            Node::group().with_child(Node::text("I").with_transform(translate(8.0, 8.0))),
        );
        let fb = renderer.render(&scene);
        // The first inked pixel must be opaque-white-tinted (text fill defaults to
        // white; src-over onto transparent preserves the source rgb).
        let first = (0..fb.height())
            .flat_map(|y| (0..fb.width()).map(move |x| (x, y)))
            .map(|(x, y)| fb.pixel(x, y))
            .find(|px| px[3] > 0)
            .expect("text should ink at least one pixel");
        assert_eq!([first[0], first[1], first[2]], [255, 255, 255]);
    }

    #[test]
    fn default_font_renders_hello_onda_deterministically() {
        let scene = Scene::new(comp(256, 64)).with_root(
            Node::group().with_child(Node::text("Hello ONDA").with_transform(translate(8.0, 12.0))),
        );
        // Bundled font => byte-identical output across independent renderers.
        let a = Renderer::with_default_font().render(&scene);
        let b = Renderer::with_default_font().render(&scene);
        assert!(inked_pixels(&a) > 0, "Hello ONDA should be drawn");
        assert_eq!(a.as_bytes(), b.as_bytes(), "render must be reproducible");
    }

    #[cfg(feature = "gif")]
    #[test]
    fn encode_gif_produces_a_looping_gif() {
        let frames = vec![
            Framebuffer::filled(8, 4, Color::rgb(1.0, 0.0, 0.0)),
            Framebuffer::filled(8, 4, Color::rgb(0.0, 0.0, 1.0)),
        ];
        let mut buf = Vec::new();
        encode_gif(&frames, 12.0, &mut buf).expect("gif encode");
        assert!(buf.len() > 6);
        assert_eq!(&buf[..3], b"GIF"); // header magic
                                       // mismatched frame sizes are rejected
        let bad = vec![Framebuffer::new(8, 4), Framebuffer::new(4, 4)];
        assert!(encode_gif(&bad, 12.0, &mut Vec::new()).is_err());
        assert!(encode_gif(&[], 12.0, &mut Vec::new()).is_err());
    }

    #[cfg(feature = "png")]
    #[test]
    fn write_png_round_trips_dimensions() {
        let scene = Scene::new(comp(12, 7)).with_root(Node::group().with_child(Node::shape(
            Shape::rect(Size::new(12.0, 7.0)).with_fill(Color::rgb(0.2, 0.4, 0.8)),
        )));
        let fb = render(&scene);
        let path = std::env::temp_dir().join("onda_write_png_round_trip.png");
        fb.write_png(&path).expect("png write");

        let decoder =
            png::Decoder::new(std::io::BufReader::new(std::fs::File::open(&path).unwrap()));
        let reader = decoder.read_info().unwrap();
        let info = reader.info();
        assert_eq!((info.width, info.height), (12, 7));
        assert_eq!(info.color_type, png::ColorType::Rgba);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn text_is_placed_at_its_transform() {
        let mut renderer = Renderer::with_system_fonts();
        // Push the glyph well to the right; the left edge must stay clear.
        let scene = Scene::new(comp(200, 64)).with_root(
            Node::group().with_child(Node::text("X").with_transform(translate(140.0, 20.0))),
        );
        let fb = renderer.render(&scene);
        let left_clear = (0..fb.height()).all(|y| fb.pixel(0, y)[3] == 0);
        assert!(left_clear, "nothing should be drawn at the far-left column");
        let right_ink = (0..fb.height())
            .flat_map(|y| (120..fb.width()).map(move |x| (x, y)))
            .any(|(x, y)| fb.pixel(x, y)[3] > 0);
        assert!(right_ink, "glyph should appear in the translated region");
    }

    #[test]
    fn image_cover_fills_the_box_and_contain_letterboxes() {
        use onda_scene::{Image, ImageData, ImageFit};
        use std::sync::Arc;
        // A 2×1 source (left red, right blue) into a 4×4 box — aspect mismatch.
        let data = ImageData {
            width: 2,
            height: 1,
            rgba: Arc::new(vec![255, 0, 0, 255, 0, 0, 255, 255]),
        };
        let img = |fit: ImageFit| {
            Node::new(NodeKind::Image(
                Image::new("x")
                    .with_data(data.clone())
                    .with_box(4.0, 4.0, fit),
            ))
        };

        // Cover overflows + crops, so every pixel of the box is opaque (no gaps).
        let fb = render(
            &Scene::new(comp(4, 4)).with_root(Node::group().with_child(img(ImageFit::Cover))),
        );
        for y in 0..4 {
            for x in 0..4 {
                assert_eq!(fb.pixel(x, y)[3], 255, "cover should fill ({x},{y})");
            }
        }

        // Contain centers a 4×2 image, so the top and bottom rows letterbox.
        let fb = render(
            &Scene::new(comp(4, 4)).with_root(Node::group().with_child(img(ImageFit::Contain))),
        );
        assert_eq!(fb.pixel(0, 0)[3], 0, "contain should letterbox the top row");
        assert_eq!(
            fb.pixel(0, 3)[3],
            0,
            "contain should letterbox the bottom row"
        );
        assert!(
            (0..4).all(|x| fb.pixel(x, 1)[3] == 255),
            "contain fills the middle band"
        );
    }

    #[cfg(feature = "parallel")]
    #[test]
    fn parallel_render_preserves_order() {
        let solid = |c: Color| {
            Scene::new(comp(4, 4)).with_root(
                Node::group()
                    .with_child(Node::shape(Shape::rect(Size::new(4.0, 4.0)).with_fill(c))),
            )
        };
        let scenes = vec![
            solid(Color::rgb(1.0, 0.0, 0.0)),
            solid(Color::rgb(0.0, 1.0, 0.0)),
            solid(Color::rgb(0.0, 0.0, 1.0)),
        ];
        let frames = render_frames_parallel(&scenes, Renderer::new);
        assert_eq!(frames.len(), 3);
        assert_eq!(frames[0].pixel(0, 0), [255, 0, 0, 255]);
        assert_eq!(frames[1].pixel(0, 0), [0, 255, 0, 255]);
        assert_eq!(frames[2].pixel(0, 0), [0, 0, 255, 255]);
    }
}
