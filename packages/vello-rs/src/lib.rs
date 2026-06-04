//! Vello vector renderer for ONDA — the GPU-native vector backend.
//!
//! Maps an ONDA [`Scene`] onto a `vello::Scene` and rasterizes it on the GPU
//! (compute) to an RGBA framebuffer. Unlike the retired quad+SDF backend this
//! does true vector rendering: anti-aliased fills *and* strokes, real rounded
//! rectangles, arbitrary Bézier [`Path`]s, and **native per-glyph vector text**
//! (glyph outlines drawn through Vello's glyph runs — resolution-independent and
//! ready for per-character/kinetic animation).
//!
//! Note: vello 0.3 pins wgpu 22, so this uses `vello::wgpu`.

use std::collections::HashMap;

use onda_core::{Color, Transform};
use onda_scene::{
    BlendMode, Gradient, GradientStop, ImageData, ImageFit, LineCap, LineJoin, Node, NodeKind,
    Scene, Shadow, ShapeGeometry, Text,
};
use onda_typography::{FontContext, StyledRun};
use vello::kurbo::{Affine, BezPath, Cap, Ellipse, Join, Rect, RoundedRect, Shape, Stroke};
use vello::peniko::{
    Blob, Brush, Color as PenikoColor, ColorStop, Fill, Font, Format, Gradient as PenikoGradient,
    Image as PenikoImage, Mix,
};
use vello::{wgpu, AaConfig, Glyph, RenderParams, Renderer, RendererOptions, Scene as VelloScene};

/// A rendered frame: straight-alpha RGBA8, row-major, top-left origin.
pub struct Frame {
    pub width: u32,
    pub height: u32,
    pub pixels: Vec<u8>,
}

/// A reusable Vello-backed renderer (device + Vello renderer + fonts).
pub struct VelloRenderer {
    device: wgpu::Device,
    queue: wgpu::Queue,
    renderer: Renderer,
    fonts: FontContext,
    /// Vello fonts cached by `onda-typography`'s stable per-face key, built on
    /// demand from the face bytes the layout reports. Keeps Vello's glyph cache
    /// warm across frames.
    font_cache: HashMap<u64, Font>,
}

impl VelloRenderer {
    /// Load an additional font (`.ttf`/`.otf` bytes) so text can select it by
    /// family. Returns the family name(s) it provides.
    pub fn load_font(&mut self, data: Vec<u8>) -> Vec<String> {
        self.fonts.load_font(data)
    }
}

impl VelloRenderer {
    /// Acquire a GPU and build the Vello renderer. `None` if no adapter exists.
    /// Blocks; native only. On the web use [`VelloRenderer::new_async`].
    pub fn new() -> Option<Self> {
        pollster::block_on(Self::new_async())
    }

    /// Async constructor — required on the web (wasm), where adapter/device
    /// acquisition genuinely can't block the main thread. `None` if no GPU.
    pub async fn new_async() -> Option<Self> {
        Self::try_new_async().await.ok()
    }

