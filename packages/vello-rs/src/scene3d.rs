//! The GPU **3D pass**: composite 3D LAYERS — each a 2D layer already rasterized to
//! its own texture — as textured quads in one shared perspective world.
//!
//! The scene walk hands us, per layer, a content texture and an `mvp` (the layer's
//! local-content plane → clip space, built from the perspective camera + the layer's
//! [`scene::Transform3D`] with `glam`). We draw each as a unit quad with a real depth
//! buffer (so layers occlude — and *intersect* — by true 3D depth, not a painter's
//! sort), into a premultiplied target, then un-premultiply to a STRAIGHT-alpha output
//! texture (vello's convention) so the composite hands back exactly like an effect.
//!
//! This is the engine's only *render* (vertex/fragment) pipeline — every effect is a
//! compute pass — so the boilerplate lives here in full.

use crate::extrude::MeshVertex;
use vello::wgpu;

/// One 3D layer to draw: its rasterized content + the model-view-projection that
/// places its unit quad (`[0,1]²` mapped onto the texture) in clip space.
pub struct Layer3D {
    pub texture: wgpu::Texture,
    pub mvp: glam::Mat4,
}

/// One EXTRUDED 3D layer: its solid mesh (triangle list with normals), the `mvp` for
/// clip space, the `model` (to rotate normals for lighting), and its base fill colour.
pub struct Mesh3D {
    pub vertices: Vec<MeshVertex>,
    pub mvp: glam::Mat4,
    pub model: glam::Mat4,
    pub color: [f32; 4],
}

/// The 3D render pass (pipelines + layouts + sampler), built once and reused.
pub struct Scene3D {
    /// Textured-quad render pipeline (depth-tested, premultiplied src-over blend).
    pipeline: wgpu::RenderPipeline,
    /// `group(0)`: the per-quad `mvp` uniform.
    mvp_layout: wgpu::BindGroupLayout,
    /// `group(1)`: the layer's content texture + sampler.
    tex_layout: wgpu::BindGroupLayout,
    sampler: wgpu::Sampler,
    /// Extruded-solid render pipeline (depth-tested, lit; shares the depth buffer).
    mesh_pipeline: wgpu::RenderPipeline,
    /// `group(0)` for meshes: the per-mesh `mvp` + `model` + base colour uniform.
    mesh_layout: wgpu::BindGroupLayout,
    /// Un-premultiply compute: premultiplied target → straight-alpha output.
    unpremul_pipeline: wgpu::ComputePipeline,
    unpremul_layout: wgpu::BindGroupLayout,
}

/// Per-mesh uniform: clip transform, model (for normals), and base colour.
#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
struct MeshUniform {
    mvp: [[f32; 4]; 4],
    model: [[f32; 4]; 4],
    color: [f32; 4],
}

const RENDER_WGSL: &str = r#"
struct Uniform { mvp: mat4x4<f32> };
@group(0) @binding(0) var<uniform> u: Uniform;
@group(1) @binding(0) var tex: texture_2d<f32>;
@group(1) @binding(1) var samp: sampler;

struct VsOut {
    @builtin(position) clip: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VsOut {
    // Unit quad [0,1]^2 as a triangle strip: (0,0) (1,0) (0,1) (1,1).
    let x = f32(vi & 1u);
    let y = f32((vi >> 1u) & 1u);
    var o: VsOut;
    o.uv = vec2<f32>(x, y);
    o.clip = u.mvp * vec4<f32>(x, y, 0.0, 1.0);
    return o;
}

@fragment
fn fs(in: VsOut) -> @location(0) vec4<f32> {
    // Straight-alpha source → premultiplied output, so the `One / OneMinusSrcAlpha`
    // blend composites correctly (and AA edges don't fringe). Un-premultiplied later.
    let c = textureSample(tex, samp, in.uv);
    return vec4<f32>(c.rgb * c.a, c.a);
}
"#;

const MESH_WGSL: &str = r#"
struct MU {
    mvp: mat4x4<f32>,
    model: mat4x4<f32>,
    color: vec4<f32>,
};
@group(0) @binding(0) var<uniform> u: MU;

struct VsOut {
    @builtin(position) clip: vec4<f32>,
    @location(0) normal: vec3<f32>,
};

@vertex
fn vs(@location(0) pos: vec3<f32>, @location(1) normal: vec3<f32>) -> VsOut {
    var o: VsOut;
    o.clip = u.mvp * vec4<f32>(pos, 1.0);
    // Rotate the normal by the model (no scale on an extruded mesh → upper 3x3 is rotation).
    o.normal = (u.model * vec4<f32>(normal, 0.0)).xyz;
    return o;
}

@fragment
fn fs(in: VsOut) -> @location(0) vec4<f32> {
    // One directional key light from the upper-left, toward the camera (which is at -z).
    let to_light = normalize(vec3<f32>(-0.35, -0.55, -0.75));
    let n = normalize(in.normal);
    let diff = max(dot(n, to_light), 0.0);
    let ambient = 0.45;
    let shade = ambient + (1.0 - ambient) * diff;
    let rgb = u.color.rgb * shade;
    // Premultiplied output (matches the quad blend); extruded solids are opaque.
    return vec4<f32>(rgb * u.color.a, u.color.a);
}
"#;

const UNPREMUL_WGSL: &str = r#"
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var dst: texture_storage_2d<rgba8unorm, write>;

@compute @workgroup_size(8, 8)
fn unpremul(@builtin(global_invocation_id) gid: vec3<u32>) {
    let dims = textureDimensions(src);
    if (gid.x >= dims.x || gid.y >= dims.y) { return; }
    let c = textureLoad(src, vec2<i32>(gid.xy), 0);
    var rgb = vec3<f32>(0.0, 0.0, 0.0);
    if (c.a > 0.0) { rgb = c.rgb / c.a; }
    textureStore(dst, vec2<i32>(gid.xy), vec4<f32>(rgb, c.a));
}
"#;

const DEPTH_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Depth32Float;
const COLOR_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba8Unorm;

impl Scene3D {
    pub fn new(device: &wgpu::Device) -> Self {
        let render_module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("onda-scene3d-render-wgsl"),
            source: wgpu::ShaderSource::Wgsl(RENDER_WGSL.into()),
        });

