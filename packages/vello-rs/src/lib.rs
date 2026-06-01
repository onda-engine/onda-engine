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
use onda_scene::{Node, NodeKind, Scene, ShapeGeometry, Text};
use onda_typography::FontContext;
use vello::kurbo::{Affine, BezPath, Ellipse, Rect, RoundedRect, Shape, Stroke};
use vello::peniko::{Blob, Color as PenikoColor, Fill, Font};
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
    pub fn new() -> Option<Self> {
        pollster::block_on(Self::new_async())
    }

    async fn new_async() -> Option<Self> {
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::default());
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                force_fallback_adapter: false,
                compatible_surface: None,
            })
            .await?;
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
            .ok()?;
        let renderer = Renderer::new(
            &device,
            RendererOptions {
                surface_format: None,
                use_cpu: false,
                antialiasing_support: vello::AaSupport::area_only(),
                num_init_threads: None,
            },
        )
        .ok()?;
        let font = Font::new(
            Blob::new(Arc::new(FontContext::default_font_bytes().to_vec())),
            0,
        );
        Some(VelloRenderer {
            device,
            queue,
            renderer,
            fonts: FontContext::with_default_font(),
            font,
        })
    }

    /// Render an ONDA scene to a [`Frame`].
    pub fn render(&mut self, scene: &Scene) -> Frame {
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

        read_back(&self.device, &self.queue, &texture, width, height)
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

    match &node.kind {
        NodeKind::Group => {}
        NodeKind::Shape(shape) => {
            let path = shape_path(&shape.geometry);
            if let Some(fill) = shape.fill {
                vscene.fill(
                    Fill::NonZero,
                    affine,
                    peniko_color(fill, opacity),
                    None,
                    &path,
                );
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
    }

    for child in &node.children {
        build(vscene, fonts, font, child, affine, opacity);
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

fn read_back(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    texture: &wgpu::Texture,
    width: u32,
    height: u32,
) -> Frame {
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

    let slice = buffer.slice(..);
    slice.map_async(wgpu::MapMode::Read, |_| {});
    device.poll(wgpu::Maintain::Wait);
    let mapped = slice.get_mapped_range();
    let mut pixels = Vec::with_capacity((unpadded * height) as usize);
    for row in 0..height {
        let start = (row * padded) as usize;
        pixels.extend_from_slice(&mapped[start..start + unpadded as usize]);
    }
    drop(mapped);
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
    use onda_core::Size;
    use onda_scene::{Composition, Node, Shape};

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
}