    /// Like [`new_async`], but reports *why* setup failed — useful on the web,
    /// where WebGPU may be missing or lack the limits Vello's compute path needs.
    pub async fn try_new_async() -> Result<Self, String> {
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::default());
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                force_fallback_adapter: false,
                compatible_surface: None,
            })
            .await
            .ok_or_else(|| "request_adapter returned no adapter".to_string())?;
        let (device, queue) = adapter
            .request_device(
                &wgpu::DeviceDescriptor {
                    label: Some("onda-vello"),
                    required_features: wgpu::Features::empty(),
                    required_limits: adapter.limits(),
                    memory_hints: wgpu::MemoryHints::default(),
                },
                None,
            )
            .await
            .map_err(|e| format!("request_device failed: {e}"))?;
        let renderer = Renderer::new(
            &device,
            RendererOptions {
                surface_format: None,
                use_cpu: false,
                antialiasing_support: vello::AaSupport::area_only(),
                // Single-threaded init: wasm threads need COOP/COEP + SharedArrayBuffer.
                num_init_threads: std::num::NonZeroUsize::new(1),
            },
        )
        .map_err(|e| format!("Renderer::new failed: {e}"))?;
        Ok(VelloRenderer {
            device,
            queue,
            renderer,
            fonts: FontContext::with_default_font(),
            font_cache: HashMap::new(),
        })
    }

    /// Render an ONDA scene to a [`Frame`] (blocking readback; native only).
    pub fn render(&mut self, scene: &Scene) -> Frame {
        let (texture, width, height) = self.render_to_target(scene);
        read_back(&self.device, &self.queue, &texture, width, height)
    }

    /// Render an ONDA scene to a [`Frame`], awaiting the readback instead of
    /// blocking — required on the web (wasm), where buffer mapping is async.
    pub async fn render_async(&mut self, scene: &Scene) -> Frame {
        let (texture, width, height) = self.render_to_target(scene);
        read_back_async(&self.device, &self.queue, &texture, width, height).await
    }

    /// Build the scene and rasterize it to an offscreen RGBA texture (shared by
    /// the sync and async render paths). Returns the texture and its size.
    fn render_to_target(&mut self, scene: &Scene) -> (wgpu::Texture, u32, u32) {
        let width = scene.composition.width.max(1);
        let height = scene.composition.height.max(1);

        let mut vscene = VelloScene::new();
        // Disjoint field borrows: `fonts` (shaping) + `font_cache` (built fonts).
        build(
            &mut vscene,
            &mut self.fonts,
            &mut self.font_cache,
            &scene.root,
            Affine::IDENTITY,
            1.0,
        );

        let texture = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("onda-vello target"),
            size: wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::STORAGE_BINDING | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());

        self.renderer
            .render_to_texture(
                &self.device,
                &self.queue,
                &vscene,
                &view,
                &RenderParams {
                    base_color: PenikoColor::TRANSPARENT,
                    width,
                    height,
                    antialiasing_method: AaConfig::Area,
                },
            )
            .expect("vello render");

        (texture, width, height)
    }
}

/// Walk the scene graph, appending fills/strokes/text to the Vello scene.
fn build(
    vscene: &mut VelloScene,
    fonts: &mut FontContext,
    font_cache: &mut HashMap<u64, Font>,
    node: &Node,
    parent: Affine,
    parent_opacity: f32,
) {
    let affine = parent * to_affine(&node.transform);
    let opacity = (parent_opacity * node.opacity).clamp(0.0, 1.0);

    // A blend mode composites this node's whole subtree against the backdrop
    // (CSS mix-blend-mode). Push a canvas-covering blend layer around everything,
    // like clip; the subtree draws into it and composites with the chosen mode.
    let blended = node.blend != BlendMode::Normal;
    if blended {
        vscene.push_layer(
            blend_mix(node.blend),
            1.0,
            Affine::IDENTITY,
            &Rect::new(-1.0e7, -1.0e7, 1.0e7, 1.0e7),
        );
    }

    // A clip on this node bounds its own drawing *and* its subtree to the clip
    // geometry (in local space). Push a clip layer, draw, then pop.
    let clipped = node.clip.is_some();
    if let Some(clip) = &node.clip {
        vscene.push_layer(Mix::Clip, 1.0, affine, &shape_path(clip));
    }

    match &node.kind {
        NodeKind::Group => {}
        NodeKind::Shape(shape) => {
            let path = shape_path(&shape.geometry);
            // Drop shadow / glow: an analytic blurred rounded-rect drawn BEHIND
            // the shape (Vello's built-in; no extra render pass).
            if let Some(shadow) = &shape.shadow {
                let (rect, radius) = shadow_box(&shape.geometry, &path, shadow);
                vscene.draw_blurred_rounded_rect(
                    affine,
                    rect,
                    peniko_color(shadow.color, opacity),
                    radius,
                    shadow.blur.max(0.0) as f64,
                );
            }
            if let Some(brush) = fill_brush(shape.fill, shape.gradient.as_ref(), opacity) {
                vscene.fill(Fill::NonZero, affine, &brush, None, &path);
            }
            if let Some(stroke) = &shape.stroke {
                let mut sk = Stroke::new(stroke.width as f64)
                    .with_caps(cap_to_kurbo(stroke.cap))
                    .with_join(join_to_kurbo(stroke.join));
                if !stroke.dash.is_empty() {
                    sk = sk.with_dashes(
                        stroke.dash_offset as f64,
                        stroke.dash.iter().map(|d| *d as f64),
                    );
                }
                vscene.stroke(
                    &sk,
                    affine,
                    peniko_color(stroke.color, opacity),
                    None,
                    &path,
                );
            }
        }
        NodeKind::Text(text) => draw_text(vscene, fonts, font_cache, text, affine, opacity),
        // Image and Video draw decoded RGBA the same way (a video frame is just
        // an image); pixels are attached by a decode pass and skipped if absent.
        NodeKind::Image(image) => {
            draw_image_data(
                vscene,
                affine,
                opacity,
                image.data.as_ref(),
                image.width,
                image.height,
                image.fit,
            );
        }
        NodeKind::Video(video) => {
            draw_image_data(
                vscene,
                affine,
                opacity,
                video.data.as_ref(),
                video.width,
                video.height,
                video.fit,
            );
        }
        // Audio is non-visual — the player plays it; the renderer skips it.
        NodeKind::Audio(_) => {}
        // SVG nodes are expanded to shapes before rendering (see onda-svg); an
        // unexpanded one draws nothing.
        NodeKind::Svg(_) => {}
    }

    for child in &node.children {
        build(vscene, fonts, font_cache, child, affine, opacity);
    }

    if clipped {
        vscene.pop_layer();
    }
    if blended {
        vscene.pop_layer();
    }
}

