//! GPU backend for ONDA (wgpu) — shapes + text.
//!
//! Renders a [`Scene`] on the GPU to an offscreen texture and reads it back as
//! straight-alpha RGBA8 — the same `Framebuffer` shape the CPU renderer and
//! `onda export` use. Shapes are instanced quads with an SDF fragment (rects +
//! anti-aliased ellipses); text reuses `onda-typography`'s coverage masks
//! (cosmic-text) uploaded as textures and drawn as quads, so glyphs match the
//! engine. Shapes and text composite in painter's order.
//!
//! Visually equivalent to the CPU reference, not bit-exact. Deferred: strokes,
//! rounded corners, a cached glyph atlas (perf), and the WebGPU/browser build.

mod scene_ops;
mod shaders;

use onda_scene::Scene;
use onda_typography::FontContext;
use scene_ops::{Op, ShapeInstance, TextInstance};
use wgpu::util::DeviceExt;

/// A rendered frame: straight-alpha RGBA8, row-major, top-left origin.
pub struct Frame {
    pub width: u32,
    pub height: u32,
    pub pixels: Vec<u8>,
}

#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
struct Uniforms {
    canvas: [f32; 2],
    _pad: [f32; 2],
}

/// A reusable GPU renderer (device + pipelines + fonts). Construct once.
pub struct GpuRenderer {
    device: wgpu::Device,
    queue: wgpu::Queue,
    shape_pipeline: wgpu::RenderPipeline,
    text_pipeline: wgpu::RenderPipeline,
    uniform_layout: wgpu::BindGroupLayout,
    texture_layout: wgpu::BindGroupLayout,
    sampler: wgpu::Sampler,
    fonts: FontContext,
}

const SHAPE_ATTRS: [wgpu::VertexAttribute; 4] = wgpu::vertex_attr_array![
    0 => Float32x2, 1 => Float32x2, 2 => Float32x4, 3 => Uint32
];
const TEXT_ATTRS: [wgpu::VertexAttribute; 3] = wgpu::vertex_attr_array![
    0 => Float32x2, 1 => Float32x2, 2 => Float32x4
];

impl GpuRenderer {
    /// Acquire a GPU and build the pipelines. `None` if no adapter is available.
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
            source: wgpu::ShaderSource::Wgsl(shaders::SHADER.into()),
        });

        let uniform_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("uniforms"),
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

        let texture_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("coverage texture"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: true },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                    count: None,
                },
            ],
        });

        let shape_pipeline = build_pipeline(
            &device,
            &shader,
            "shapes",
            ("vs", "fs"),
            &[&uniform_layout],
            std::mem::size_of::<ShapeInstance>() as u64,
            &SHAPE_ATTRS,
        );
        let text_pipeline = build_pipeline(
            &device,
            &shader,
            "text",
            ("vs_text", "fs_text"),
            &[&uniform_layout, &texture_layout],
            std::mem::size_of::<TextInstance>() as u64,
            &TEXT_ATTRS,
        );

        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("coverage sampler"),
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });

        Some(GpuRenderer {
            device,
            queue,
            shape_pipeline,
            text_pipeline,
            uniform_layout,
            texture_layout,
            sampler,
            fonts: FontContext::with_default_font(),
        })
    }

    /// Render a scene to a [`Frame`].
    pub fn render(&mut self, scene: &Scene) -> Frame {
        let width = scene.composition.width.max(1);
        let height = scene.composition.height.max(1);
        let collected = scene_ops::collect(scene, &mut self.fonts);

        let target = self.device.create_texture(&wgpu::TextureDescriptor {
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
        let view = target.create_view(&wgpu::TextureViewDescriptor::default());

        let uniforms = Uniforms {
            canvas: [width as f32, height as f32],
            _pad: [0.0; 2],
        };
        let uniform_buffer =
            self.init_buffer(bytemuck::bytes_of(&uniforms), wgpu::BufferUsages::UNIFORM);
        let uniform_bind = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("uniform bind"),
            layout: &self.uniform_layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: uniform_buffer.as_entire_binding(),
            }],
        });

        let shape_buffer = (!collected.shapes.is_empty()).then(|| {
            self.init_buffer(
                bytemuck::cast_slice(&collected.shapes),
                wgpu::BufferUsages::VERTEX,
            )
        });

        // Per text block: a coverage texture + bind group + instance buffer.
        let texts: Vec<(wgpu::BindGroup, wgpu::Buffer)> = collected
            .texts
            .iter()
            .map(|t| self.prepare_text(t))
            .collect();

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
            pass.set_bind_group(0, &uniform_bind, &[]);

            for op in &collected.ops {
                match op {
                    Op::Shape(index) => {
                        if let Some(buffer) = &shape_buffer {
                            pass.set_pipeline(&self.shape_pipeline);
                            pass.set_vertex_buffer(0, buffer.slice(..));
                            pass.draw(0..4, *index..*index + 1);
                        }
                    }
                    Op::Text(index) => {
                        let (bind, buffer) = &texts[*index as usize];
                        pass.set_pipeline(&self.text_pipeline);
                        pass.set_bind_group(1, bind, &[]);
                        pass.set_vertex_buffer(0, buffer.slice(..));
                        pass.draw(0..4, 0..1);
                    }
                }
            }
        }

        self.queue.submit(Some(encoder.finish()));
        self.read_back(&target, width, height)
    }

    fn prepare_text(&self, text: &scene_ops::TextDraw) -> (wgpu::BindGroup, wgpu::Buffer) {
        let texture = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("coverage"),
            size: wgpu::Extent3d {
                width: text.width,
                height: text.height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::R8Unorm,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });
        self.queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            &text.coverage,
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(text.width),
                rows_per_image: Some(text.height),
            },
            wgpu::Extent3d {
                width: text.width,
                height: text.height,
                depth_or_array_layers: 1,
            },
        );
        let tex_view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        let bind = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("text bind"),
            layout: &self.texture_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(&tex_view),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::Sampler(&self.sampler),
                },
            ],
        });
        let buffer = self.init_buffer(
            bytemuck::bytes_of(&text.instance),
            wgpu::BufferUsages::VERTEX,
        );
        (bind, buffer)
    }

    fn read_back(&self, target: &wgpu::Texture, width: u32, height: u32) -> Frame {
        let unpadded = width * 4;
        let padded = unpadded.div_ceil(256) * 256;
        let readback = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("readback"),
            size: (padded * height) as u64,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });

        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor::default());
        encoder.copy_texture_to_buffer(
            wgpu::TexelCopyTextureInfo {
                texture: target,
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

    fn init_buffer(&self, contents: &[u8], usage: wgpu::BufferUsages) -> wgpu::Buffer {
        self.device
            .create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: None,
                contents,
                usage,
            })
    }
}

