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

use std::sync::Arc;

use onda_core::{Color, Transform};
use onda_scene::{Gradient, GradientStop, Node, NodeKind, Scene, ShapeGeometry, Text};
use onda_typography::FontContext;
use vello::kurbo::{Affine, BezPath, Ellipse, Rect, RoundedRect, Shape, Stroke};
use vello::peniko::{
    Blob, Brush, Color as PenikoColor, ColorStop, Fill, Font, Gradient as PenikoGradient, Mix,
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
    /// The bundled font as Vello sees it (glyph outlines). Glyph ids from
    /// [`FontContext::layout`] index this font — both are built from the same
    /// bytes, so they stay in lockstep.
    font: Font,
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
        let font = Font::new(
            Blob::new(Arc::new(FontContext::default_font_bytes().to_vec())),
            0,
        );
        Ok(VelloRenderer {
            device,
            queue,
            renderer,
            fonts: FontContext::with_default_font(),
            font,
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
        // Disjoint field borrows: `fonts` mutably (shaping), `font` shared.
        build(
            &mut vscene,
            &mut self.fonts,
            &self.font,
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
    font: &Font,
    node: &Node,
    parent: Affine,
    parent_opacity: f32,
) {
    let affine = parent * to_affine(&node.transform);
    let opacity = (parent_opacity * node.opacity).clamp(0.0, 1.0);

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
            if let Some(brush) = fill_brush(shape.fill, shape.gradient.as_ref(), opacity) {
                vscene.fill(Fill::NonZero, affine, &brush, None, &path);
            }
            if let Some(stroke) = shape.stroke {
                vscene.stroke(
                    &Stroke::new(stroke.width as f64),
                    affine,
                    peniko_color(stroke.color, opacity),
                    None,
                    &path,
                );
            }
        }
        NodeKind::Text(text) => draw_text(vscene, fonts, font, text, affine, opacity),
        NodeKind::Image(_) => {}
        // SVG nodes are expanded to shapes before rendering (see onda-svg); an
        // unexpanded one draws nothing.
        NodeKind::Svg(_) => {}
    }

    for child in &node.children {
        build(vscene, fonts, font, child, affine, opacity);
    }

    if clipped {
        vscene.pop_layer();
    }
}

fn to_affine(t: &Transform) -> Affine {
    Affine::translate((t.translate.x as f64, t.translate.y as f64))
        * Affine::scale_non_uniform(t.scale.x as f64, t.scale.y as f64)
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
/// shapes/positions the glyphs ([`FontContext::layout`]); Vello rasterizes their
/// outlines on the GPU — crisp at any scale, and ready for per-glyph animation.
fn draw_text(
    vscene: &mut VelloScene,
    fonts: &mut FontContext,
    font: &Font,
    text: &Text,
    affine: Affine,
    opacity: f32,
) {
    if text.color.a * opacity <= 0.0 {
        return;
    }
    let glyphs = fonts.layout(&text.content, text.font_size);
    if glyphs.is_empty() {
        return;
    }
    vscene
        .draw_glyphs(font)
        .font_size(text.font_size)
        .transform(affine)
        .brush(peniko_color(text.color, opacity))
        .draw(
            Fill::NonZero,
            glyphs.iter().map(|g| Glyph {
                id: g.id,
                x: g.x,
                y: g.y,
            }),
        );
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