/// Draw decoded RGBA pixels into the optional `box_width`×`box_height` box per
/// `fit` — shared by Image and Video nodes (a video frame is just an image).
/// Without a box, the image draws at intrinsic size at `affine`.
#[allow(clippy::too_many_arguments)]
fn draw_image_data(
    vscene: &mut VelloScene,
    affine: Affine,
    opacity: f32,
    data: Option<&ImageData>,
    box_width: Option<f32>,
    box_height: Option<f32>,
    fit: ImageFit,
) {
    let Some(data) = data else {
        return;
    };
    if data.width == 0 || data.height == 0 {
        return;
    }
    let pimg = PenikoImage::new(
        Blob::new(data.rgba.clone()),
        Format::Rgba8,
        data.width,
        data.height,
    );
    let (iw, ih) = (data.width as f64, data.height as f64);
    let (img_affine, clip_box) = match (box_width, box_height) {
        (Some(bw), Some(bh)) if bw > 0.0 && bh > 0.0 => {
            let (bw, bh) = (bw as f64, bh as f64);
            let (sx, sy) = match fit {
                ImageFit::Fill => (bw / iw, bh / ih),
                ImageFit::Cover => {
                    let s = (bw / iw).max(bh / ih);
                    (s, s)
                }
                ImageFit::Contain => {
                    let s = (bw / iw).min(bh / ih);
                    (s, s)
                }
            };
            // Center the scaled image in the box.
            let dx = (bw - iw * sx) / 2.0;
            let dy = (bh - ih * sy) / 2.0;
            let a = affine * Affine::translate((dx, dy)) * Affine::scale_non_uniform(sx, sy);
            // Cover overflows the box → clip it; fill/contain stay inside.
            let clip = (fit == ImageFit::Cover).then(|| Rect::new(0.0, 0.0, bw, bh));
            (a, clip)
        }
        _ => (affine, None),
    };
    // Clip cover overflow to the box (in node-local `affine` space).
    let did_clip = clip_box.is_some();
    if let Some(b) = clip_box {
        vscene.push_layer(Mix::Clip, 1.0, affine, &b);
    }
    // draw_image has no alpha arg; fold node opacity in via a layer.
    if opacity < 1.0 {
        let bounds = Rect::new(0.0, 0.0, iw, ih);
        vscene.push_layer(Mix::Normal, opacity, img_affine, &bounds);
        vscene.draw_image(&pimg, img_affine);
        vscene.pop_layer();
    } else {
        vscene.draw_image(&pimg, img_affine);
    }
    if did_clip {
        vscene.pop_layer();
    }
}

