//! GPU backend for ONDA (wgpu) — step 1: shapes.
//!
//! Renders a [`Scene`]'s filled shapes on the GPU to an offscreen texture, then
//! reads the pixels back as straight-alpha RGBA8 — the same `Framebuffer` shape
//! the CPU renderer and `onda export` use, so this is a drop-in backend. It is
//! *visually equivalent* to the CPU reference, not bit-exact: GPU rasterization
//! and blending differ, and ellipses get anti-aliasing the CPU path lacks.
//!
//! Scope: filled rects + ellipses. Deferred: strokes, rounded corners, text
//! (needs a glyph atlas), and the WebGPU build for the browser.

use bytemuck::{Pod, Zeroable};
use onda_core::{Transform, Vec2};
use onda_scene::{Node, NodeKind, Scene, ShapeGeometry};

/// A rendered frame: straight-alpha RGBA8, row-major, top-left origin.
pub struct Frame {
    pub width: u32,
    pub height: u32,
    pub pixels: Vec<u8>,
}

/// One drawable shape, uploaded as a per-instance vertex attribute.
#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct InstanceRaw {
    rect_min: [f32; 2],
    rect_size: [f32; 2],
    color: [f32; 4],
    kind: u32, // 0 = rect, 1 = ellipse
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct Uniforms {
    canvas: [f32; 2],
    _pad: [f32; 2],
}

const SHADER: &str = r#"
struct Uniforms { canvas: vec2<f32>, _pad: vec2<f32> };
@group(0) @binding(0) var<uniform> u: Uniforms;

struct Inst {
    @location(0) rect_min: vec2<f32>,
    @location(1) rect_size: vec2<f32>,
    @location(2) color: vec4<f32>,
    @location(3) kind: u32,
};

struct VsOut {
    @builtin(position) pos: vec4<f32>,
    @location(0) uv: vec2<f32>,
    @location(1) color: vec4<f32>,
    @location(2) @interpolate(flat) kind: u32,
};

@vertex
fn vs(@builtin(vertex_index) vi: u32, inst: Inst) -> VsOut {
    var corners = array<vec2<f32>, 4>(vec2(0., 0.), vec2(1., 0.), vec2(0., 1.), vec2(1., 1.));
    let uv = corners[vi];
    let px = inst.rect_min + uv * inst.rect_size;
    let ndc = vec2(px.x / u.canvas.x * 2.0 - 1.0, 1.0 - px.y / u.canvas.y * 2.0);
    var out: VsOut;
    out.pos = vec4(ndc, 0.0, 1.0);
    out.uv = uv;
    out.color = inst.color;
    out.kind = inst.kind;
    return out;
}

@fragment
fn fs(in: VsOut) -> @location(0) vec4<f32> {
    var alpha = in.color.a;
    if (in.kind == 1u) {
        // ellipse: distance from center (0 at center, 1 at edge), AA at the rim
        let d = distance(in.uv, vec2(0.5, 0.5)) * 2.0;
        let aa = fwidth(d);
        alpha = alpha * (1.0 - smoothstep(1.0 - aa, 1.0 + aa, d));
    }
    return vec4(in.color.rgb, alpha);
}
"#;

/// A reusable GPU renderer (device + pipeline). Construct once, render many.
pub struct GpuRenderer {
    device: wgpu::Device,
    queue: wgpu::Queue,
    pipeline: wgpu::RenderPipeline,
    bind_group_layout: wgpu::BindGroupLayout,
}

impl GpuRenderer {
    /// Acquire a GPU and build the pipeline. `None` if no adapter is available.
    pub fn new() -> Option<Self> {
        pollster::block_on(Self::new_async())
    }

