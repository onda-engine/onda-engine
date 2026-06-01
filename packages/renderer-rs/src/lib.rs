//! ONDA renderer — CPU reference rasterizer.
//!
//! This is the v0 backend: it walks a [`Scene`] and produces an in-memory RGBA8
//! [`Framebuffer`]. It is deliberately CPU-only and dependency-light so the
//! scene-graph → pixels *contract* (transform/opacity inheritance, src-over
//! compositing, coordinate conventions) can be pinned down and tested
//! deterministically without a GPU. The forthcoming wgpu backend must match this
//! reference output, which doubles as a correctness oracle for it.
//!
//! v0 scope: filled rectangles and ellipses, plus text (when the [`Renderer`]
//! has a [`FontContext`]) composited from `onda-typography` coverage masks. Hard
//! (non-antialiased) shape edges. Deferred to their subsystems: images (decoding),
//! strokes, rounded-corner rasterization, scaled/rotated text, and shape AA.
//!
//! Coordinate convention: pixel space, origin top-left, +x right, +y down. A
//! shape's geometry is authored in its own local space with origin at top-left;
//! the node's (composed) transform places it on the canvas.

use onda_core::{Color, Transform, Vec2};
use onda_scene::{Gradient, Node, NodeKind, Scene, Shape, ShapeGeometry, Text};
pub use onda_typography::{FontContext, TextRaster};

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
            // Images need decoding; lands with the asset loader.
            NodeKind::Image(_) => {}
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
        let Some(raster) = fonts.rasterize(&text.content, text.font_size) else {
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

/// The first stop's color of a gradient (the CPU backend's gradient fallback).
fn first_stop_color(gradient: &Gradient) -> Option<Color> {
    let stops = match gradient {
        Gradient::Linear { stops, .. } | Gradient::Radial { stops, .. } => stops,
    };
    stops.first().map(|s| s.color)
}

fn rasterize_shape(fb: &mut Framebuffer, shape: &Shape, transform: Transform, opacity: f32) {
    // The CPU backend has no gradient rasterizer, so a gradient fill collapses to
    // its first stop's color (the Vello backend renders the true gradient).
    let fill = shape
        .gradient
        .as_ref()
        .and_then(first_stop_color)
        .or(shape.fill);
    let Some(fill) = fill else {
        return; // stroke-only shapes deferred to v1
    };
    let fill = fill.with_alpha(fill.a * opacity);
    if fill.a <= 0.0 {
        return;
    }

    // `corner_radius` on rects is ignored here (square corners); rounded-corner
    // and arbitrary-path rasterization are vector-backend (Vello) features.
    let size = match &shape.geometry {
        ShapeGeometry::Rect { size, .. } => *size,
        ShapeGeometry::Ellipse { size } => *size,
        // The CPU scanline path only knows AABB rects/ellipses; arbitrary
        // Bézier paths render on the Vello backend.
        ShapeGeometry::Path { .. } => return,
    };

    // The shape's local AABB is [0,0]..[w,h]; transform maps it to an
    // axis-aligned canvas box (only translate + scale, so no rotation).
    let a = transform.apply(Vec2::ZERO);
    let b = transform.apply(Vec2::new(size.width, size.height));
    let (x0, x1) = (a.x.min(b.x), a.x.max(b.x));
    let (y0, y1) = (a.y.min(b.y), a.y.max(b.y));

    let px_min = x0.floor().max(0.0) as u32;
    let py_min = y0.floor().max(0.0) as u32;
    let px_max = (x1.ceil() as i64).clamp(0, fb.width() as i64) as u32;
    let py_max = (y1.ceil() as i64).clamp(0, fb.height() as i64) as u32;

    let center = Vec2::new((x0 + x1) * 0.5, (y0 + y1) * 0.5);
    let rx = (x1 - x0) * 0.5;
    let ry = (y1 - y0) * 0.5;

    for py in py_min..py_max {
        for px in px_min..px_max {
            let sample = Vec2::new(px as f32 + 0.5, py as f32 + 0.5);
            let inside = match &shape.geometry {
                ShapeGeometry::Rect { .. } => {
                    sample.x >= x0 && sample.x < x1 && sample.y >= y0 && sample.y < y1
                }
                ShapeGeometry::Ellipse { .. } => {
                    if rx <= 0.0 || ry <= 0.0 {
                        false
                    } else {
                        let nx = (sample.x - center.x) / rx;
                        let ny = (sample.y - center.y) / ry;
                        nx * nx + ny * ny <= 1.0
                    }
                }
                // Unreachable: paths return early above.
                ShapeGeometry::Path { .. } => false,
            };
            if inside {
                fb.blend(px, py, fill);
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
            });
        let root = Node::group()
            .with_transform(Transform {
                translate: Vec2::new(3.0, 0.0),
                scale: Vec2::splat(1.0),
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