fn to_affine(t: &Transform) -> Affine {
    // TRS about `origin` (CSS transform-origin): move the pivot to 0, scale, then
    // rotate (degrees → radians, clockwise in screen space), move it back, then
    // the node translate. origin (0,0) reduces to the plain local-origin TRS.
    // Composed with the parent affine up the tree, so nested transforms work.
    let (ox, oy) = (t.origin.x as f64, t.origin.y as f64);
    Affine::translate((t.translate.x as f64, t.translate.y as f64))
        * Affine::translate((ox, oy))
        * Affine::rotate((t.rotate as f64).to_radians())
        * Affine::scale_non_uniform(t.scale.x as f64, t.scale.y as f64)
        * Affine::translate((-ox, -oy))
}

/// The (local-space) rounded-rect + radius for a shape's drop shadow: the
/// geometry's box, displaced by `offset` and grown by `spread`. Ellipses map to a
/// fully-rounded rect; paths use their bounding box.
fn shadow_box(geo: &ShapeGeometry, path: &BezPath, shadow: &Shadow) -> (Rect, f64) {
    let s = shadow.spread as f64;
    let (ox, oy) = (shadow.offset.x as f64, shadow.offset.y as f64);
    let (x0, y0, x1, y1, base_r) = match geo {
        ShapeGeometry::Rect {
            size,
            corner_radius,
        } => (
            0.0,
            0.0,
            size.width as f64,
            size.height as f64,
            *corner_radius as f64,
        ),
        ShapeGeometry::Ellipse { size } => {
            let (w, h) = (size.width as f64, size.height as f64);
            (0.0, 0.0, w, h, w.min(h) / 2.0)
        }
        ShapeGeometry::Path { .. } => {
            let b = path.bounding_box();
            (b.x0, b.y0, b.x1, b.y1, 0.0)
        }
    };
    (
        Rect::new(x0 + ox - s, y0 + oy - s, x1 + ox + s, y1 + oy + s),
        (base_r + s).max(0.0),
    )
}

fn blend_mix(b: BlendMode) -> Mix {
    match b {
        BlendMode::Normal => Mix::Normal,
        BlendMode::Multiply => Mix::Multiply,
        BlendMode::Screen => Mix::Screen,
        BlendMode::Overlay => Mix::Overlay,
        BlendMode::Darken => Mix::Darken,
        BlendMode::Lighten => Mix::Lighten,
        BlendMode::ColorDodge => Mix::ColorDodge,
        BlendMode::ColorBurn => Mix::ColorBurn,
        BlendMode::HardLight => Mix::HardLight,
        BlendMode::SoftLight => Mix::SoftLight,
        BlendMode::Difference => Mix::Difference,
        BlendMode::Exclusion => Mix::Exclusion,
        BlendMode::Hue => Mix::Hue,
        BlendMode::Saturation => Mix::Saturation,
        BlendMode::Color => Mix::Color,
        BlendMode::Luminosity => Mix::Luminosity,
    }
}

fn cap_to_kurbo(c: LineCap) -> Cap {
    match c {
        LineCap::Butt => Cap::Butt,
        LineCap::Round => Cap::Round,
        LineCap::Square => Cap::Square,
    }
}

fn join_to_kurbo(j: LineJoin) -> Join {
    match j {
        LineJoin::Miter => Join::Miter,
        LineJoin::Round => Join::Round,
        LineJoin::Bevel => Join::Bevel,
    }
}

fn peniko_color(color: Color, opacity: f32) -> PenikoColor {
    let [r, g, b, a] = color.with_alpha(color.a * opacity).to_rgba8();
    PenikoColor::rgba8(r, g, b, a)
}