    async fn new_async() -> Option<Self> {
        let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor::default());
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
                    label: Some("onda-gpu"),
                    required_features: wgpu::Features::empty(),
                    required_limits: wgpu::Limits::downlevel_defaults(),
                    memory_hints: wgpu::MemoryHints::default(),
                },
                None,
            )
            .await
            .ok()?;

        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("onda-gpu shader"),
            source: wgpu::ShaderSource::Wgsl(SHADER.into()),
        });

        let bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("onda-gpu uniforms"),
            entries: &[wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::VERTEX,
                ty: wgpu::BindingType::Buffer {
                    ty: wgpu::BufferBindingType::Uniform,
                    has_dynamic_offset: false,
                    min_binding_size: None,
                },
                count: None,
            }],
        });

        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("onda-gpu layout"),
            bind_group_layouts: &[&bind_group_layout],
            push_constant_ranges: &[],
        });

        let instance_layout = wgpu::VertexBufferLayout {
            array_stride: std::mem::size_of::<InstanceRaw>() as u64,
            step_mode: wgpu::VertexStepMode::Instance,
            attributes: &[
                wgpu::VertexAttribute {
                    offset: 0,
                    shader_location: 0,
                    format: wgpu::VertexFormat::Float32x2,
                },
                wgpu::VertexAttribute {
                    offset: 8,
                    shader_location: 1,
                    format: wgpu::VertexFormat::Float32x2,
                },
                wgpu::VertexAttribute {
                    offset: 16,
                    shader_location: 2,
                    format: wgpu::VertexFormat::Float32x4,
                },
                wgpu::VertexAttribute {
                    offset: 32,
                    shader_location: 3,
                    format: wgpu::VertexFormat::Uint32,
                },
            ],
        };

        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("onda-gpu pipeline"),
            layout: Some(&pipeline_layout),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vs"),
                buffers: &[instance_layout],
                compilation_options: wgpu::PipelineCompilationOptions::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("fs"),
                targets: &[Some(wgpu::ColorTargetState {
                    format: wgpu::TextureFormat::Rgba8Unorm,
                    blend: Some(wgpu::BlendState::ALPHA_BLENDING),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
                compilation_options: wgpu::PipelineCompilationOptions::default(),
            }),
            primitive: wgpu::PrimitiveState {
                topology: wgpu::PrimitiveTopology::TriangleStrip,
                ..Default::default()
            },
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            multiview: None,
            cache: None,
        });

        Some(GpuRenderer {
            device,
            queue,
            pipeline,
            bind_group_layout,
        })
    }

    /// Render a scene to a [`Frame`].
    pub fn render(&self, scene: &Scene) -> Frame {
        let width = scene.composition.width.max(1);
        let height = scene.composition.height.max(1);
        let instances = flatten(scene);

        let texture = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("onda-gpu target"),
            size: wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());

        let uniforms = Uniforms {
            canvas: [width as f32, height as f32],
            _pad: [0.0, 0.0],
        };
        let uniform_buffer =
            self.create_buffer(bytemuck::bytes_of(&uniforms), wgpu::BufferUsages::UNIFORM);
        let bind_group = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("onda-gpu bind group"),
            layout: &self.bind_group_layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: uniform_buffer.as_entire_binding(),
            }],
        });

        // A non-empty buffer is required even when there's nothing to draw.
        let fallback = [InstanceRaw::zeroed()];
        let instance_data: &[InstanceRaw] = if instances.is_empty() {
            &fallback
        } else {
            &instances
        };
        let instance_buffer = self.create_buffer(
            bytemuck::cast_slice(instance_data),
            wgpu::BufferUsages::VERTEX,
        );

        // Readback buffer with 256-byte-aligned rows.
        let unpadded = width * 4;
        let padded = unpadded.div_ceil(256) * 256;
        let readback = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("onda-gpu readback"),
            size: (padded * height) as u64,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });

        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor::default());
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("onda-gpu pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
            });
            if !instances.is_empty() {
                pass.set_pipeline(&self.pipeline);
                pass.set_bind_group(0, &bind_group, &[]);
                pass.set_vertex_buffer(0, instance_buffer.slice(..));
                pass.draw(0..4, 0..instances.len() as u32);
            }
        }
        encoder.copy_texture_to_buffer(
            wgpu::TexelCopyTextureInfo {
                texture: &texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            wgpu::TexelCopyBufferInfo {
                buffer: &readback,
                layout: wgpu::TexelCopyBufferLayout {
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
        self.queue.submit(Some(encoder.finish()));

        // Map and read back, un-padding each row.
        let slice = readback.slice(..);
        slice.map_async(wgpu::MapMode::Read, |_| {});
        self.device.poll(wgpu::Maintain::Wait);
        let mapped = slice.get_mapped_range();
        let mut pixels = Vec::with_capacity((unpadded * height) as usize);
        for row in 0..height {
            let start = (row * padded) as usize;
            pixels.extend_from_slice(&mapped[start..start + unpadded as usize]);
        }
        drop(mapped);
        readback.unmap();

        Frame {
            width,
            height,
            pixels,
        }
    }

    fn create_buffer(&self, contents: &[u8], usage: wgpu::BufferUsages) -> wgpu::Buffer {
        use wgpu::util::DeviceExt;
        self.device
            .create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: None,
                contents,
                usage,
            })
    }
}

/// Flatten a scene's filled shapes into draw instances (painter's order).
fn flatten(scene: &Scene) -> Vec<InstanceRaw> {
    let mut out = Vec::new();
    collect(&scene.root, Transform::IDENTITY, 1.0, &mut out);
    out
}

fn collect(node: &Node, parent: Transform, parent_opacity: f32, out: &mut Vec<InstanceRaw>) {
    let transform = parent.then(&node.transform);
    let opacity = parent_opacity * node.opacity;

    if let NodeKind::Shape(shape) = &node.kind {
        if let Some(fill) = shape.fill {
            let (size, kind) = match shape.geometry {
                ShapeGeometry::Rect { size, .. } => (size, 0u32),
                ShapeGeometry::Ellipse { size } => (size, 1u32),
            };
            let a = transform.apply(Vec2::ZERO);
            let b = transform.apply(Vec2::new(size.width, size.height));
            out.push(InstanceRaw {
                rect_min: [a.x.min(b.x), a.y.min(b.y)],
                rect_size: [(a.x - b.x).abs(), (a.y - b.y).abs()],
                color: [fill.r, fill.g, fill.b, fill.a * opacity],
                kind,
            });
        }
    }

    for child in &node.children {
        collect(child, transform, opacity, out);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use onda_core::Color;
    use onda_scene::{Composition, Node, Shape};

    #[test]
    fn renders_shapes_on_gpu() {
        let Some(renderer) = GpuRenderer::new() else {
            eprintln!("no GPU adapter; skipping");
            return;
        };
        let scene = Scene::new(Composition::new(64, 64, 30.0, 1)).with_root(
            Node::group().with_child(Node::shape(
                Shape::rect(onda_core::Size::new(64.0, 64.0)).with_fill(Color::rgb(1.0, 0.0, 0.0)),
            )),
        );
        let frame = renderer.render(&scene);
        assert_eq!((frame.width, frame.height), (64, 64));
        assert_eq!(frame.pixels.len(), 64 * 64 * 4);
        // A full-canvas red rect: top-left pixel is opaque red.
        assert_eq!(&frame.pixels[0..4], &[255, 0, 0, 255]);
    }
}