#[allow(clippy::too_many_arguments)]
fn build_pipeline(
    device: &wgpu::Device,
    shader: &wgpu::ShaderModule,
    label: &str,
    entries: (&str, &str),
    bind_group_layouts: &[&wgpu::BindGroupLayout],
    array_stride: u64,
    attributes: &[wgpu::VertexAttribute],
) -> wgpu::RenderPipeline {
    let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
        label: Some(label),
        bind_group_layouts,
        push_constant_ranges: &[],
    });
    device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: Some(label),
        layout: Some(&layout),
        vertex: wgpu::VertexState {
            module: shader,
            entry_point: Some(entries.0),
            buffers: &[wgpu::VertexBufferLayout {
                array_stride,
                step_mode: wgpu::VertexStepMode::Instance,
                attributes,
            }],
            compilation_options: wgpu::PipelineCompilationOptions::default(),
        },
        fragment: Some(wgpu::FragmentState {
            module: shader,
            entry_point: Some(entries.1),
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
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use onda_core::{Color, Size};
    use onda_scene::{Composition, Node, Shape};

    #[test]
    fn renders_shapes_and_text_on_gpu() {
        let Some(mut renderer) = GpuRenderer::new() else {
            eprintln!("no GPU adapter; skipping");
            return;
        };
        let scene = Scene::new(Composition::new(200, 80, 30.0, 1)).with_root(
            Node::group().with_children([
                Node::shape(
                    Shape::rect(Size::new(200.0, 80.0)).with_fill(Color::rgb(0.0, 0.0, 0.0)),
                ),
                Node::text("Hi").with_transform(onda_core::Transform {
                    translate: onda_core::Vec2::new(10.0, 10.0),
                    scale: onda_core::Vec2::splat(1.0),
                }),
            ]),
        );
        let frame = renderer.render(&scene);
        assert_eq!(frame.pixels.len(), 200 * 80 * 4);
        // Backdrop is opaque black everywhere.
        assert_eq!(frame.pixels[3], 255);
        // The text contributes some non-black pixels (white-ish on black).
        let lit = frame.pixels.chunks_exact(4).filter(|p| p[0] > 40).count();
        assert!(lit > 0, "expected text pixels");
    }
}