/// The fill paint for a shape: a gradient takes precedence over a solid color;
/// `opacity` is baked into the resulting colors. `None` if the shape has no fill.
fn fill_brush(fill: Option<Color>, gradient: Option<&Gradient>, opacity: f32) -> Option<Brush> {
    match gradient {
        Some(g) => Some(Brush::Gradient(peniko_gradient(g, opacity))),
        None => fill.map(|c| Brush::Solid(peniko_color(c, opacity))),
    }
}

fn peniko_gradient(gradient: &Gradient, opacity: f32) -> PenikoGradient {
    match gradient {
        Gradient::Linear { start, end, stops } => PenikoGradient::new_linear(
            (start.x as f64, start.y as f64),
            (end.x as f64, end.y as f64),
        )
        .with_stops(color_stops(stops, opacity).as_slice()),
        Gradient::Radial {
            center,
            radius,
            stops,
        } => PenikoGradient::new_radial((center.x as f64, center.y as f64), *radius)
            .with_stops(color_stops(stops, opacity).as_slice()),
    }
}

fn color_stops(stops: &[GradientStop], opacity: f32) -> Vec<ColorStop> {
    stops
        .iter()
        .map(|s| ColorStop {
            offset: s.offset,
            color: peniko_color(s.color, opacity),
        })
        .collect()
}

fn shape_path(geometry: &ShapeGeometry) -> BezPath {
    const TOL: f64 = 0.1;
    match geometry {
        ShapeGeometry::Rect {
            size,
            corner_radius,
        } => {
            let (w, h) = (size.width as f64, size.height as f64);
            if *corner_radius > 0.0 {
                RoundedRect::new(0.0, 0.0, w, h, *corner_radius as f64).to_path(TOL)
            } else {
                Rect::new(0.0, 0.0, w, h).to_path(TOL)
            }
        }
        ShapeGeometry::Ellipse { size } => {
            let (rx, ry) = (size.width as f64 / 2.0, size.height as f64 / 2.0);
            Ellipse::new((rx, ry), (rx, ry), 0.0).to_path(TOL)
        }
        // Arbitrary SVG path data → Bézier outline. Malformed data yields an
        // empty path (draws nothing) rather than panicking.
        ShapeGeometry::Path { data } => BezPath::from_svg(data).unwrap_or_default(),
    }
}

/// Draw text as native glyph outlines through Vello's glyph runs. cosmic-text
/// shapes the node's rich runs ([`FontContext::layout_rich`]) — picking the right
/// face per run's family/weight/style — and Vello rasterizes the outlines on the
/// GPU. Crisp at any scale; pixel-identical to `onda export`.
fn draw_text(
    vscene: &mut VelloScene,
    fonts: &mut FontContext,
    font_cache: &mut HashMap<u64, Font>,
    text: &Text,
    affine: Affine,
    opacity: f32,
) {
    if opacity <= 0.0 {
        return;
    }
    // Resolve the node's rich runs (a single run for plain text), bake node
    // opacity into each run's alpha, and lay them out together.
    let resolved = text.resolved_runs();
    let styled: Vec<StyledRun> = resolved
        .iter()
        .map(|r| StyledRun {
            text: &r.text,
            font_size: r.font_size,
            color: [r.color.r, r.color.g, r.color.b, r.color.a * opacity],
            family: r.font_family.as_deref(),
            weight: r.weight,
            italic: r.italic,
            letter_spacing: text.letter_spacing,
        })
        .collect();
    let layout = fonts.layout_rich(&styled);
    if layout.glyphs.is_empty() {
        return;
    }
    // Build any newly-seen faces (cached by stable key — keeps Vello's glyph
    // cache warm across frames).
    for blob in &layout.fonts {
        font_cache
            .entry(blob.key)
            .or_insert_with(|| Font::new(Blob::new(blob.data.clone()), blob.index));
    }

    // Draw a Vello glyph run per contiguous group sharing face + size + color.
    // Runs are contiguous in layout order, so grouping consecutively is deterministic.
    let glyphs = &layout.glyphs;
    let mut i = 0;
    while i < glyphs.len() {
        let head = glyphs[i];
        let mut j = i + 1;
        while j < glyphs.len()
            && glyphs[j].font_key == head.font_key
            && glyphs[j].font_size == head.font_size
            && glyphs[j].color == head.color
        {
            j += 1;
        }
        if let Some(font) = font_cache.get(&head.font_key) {
            let [r, g, b, a] = head.color;
            let to8 = |c: f32| (c.clamp(0.0, 1.0) * 255.0).round() as u8;
            vscene
                .draw_glyphs(font)
                .font_size(head.font_size)
                .transform(affine)
                .brush(PenikoColor::rgba8(to8(r), to8(g), to8(b), to8(a)))
                .draw(
                    Fill::NonZero,
                    glyphs[i..j].iter().map(|gl| Glyph {
                        id: gl.id,
                        x: gl.x,
                        y: gl.y,
                    }),
                );
        }
        i = j;
    }
}