        let mvp_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("onda-scene3d-mvp"),
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

        let tex_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("onda-scene3d-tex"),
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

        let render_pl_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("onda-scene3d-render-layout"),
            bind_group_layouts: &[&mvp_layout, &tex_layout],
            push_constant_ranges: &[],
        });

        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("onda-scene3d-pipeline"),
            layout: Some(&render_pl_layout),
            vertex: wgpu::VertexState {
                module: &render_module,
                entry_point: "vs",
                buffers: &[],
                compilation_options: wgpu::PipelineCompilationOptions::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module: &render_module,
                entry_point: "fs",
                targets: &[Some(wgpu::ColorTargetState {
                    format: COLOR_FORMAT,
                    // Premultiplied src-over: out = src + dst·(1 − src.a).
                    blend: Some(wgpu::BlendState {
                        color: wgpu::BlendComponent {
                            src_factor: wgpu::BlendFactor::One,
                            dst_factor: wgpu::BlendFactor::OneMinusSrcAlpha,
                            operation: wgpu::BlendOperation::Add,
                        },
                        alpha: wgpu::BlendComponent {
                            src_factor: wgpu::BlendFactor::One,
                            dst_factor: wgpu::BlendFactor::OneMinusSrcAlpha,
                            operation: wgpu::BlendOperation::Add,
                        },
                    }),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
                compilation_options: wgpu::PipelineCompilationOptions::default(),
            }),
            primitive: wgpu::PrimitiveState {
                topology: wgpu::PrimitiveTopology::TriangleStrip,
                // A flat layer is double-sided: rotating it past edge-on shows its back.
                cull_mode: None,
                ..Default::default()
            },
            depth_stencil: Some(wgpu::DepthStencilState {
                format: DEPTH_FORMAT,
                depth_write_enabled: true,
                depth_compare: wgpu::CompareFunction::LessEqual,
                stencil: wgpu::StencilState::default(),
                bias: wgpu::DepthBiasState::default(),
            }),
            multisample: wgpu::MultisampleState::default(),
            multiview: None,
            cache: None,
        });

        // Extruded-solid pipeline: a lit mesh (pos + normal vertices) sharing the depth
        // buffer with the quads, so meshes and planes occlude each other by true depth.
        let mesh_module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("onda-scene3d-mesh-wgsl"),
            source: wgpu::ShaderSource::Wgsl(MESH_WGSL.into()),
        });
        let mesh_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("onda-scene3d-mesh-uniform"),
            entries: &[wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::VERTEX | wgpu::ShaderStages::FRAGMENT,
                ty: wgpu::BindingType::Buffer {
                    ty: wgpu::BufferBindingType::Uniform,
                    has_dynamic_offset: false,
                    min_binding_size: None,
                },
                count: None,
            }],
        });
        let mesh_pl_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("onda-scene3d-mesh-layout"),
            bind_group_layouts: &[&mesh_layout],
            push_constant_ranges: &[],
        });
        let mesh_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("onda-scene3d-mesh-pipeline"),
            layout: Some(&mesh_pl_layout),
            vertex: wgpu::VertexState {
                module: &mesh_module,
                entry_point: "vs",
                buffers: &[wgpu::VertexBufferLayout {
                    array_stride: std::mem::size_of::<MeshVertex>() as u64,
                    step_mode: wgpu::VertexStepMode::Vertex,
                    attributes: &[
                        wgpu::VertexAttribute {
                            format: wgpu::VertexFormat::Float32x3,
                            offset: 0,
                            shader_location: 0,
                        },
                        wgpu::VertexAttribute {
                            format: wgpu::VertexFormat::Float32x3,
                            offset: 12,
                            shader_location: 1,
                        },
                    ],
                }],
                compilation_options: wgpu::PipelineCompilationOptions::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module: &mesh_module,
                entry_point: "fs",
                targets: &[Some(wgpu::ColorTargetState {
                    format: COLOR_FORMAT,
                    blend: Some(wgpu::BlendState {
                        color: wgpu::BlendComponent {
                            src_factor: wgpu::BlendFactor::One,
                            dst_factor: wgpu::BlendFactor::OneMinusSrcAlpha,
                            operation: wgpu::BlendOperation::Add,
                        },
                        alpha: wgpu::BlendComponent {
                            src_factor: wgpu::BlendFactor::One,
                            dst_factor: wgpu::BlendFactor::OneMinusSrcAlpha,
                            operation: wgpu::BlendOperation::Add,
                        },
                    }),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
                compilation_options: wgpu::PipelineCompilationOptions::default(),
            }),
            primitive: wgpu::PrimitiveState {
                topology: wgpu::PrimitiveTopology::TriangleList,
                // Double-sided so thin/edge-on solids and back faces never vanish.
                cull_mode: None,
                ..Default::default()
            },
            depth_stencil: Some(wgpu::DepthStencilState {
                format: DEPTH_FORMAT,
                depth_write_enabled: true,
                depth_compare: wgpu::CompareFunction::LessEqual,
                stencil: wgpu::StencilState::default(),
                bias: wgpu::DepthBiasState::default(),
            }),
            multisample: wgpu::MultisampleState::default(),
            multiview: None,
            cache: None,
        });

        let unpremul_module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("onda-scene3d-unpremul-wgsl"),
            source: wgpu::ShaderSource::Wgsl(UNPREMUL_WGSL.into()),
        });
        let unpremul_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("onda-scene3d-unpremul"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: false },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::StorageTexture {
                        access: wgpu::StorageTextureAccess::WriteOnly,
                        format: COLOR_FORMAT,
                        view_dimension: wgpu::TextureViewDimension::D2,
                    },
                    count: None,
                },
            ],
        });
        let unpremul_pl_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("onda-scene3d-unpremul-layout"),
            bind_group_layouts: &[&unpremul_layout],
            push_constant_ranges: &[],
        });
        let unpremul_pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some("onda-scene3d-unpremul-pipeline"),
            layout: Some(&unpremul_pl_layout),
            module: &unpremul_module,
            entry_point: "unpremul",
            compilation_options: wgpu::PipelineCompilationOptions::default(),
            cache: None,
        });

        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("onda-scene3d-sampler"),
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            mipmap_filter: wgpu::FilterMode::Linear,
            // Clamp so the bilinear tap at a quad edge never wraps the opposite side in.
            address_mode_u: wgpu::AddressMode::ClampToEdge,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            address_mode_w: wgpu::AddressMode::ClampToEdge,
            ..Default::default()
        });

        Scene3D {
            pipeline,
            mvp_layout,
            tex_layout,
            sampler,
            mesh_pipeline,
            mesh_layout,
            unpremul_pipeline,
            unpremul_layout,
        }
    }

    /// Render `layers` (already depth-ordered far→near by the caller, so blended edges
    /// composite correctly) to a fresh straight-alpha `width × height` texture.
    pub fn run(
        &self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        layers: &[Layer3D],
        meshes: &[Mesh3D],
        width: u32,
        height: u32,
    ) -> wgpu::Texture {
        // Premultiplied render target (drawn into), depth buffer, and the straight-alpha
        // output the un-premultiply writes (and vello copies into its atlas).
        let premul = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("onda-scene3d-premul"),
            size: wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: COLOR_FORMAT,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        });
        let depth = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("onda-scene3d-depth"),
            size: wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: DEPTH_FORMAT,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            view_formats: &[],
        });
        let out = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("onda-scene3d-out"),
            size: wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: COLOR_FORMAT,
            usage: wgpu::TextureUsages::STORAGE_BINDING
                | wgpu::TextureUsages::TEXTURE_BINDING
                | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });

        let premul_view = premul.create_view(&wgpu::TextureViewDescriptor::default());
        let depth_view = depth.create_view(&wgpu::TextureViewDescriptor::default());

        // Per-layer uniform buffer + bind groups (kept alive until submit).
        let mut mvp_bgs: Vec<wgpu::BindGroup> = Vec::with_capacity(layers.len());
        let mut tex_bgs: Vec<wgpu::BindGroup> = Vec::with_capacity(layers.len());
        for layer in layers {
            let mvp = layer.mvp.to_cols_array(); // column-major [f32; 16], wgsl mat4 layout
            let buf = device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("onda-scene3d-mvp-buf"),
                size: 64,
                usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            });
            queue.write_buffer(&buf, 0, bytemuck::cast_slice(&mvp));
            mvp_bgs.push(device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("onda-scene3d-mvp-bg"),
                layout: &self.mvp_layout,
                entries: &[wgpu::BindGroupEntry {
                    binding: 0,
                    resource: buf.as_entire_binding(),
                }],
            }));
            let tview = layer
                .texture
                .create_view(&wgpu::TextureViewDescriptor::default());
            tex_bgs.push(device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("onda-scene3d-tex-bg"),
                layout: &self.tex_layout,
                entries: &[
                    wgpu::BindGroupEntry {
                        binding: 0,
                        resource: wgpu::BindingResource::TextureView(&tview),
                    },
                    wgpu::BindGroupEntry {
                        binding: 1,
                        resource: wgpu::BindingResource::Sampler(&self.sampler),
                    },
                ],
            }));
        }

        // Per-mesh vertex buffer + uniform bind group (kept alive until submit).
        let mut mesh_vbufs: Vec<(wgpu::Buffer, u32)> = Vec::with_capacity(meshes.len());
        let mut mesh_bgs: Vec<wgpu::BindGroup> = Vec::with_capacity(meshes.len());
        for mesh in meshes {
            let count = mesh.vertices.len() as u32;
            let vbuf = device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("onda-scene3d-mesh-vbuf"),
                size: (std::mem::size_of::<MeshVertex>() * mesh.vertices.len().max(1)) as u64,
                usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            });
            if count > 0 {
                queue.write_buffer(&vbuf, 0, bytemuck::cast_slice(&mesh.vertices));
            }
            mesh_vbufs.push((vbuf, count));
            let uni = MeshUniform {
                mvp: mesh.mvp.to_cols_array_2d(),
                model: mesh.model.to_cols_array_2d(),
                color: mesh.color,
            };
            let ubuf = device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("onda-scene3d-mesh-ubuf"),
                size: std::mem::size_of::<MeshUniform>() as u64,
                usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            });
            queue.write_buffer(&ubuf, 0, bytemuck::cast_slice(&[uni]));
            mesh_bgs.push(device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("onda-scene3d-mesh-bg"),
                layout: &self.mesh_layout,
                entries: &[wgpu::BindGroupEntry {
                    binding: 0,
                    resource: ubuf.as_entire_binding(),
                }],
            }));
        }

        let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("onda-scene3d"),
        });
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("onda-scene3d-pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &premul_view,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                    view: &depth_view,
                    depth_ops: Some(wgpu::Operations {
                        load: wgpu::LoadOp::Clear(1.0),
                        store: wgpu::StoreOp::Discard,
                    }),
                    stencil_ops: None,
                }),
                timestamp_writes: None,
                occlusion_query_set: None,
            });
            // Opaque extruded solids first (they depth-write), then the textured quads.
            pass.set_pipeline(&self.mesh_pipeline);
            for i in 0..meshes.len() {
                let (vbuf, count) = &mesh_vbufs[i];
                if *count == 0 {
                    continue;
                }
                pass.set_bind_group(0, &mesh_bgs[i], &[]);
                pass.set_vertex_buffer(0, vbuf.slice(..));
                pass.draw(0..*count, 0..1);
            }
            pass.set_pipeline(&self.pipeline);
            for i in 0..layers.len() {
                pass.set_bind_group(0, &mvp_bgs[i], &[]);
                pass.set_bind_group(1, &tex_bgs[i], &[]);
                pass.draw(0..4, 0..1);
            }
        }

        // Un-premultiply the target into the straight-alpha output.
        let src_view = premul.create_view(&wgpu::TextureViewDescriptor::default());
        let dst_view = out.create_view(&wgpu::TextureViewDescriptor::default());
        let unpremul_bg = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("onda-scene3d-unpremul-bg"),
            layout: &self.unpremul_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(&src_view),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::TextureView(&dst_view),
                },
            ],
        });
        {
            let mut cpass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: Some("onda-scene3d-unpremul"),
                timestamp_writes: None,
            });
            cpass.set_pipeline(&self.unpremul_pipeline);
            cpass.set_bind_group(0, &unpremul_bg, &[]);
            cpass.dispatch_workgroups(width.div_ceil(8), height.div_ceil(8), 1);
        }

        queue.submit(Some(encoder.finish()));
        out
    }
}