/// Copy the rendered texture into a mappable buffer. Returns the buffer and the
/// 256-byte-aligned row stride.
fn copy_to_readback_buffer(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    texture: &wgpu::Texture,
    width: u32,
    height: u32,
) -> (wgpu::Buffer, u32) {
    let unpadded = width * 4;
    let padded = unpadded.div_ceil(256) * 256;
    let buffer = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("readback"),
        size: (padded * height) as u64,
        usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
        mapped_at_creation: false,
    });
    let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor::default());
    encoder.copy_texture_to_buffer(
        wgpu::ImageCopyTexture {
            texture,
            mip_level: 0,
            origin: wgpu::Origin3d::ZERO,
            aspect: wgpu::TextureAspect::All,
        },
        wgpu::ImageCopyBuffer {
            buffer: &buffer,
            layout: wgpu::ImageDataLayout {
                offset: 0,
                bytes_per_row: Some(padded),
                rows_per_image: Some(height),
            },
        },
        wgpu::Extent3d {
            width,
            height,
            depth_or_array_layers: 1,
        },
    );
    queue.submit(Some(encoder.finish()));
    (buffer, padded)
}

/// Strip the 256-byte row padding from a mapped readback buffer into tight RGBA.
fn unpad_rows(mapped: &[u8], width: u32, height: u32, padded: u32) -> Vec<u8> {
    let unpadded = (width * 4) as usize;
    let mut pixels = Vec::with_capacity(unpadded * height as usize);
    for row in 0..height {
        let start = (row * padded) as usize;
        pixels.extend_from_slice(&mapped[start..start + unpadded]);
    }
    pixels
}

fn read_back(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    texture: &wgpu::Texture,
    width: u32,
    height: u32,
) -> Frame {
    let (buffer, padded) = copy_to_readback_buffer(device, queue, texture, width, height);
    let slice = buffer.slice(..);
    slice.map_async(wgpu::MapMode::Read, |_| {});
    device.poll(wgpu::Maintain::Wait);
    let pixels = unpad_rows(&slice.get_mapped_range(), width, height, padded);
    buffer.unmap();
    Frame {
        width,
        height,
        pixels,
    }
}

/// Async readback: awaits the buffer map instead of blocking on `poll(Wait)`.
/// On native, `poll(Wait)` drives the map to completion immediately; on the web
/// it's a no-op and the browser fulfils the map while we await the callback.
async fn read_back_async(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    texture: &wgpu::Texture,
    width: u32,
    height: u32,
) -> Frame {
    let (buffer, padded) = copy_to_readback_buffer(device, queue, texture, width, height);
    let slice = buffer.slice(..);
    let (tx, rx) = futures_intrusive::channel::shared::oneshot_channel();
    slice.map_async(wgpu::MapMode::Read, move |res| {
        let _ = tx.send(res);
    });
    device.poll(wgpu::Maintain::Wait);
    let _ = rx.receive().await;
    let pixels = unpad_rows(&slice.get_mapped_range(), width, height, padded);
    buffer.unmap();
    Frame {
        width,
        height,
        pixels,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use onda_core::{Size, Vec2};
    use onda_scene::{Composition, GradientStop, Node, Shape, ShapeGeometry};

    #[test]
    fn renders_an_onda_scene() {
        let Some(mut renderer) = VelloRenderer::new() else {
            eprintln!("no GPU adapter; skipping");
            return;
        };
        let scene = Scene::new(Composition::new(64, 64, 30.0, 1)).with_root(
            Node::group().with_child(Node::shape(
                Shape::rect(Size::new(64.0, 64.0)).with_fill(Color::rgb(1.0, 0.0, 0.0)),
            )),
        );
        let frame = renderer.render(&scene);
        assert_eq!((frame.width, frame.height), (64, 64));
        // A full-canvas red fill: center pixel is opaque red.
        let center = ((32 * 64 + 32) * 4) as usize;
        assert_eq!(&frame.pixels[center..center + 4], &[255, 0, 0, 255]);
    }

    #[test]
    fn renders_an_arbitrary_path() {
        let Some(mut renderer) = VelloRenderer::new() else {
            eprintln!("no GPU adapter; skipping");
            return;
        };
        // A path filling the whole 64x64 canvas (only expressible as a path).
        let scene = Scene::new(Composition::new(64, 64, 30.0, 1)).with_root(
            Node::group().with_child(Node::shape(
                Shape::path("M0 0 L64 0 L64 64 L0 64 Z").with_fill(Color::rgb(0.0, 1.0, 0.0)),
            )),
        );
        let frame = renderer.render(&scene);
        let center = ((32 * 64 + 32) * 4) as usize;
        assert_eq!(&frame.pixels[center..center + 4], &[0, 255, 0, 255]);
    }

    #[test]
    fn renders_a_linear_gradient() {
        let Some(mut renderer) = VelloRenderer::new() else {
            eprintln!("no GPU adapter; skipping");
            return;
        };
        // Horizontal red → blue across the canvas.
        let scene =
            Scene::new(Composition::new(64, 64, 30.0, 1)).with_root(Node::group().with_child(
                Node::shape(Shape::rect(Size::new(64.0, 64.0)).with_linear_gradient(
                    Vec2::new(0.0, 0.0),
                    Vec2::new(64.0, 0.0),
                    [
                        GradientStop::new(0.0, Color::rgb(1.0, 0.0, 0.0)),
                        GradientStop::new(1.0, Color::rgb(0.0, 0.0, 1.0)),
                    ],
                )),
            ));
        let frame = renderer.render(&scene);
        let px = |x: u32| {
            let i = ((32 * 64 + x) * 4) as usize;
            [frame.pixels[i], frame.pixels[i + 1], frame.pixels[i + 2]]
        };
        let (left, right) = (px(2), px(61));
        // Left end is mostly red; right end mostly blue.
        assert!(
            left[0] > 180 && left[2] < 80,
            "left should be red: {left:?}"
        );
        assert!(
            right[2] > 180 && right[0] < 80,
            "right should be blue: {right:?}"
        );
    }

    #[test]
    fn clip_confines_a_subtree() {
        let Some(mut renderer) = VelloRenderer::new() else {
            eprintln!("no GPU adapter; skipping");
            return;
        };
        // A full-canvas red fill, clipped to the top-left 20x20 corner.
        let scene = Scene::new(Composition::new(64, 64, 30.0, 1)).with_root(
            Node::group()
                .with_clip(ShapeGeometry::Rect {
                    size: Size::new(20.0, 20.0),
                    corner_radius: 0.0,
                })
                .with_child(Node::shape(
                    Shape::rect(Size::new(64.0, 64.0)).with_fill(Color::rgb(1.0, 0.0, 0.0)),
                )),
        );
        let frame = renderer.render(&scene);
        let alpha = |x: u32, y: u32| frame.pixels[((y * 64 + x) * 4 + 3) as usize];
        assert_eq!(alpha(10, 10), 255, "inside the clip should be filled");
        assert_eq!(alpha(40, 40), 0, "outside the clip should be empty");
    }
}
