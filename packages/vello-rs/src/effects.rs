//! GPU post-process effects that run on a texture *after* Vello has rasterized a
//! node's subtree (the render-to-texture seam). These are plain `wgpu` compute
//! passes — they never inject into Vello's own pass; each runs as its own command
//! encoder + submit, bracketed between two independent Vello renders.
//!
//! Today this is a single effect: a separable 2-pass Gaussian blur. The design
//! is deliberately Dawn-portable (the same discipline the renderer keeps for
//! Vello-on-WebGPU):
//!
//! - **Ping-pong, never `read_write` storage.** Each pass reads the source as a
//!   *sampled* `texture_2d<f32>` and writes a *separate* `Rgba8Unorm` storage
//!   texture. Dawn rejects `read_write` storage on `rgba8unorm`, so we bounce
//!   between two textures (H-pass: src → tmp, V-pass: tmp → dst).
//! - **8×8 workgroup.** Well under WebGPU's guaranteed 256-invocation floor.
//! - **Gaussian weights computed CPU-side** from `sigma` (radius = `ceil(3σ)`)
//!   and uploaded as a storage buffer — the shader just samples and accumulates.

use vello::wgpu;

/// Compute-shader source for one separable Gaussian pass. `direction` in the
/// params selects horizontal (0) vs vertical (1); the host runs it twice.
///
/// Reads `src` (via `textureLoad`, clamp-to-edge) and writes `dst` (storage). The
/// taps run from `-radius..=radius`; `weights[i]` holds the weight for offset
/// `i - radius`, normalized CPU-side to sum to 1.
const BLUR_WGSL: &str = r#"
struct Params {
    radius: u32,
    width: u32,
    height: u32,
    dir_x: f32, // sample step per tap: (1,0)=horizontal, (0,1)=vertical, else angled
    dir_y: f32,
};

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var dst: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> params: Params;
@group(0) @binding(3) var<storage, read> weights: array<f32>;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let x = gid.x;
    let y = gid.y;
    if (x >= params.width || y >= params.height) {
        return;
    }

    let r = i32(params.radius);
    var acc = vec4<f32>(0.0, 0.0, 0.0, 0.0);
    let maxx = i32(params.width) - 1;
    let maxy = i32(params.height) - 1;

    for (var i: i32 = -r; i <= r; i = i + 1) {
        // Sample along the (dir_x, dir_y) axis, rounding to the nearest pixel (the
        // CPU reference rounds identically). (1,0) reproduces the old horizontal
        // pass and (0,1) the vertical; an arbitrary unit vector blurs directionally.
        let off = f32(i);
        let sx = clamp(i32(round(f32(x) + off * params.dir_x)), 0, maxx);
        let sy = clamp(i32(round(f32(y) + off * params.dir_y)), 0, maxy);
        let w = weights[u32(i + r)];
        // Premultiply by alpha so the blur doesn't bleed transparent-black into
        // edges (straight-alpha source → premultiplied accumulation → un-premul).
        let texel = textureLoad(src, vec2<i32>(sx, sy), 0);
        acc = acc + vec4<f32>(texel.rgb * texel.a, texel.a) * w;
    }

    // Un-premultiply back to straight alpha for the next pass / readback.
    var out_rgb = vec3<f32>(0.0, 0.0, 0.0);
    if (acc.a > 0.0001) {
        out_rgb = acc.rgb / acc.a;
    }
    textureStore(dst, vec2<i32>(i32(x), i32(y)), vec4<f32>(out_rgb, acc.a));
}
"#;

/// Lazily-built, reusable Gaussian-blur compute pipeline. Created once and cached
/// on the renderer; the bind-group layout and pipeline are device-global, the
/// per-blur textures/buffers are allocated per call.
pub struct GaussianBlur {
    pipeline: wgpu::ComputePipeline,
    bind_group_layout: wgpu::BindGroupLayout,
}

/// Byte size of the params uniform (4 × u32).
const PARAMS_SIZE: u64 = 32;

impl GaussianBlur {
    /// Build the pipeline + bind-group layout. Cached on the renderer (call once).
    pub fn new(device: &wgpu::Device) -> Self {
        let module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("onda-blur-wgsl"),
            source: wgpu::ShaderSource::Wgsl(BLUR_WGSL.into()),
        });

        let bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("onda-blur-bgl"),
            entries: &[
                // 0: source, sampled (read).
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
                // 1: destination, storage (write). Rgba8Unorm — never read_write.
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::StorageTexture {
                        access: wgpu::StorageTextureAccess::WriteOnly,
                        format: wgpu::TextureFormat::Rgba8Unorm,
                        view_dimension: wgpu::TextureViewDimension::D2,
                    },
                    count: None,
                },
                // 2: params uniform.
                wgpu::BindGroupLayoutEntry {
                    binding: 2,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                // 3: gaussian weights, read-only storage.
                wgpu::BindGroupLayoutEntry {
                    binding: 3,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Storage { read_only: true },
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
            ],
        });

        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("onda-blur-pl"),
            bind_group_layouts: &[&bind_group_layout],
            push_constant_ranges: &[],
        });

        let pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some("onda-blur-pipeline"),
            layout: Some(&pipeline_layout),
            module: &module,
            entry_point: "main",
            compilation_options: wgpu::PipelineCompilationOptions::default(),
            cache: None,
        });

        GaussianBlur {
            pipeline,
            bind_group_layout,
        }
    }

    /// Blur `source` (a texture produced by `render_vscene_to_texture`), returning
    /// a new `Rgba8Unorm` texture (usage `COPY_SRC`, ready for the existing
    /// readback path). `source` must carry `TEXTURE_BINDING` usage.
    ///
    /// Runs two compute passes (H then V) over ping-pong textures, as its **own**
    /// command encoder + submit — it never touches Vello's pass. A non-positive
    /// sigma is a no-op copy (returns a fresh texture equal to the source).
    pub fn run(
        &self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        source: &wgpu::Texture,
        width: u32,
        height: u32,
        sigma: f32,
    ) -> wgpu::Texture {
        let weights = gaussian_weights(sigma);
        let radius = (weights.len() / 2) as u32;

        // Weights as a read-only storage buffer (f32 little-endian bytes).
        let weight_bytes: Vec<u8> = weights.iter().flat_map(|w| w.to_le_bytes()).collect();
        let weight_buf = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("onda-blur-weights"),
            size: weight_bytes.len() as u64,
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        queue.write_buffer(&weight_buf, 0, &weight_bytes);

        // Two ping-pong storage textures. The source is the first read; the H pass
        // writes `tex_a`, the V pass reads `tex_a` and writes `tex_b` (returned).
        let make_pingpong = |label: &str| {
            device.create_texture(&wgpu::TextureDescriptor {
                label: Some(label),
                size: wgpu::Extent3d {
                    width,
                    height,
                    depth_or_array_layers: 1,
                },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: wgpu::TextureFormat::Rgba8Unorm,
                // STORAGE: written by the compute pass. TEXTURE_BINDING: the H
                // output is sampled by the V pass. COPY_SRC: the final texture is
                // read back.
                usage: wgpu::TextureUsages::STORAGE_BINDING
                    | wgpu::TextureUsages::TEXTURE_BINDING
                    | wgpu::TextureUsages::COPY_SRC,
                view_formats: &[],
            })
        };
        let tex_a = make_pingpong("onda-blur-tmp"); // H output
        let tex_b = make_pingpong("onda-blur-out"); // V output (returned)

        let src_view = source.create_view(&wgpu::TextureViewDescriptor::default());
        let a_view = tex_a.create_view(&wgpu::TextureViewDescriptor::default());
        let b_view = tex_b.create_view(&wgpu::TextureViewDescriptor::default());

        // Per-pass params uniforms (direction differs): horizontal then vertical.
        let params_h = make_params(device, queue, radius, 1.0, 0.0, width, height);
        let params_v = make_params(device, queue, radius, 0.0, 1.0, width, height);

        let bg_h = self.make_bind_group(device, &src_view, &a_view, &params_h, &weight_buf);
        let bg_v = self.make_bind_group(device, &a_view, &b_view, &params_v, &weight_buf);

        let gx = width.div_ceil(8);
        let gy = height.div_ceil(8);

        let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("onda-blur-encoder"),
        });
        {
            let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: Some("onda-blur-h"),
                timestamp_writes: None,
            });
            pass.set_pipeline(&self.pipeline);
            pass.set_bind_group(0, &bg_h, &[]);
            pass.dispatch_workgroups(gx, gy, 1);
        }
        {
            let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: Some("onda-blur-v"),
                timestamp_writes: None,
            });
            pass.set_pipeline(&self.pipeline);
            pass.set_bind_group(0, &bg_v, &[]);
            pass.dispatch_workgroups(gx, gy, 1);
        }
        queue.submit(Some(encoder.finish()));

        tex_b
    }

    /// Like [`GaussianBlur::run`] but a SINGLE pass along the unit direction
    /// `(dx, dy)` — a directional / motion blur. Reuses the same pipeline and the
    /// generalized direction param (`(1,0)`/`(0,1)` would be one separable pass).
    pub fn run_directional(
        &self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        source: &wgpu::Texture,
        width: u32,
        height: u32,
        sigma: f32,
        dx: f32,
        dy: f32,
    ) -> wgpu::Texture {
        let weights = gaussian_weights(sigma);
        let radius = (weights.len() / 2) as u32;

        let weight_bytes: Vec<u8> = weights.iter().flat_map(|w| w.to_le_bytes()).collect();
        let weight_buf = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("onda-dirblur-weights"),
            size: weight_bytes.len() as u64,
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        queue.write_buffer(&weight_buf, 0, &weight_bytes);

        let out = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("onda-dirblur-out"),
            size: wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::STORAGE_BINDING
                | wgpu::TextureUsages::TEXTURE_BINDING
                | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let src_view = source.create_view(&wgpu::TextureViewDescriptor::default());
        let out_view = out.create_view(&wgpu::TextureViewDescriptor::default());
        let params = make_params(device, queue, radius, dx, dy, width, height);
        let bg = self.make_bind_group(device, &src_view, &out_view, &params, &weight_buf);

        let gx = width.div_ceil(8);
        let gy = height.div_ceil(8);
        let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("onda-dirblur-encoder"),
        });
        {
            let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: Some("onda-dirblur"),
                timestamp_writes: None,
            });
            pass.set_pipeline(&self.pipeline);
            pass.set_bind_group(0, &bg, &[]);
            pass.dispatch_workgroups(gx, gy, 1);
        }
        queue.submit(Some(encoder.finish()));
        out
    }

    fn make_bind_group(
        &self,
        device: &wgpu::Device,
        src_view: &wgpu::TextureView,
        dst_view: &wgpu::TextureView,
        params: &wgpu::Buffer,
        weights: &wgpu::Buffer,
    ) -> wgpu::BindGroup {
        device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("onda-blur-bg"),
            layout: &self.bind_group_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(src_view),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::TextureView(dst_view),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: params.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 3,
                    resource: weights.as_entire_binding(),
                },
            ],
        })
    }
}

/// Compute shader: the bloom **bright-pass**. Reads the sharp subtree texture and
/// writes a texture holding only its highlights — pixels whose Rec. 709 luminance
/// is at/above `threshold` keep their (intensity-scaled, clamped) color at full
/// alpha; everything else is transparent. The result is then blurred (the reused
/// Gaussian compute) and added back over the sharp pixels by [`BLOOM_COMPOSITE_WGSL`].
const BLOOM_BRIGHT_WGSL: &str = r#"
struct Params {
    threshold: f32,
    intensity: f32,
    width: u32,
    height: u32,
};

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var dst: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> params: Params;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let x = gid.x;
    let y = gid.y;
    if (x >= params.width || y >= params.height) {
        return;
    }
    let texel = textureLoad(src, vec2<i32>(i32(x), i32(y)), 0);
    // Luminance on straight-alpha RGB (Rec. 709). Transparent pixels emit no light.
    let luma = dot(texel.rgb, vec3<f32>(0.2126, 0.7152, 0.0722));
    var out = vec4<f32>(0.0, 0.0, 0.0, 0.0);
    if (texel.a > 0.0 && luma >= params.threshold) {
        // Keep the scaled color at full alpha so the blur spreads a solid highlight.
        out = vec4<f32>(clamp(texel.rgb * params.intensity, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
    }
    textureStore(dst, vec2<i32>(i32(x), i32(y)), out);
}
"#;

/// Compute shader: the bloom **additive composite**. Adds the blurred halo
/// (`bloom`, weighted by its alpha) onto the sharp subtree (`sharp`), clamping each
/// channel — so a bright accent glows as *light* rather than a flat overlay.
const BLOOM_COMPOSITE_WGSL: &str = r#"
struct Dims {
    width: u32,
    height: u32,
    linear: u32,     // 0 = gamma clamp (default), 1 = linear-light + ACES roll-off
    exposure: f32,   // pre-tone-map exposure (linear mode only)
    halation: f32,   // warm-fringe strength (linear mode only; 0 = none)
    _p0: f32,
    _p1: f32,
    _p2: f32,
};

@group(0) @binding(0) var sharp: texture_2d<f32>;
@group(0) @binding(1) var bloom: texture_2d<f32>;
@group(0) @binding(2) var dst: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(3) var<uniform> dims: Dims;

fn srgb_to_linear(c: vec3<f32>) -> vec3<f32> {
    let lo = c / 12.92;
    let hi = pow((c + 0.055) / 1.055, vec3<f32>(2.4));
    return select(hi, lo, c <= vec3<f32>(0.04045));
}
fn linear_to_srgb(c: vec3<f32>) -> vec3<f32> {
    let cc = clamp(c, vec3<f32>(0.0), vec3<f32>(1.0));
    let lo = cc * 12.92;
    let hi = 1.055 * pow(cc, vec3<f32>(1.0 / 2.4)) - 0.055;
    return select(hi, lo, cc <= vec3<f32>(0.0031308));
}
// ACES filmic tone-map (Narkowicz approximation): rolls highlights off smoothly.
fn aces(x: vec3<f32>) -> vec3<f32> {
    let a = 2.51; let b = 0.03; let c = 2.43; let d = 0.59; let e = 0.14;
    return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3<f32>(0.0), vec3<f32>(1.0));
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let x = gid.x;
    let y = gid.y;
    if (x >= dims.width || y >= dims.height) {
        return;
    }
    let p = vec2<i32>(i32(x), i32(y));
    let s = textureLoad(sharp, p, 0);
    let b = textureLoad(bloom, p, 0);
    // The halo color, pre-weighted by its coverage.
    let add = b.rgb * b.a;
    var rgb: vec3<f32>;
    if (dims.linear == 1u) {
        // Composite in LINEAR light, then ACES tone-map → the highlight + halo read as
        // real light bleed (smooth roll-off) instead of a clipped flat overlay. The
        // tone-map lives HERE (where the bloom's HDR values >1.0 exist before clamping)
        // rather than comp-wide, because Vello hands back 8-bit between passes — no HDR
        // survives to a final comp-level transform.
        let halo = srgb_to_linear(add);
        // HALATION: film bleeds a warm red/orange ghost around highlights (the red dye
        // layer scatters more than blue). Add a warm-tinted echo of the halo before the
        // tone-map so bright accents glow with a filmic warm fringe.
        let halation = halo * vec3<f32>(0.55, 0.18, 0.06) * dims.halation;
        let lit = (srgb_to_linear(s.rgb) + halo + halation) * dims.exposure;
        rgb = linear_to_srgb(aces(lit));
    } else {
        // Default gamma path (unchanged): additive + clamp.
        rgb = clamp(s.rgb + add, vec3<f32>(0.0), vec3<f32>(1.0));
    }
    let a = clamp(s.a + b.a, 0.0, 1.0);
    textureStore(dst, p, vec4<f32>(rgb, a));
}
"#;

/// Lazily-built bloom pipelines: a bright-pass + an additive composite, both reusing
/// the cached [`GaussianBlur`] for the spread in between. Cached on the renderer.
pub struct Bloom {
    bright_pipeline: wgpu::ComputePipeline,
    bright_layout: wgpu::BindGroupLayout,
    composite_pipeline: wgpu::ComputePipeline,
    composite_layout: wgpu::BindGroupLayout,
}

/// Byte size of the bloom bright-pass params (f32, f32, u32, u32).
const BLOOM_BRIGHT_PARAMS_SIZE: u64 = 16;
/// Byte size of the composite dims uniform (4 × u32, padded to 16 for std140).
const BLOOM_DIMS_SIZE: u64 = 32;

impl Bloom {
    /// Build both compute pipelines + their bind-group layouts. Cache on the
    /// renderer (call once); the per-call textures/buffers are allocated in `run`.
    pub fn new(device: &wgpu::Device) -> Self {
        // Bright-pass: src (sampled) → dst (storage) + params uniform.
        let bright_module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("onda-bloom-bright-wgsl"),
            source: wgpu::ShaderSource::Wgsl(BLOOM_BRIGHT_WGSL.into()),
        });
        let bright_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("onda-bloom-bright-bgl"),
            entries: &[
                sampled_texture_entry(0),
                storage_texture_entry(1),
                uniform_entry(2),
            ],
        });
        let bright_pl = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("onda-bloom-bright-pl"),
            bind_group_layouts: &[&bright_layout],
            push_constant_ranges: &[],
        });
        let bright_pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some("onda-bloom-bright-pipeline"),
            layout: Some(&bright_pl),
            module: &bright_module,
            entry_point: "main",
            compilation_options: wgpu::PipelineCompilationOptions::default(),
            cache: None,
        });

        // Composite: sharp (sampled) + bloom (sampled) → dst (storage) + dims uniform.
        let composite_module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("onda-bloom-composite-wgsl"),
            source: wgpu::ShaderSource::Wgsl(BLOOM_COMPOSITE_WGSL.into()),
        });
        let composite_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("onda-bloom-composite-bgl"),
            entries: &[
                sampled_texture_entry(0),
                sampled_texture_entry(1),
                storage_texture_entry(2),
                uniform_entry(3),
            ],
        });
        let composite_pl = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("onda-bloom-composite-pl"),
            bind_group_layouts: &[&composite_layout],
            push_constant_ranges: &[],
        });
        let composite_pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some("onda-bloom-composite-pipeline"),
            layout: Some(&composite_pl),
            module: &composite_module,
            entry_point: "main",
            compilation_options: wgpu::PipelineCompilationOptions::default(),
            cache: None,
        });

        Bloom {
            bright_pipeline,
            bright_layout,
            composite_pipeline,
            composite_layout,
        }
    }

    /// Bloom `source` (the sharp subtree texture): bright-pass → Gaussian blur (via
    /// the shared `blur` pipeline) → additive composite over the sharp pixels.
    /// Returns a new `Rgba8Unorm` texture (`COPY_SRC`, ready for readback). A
    /// non-positive `sigma`/`intensity` yields the sharp source unchanged.
    ///
    /// Like the blur, this runs as its own command encoder(s) + submit — it never
    /// injects into Vello's pass; ping-pong storage textures, never `read_write`.
    #[allow(clippy::too_many_arguments)]
    pub fn run(
        &self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        blur: &GaussianBlur,
        source: &wgpu::Texture,
        width: u32,
        height: u32,
        threshold: f32,
        intensity: f32,
        sigma: f32,
        // Composite in linear light + ACES (cinematic) vs. the default gamma clamp.
        linear: bool,
    ) -> wgpu::Texture {
        let gx = width.div_ceil(8);
        let gy = height.div_ceil(8);
        let make_texture = |label: &str| {
            device.create_texture(&wgpu::TextureDescriptor {
                label: Some(label),
                size: wgpu::Extent3d {
                    width,
                    height,
                    depth_or_array_layers: 1,
                },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: wgpu::TextureFormat::Rgba8Unorm,
                usage: wgpu::TextureUsages::STORAGE_BINDING
                    | wgpu::TextureUsages::TEXTURE_BINDING
                    | wgpu::TextureUsages::COPY_SRC,
                view_formats: &[],
            })
        };

        // 1) Bright-pass: source → bright (highlights only).
        let bright = make_texture("onda-bloom-bright");
        let src_view = source.create_view(&wgpu::TextureViewDescriptor::default());
        let bright_view = bright.create_view(&wgpu::TextureViewDescriptor::default());
        let bright_params =
            make_bloom_bright_params(device, queue, threshold, intensity, width, height);
        let bright_bg = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("onda-bloom-bright-bg"),
            layout: &self.bright_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(&src_view),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::TextureView(&bright_view),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: bright_params.as_entire_binding(),
                },
            ],
        });
        let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("onda-bloom-bright-encoder"),
        });
        {
            let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: Some("onda-bloom-bright"),
                timestamp_writes: None,
            });
            pass.set_pipeline(&self.bright_pipeline);
            pass.set_bind_group(0, &bright_bg, &[]);
            pass.dispatch_workgroups(gx, gy, 1);
        }
        queue.submit(Some(encoder.finish()));

        // 2) Blur the highlights into a soft halo (reuse the Gaussian compute).
        let halo = blur.run(device, queue, &bright, width, height, sigma);

        // 3) Additive composite: sharp source + halo → output.
        let out = make_texture("onda-bloom-out");
        let halo_view = halo.create_view(&wgpu::TextureViewDescriptor::default());
        let out_view = out.create_view(&wgpu::TextureViewDescriptor::default());
        // Exposure before the ACES curve (linear mode). 1.0 keeps mids ~neutral while
        // the curve adds filmic contrast + rolls highlights off; tune per look.
        const LINEAR_EXPOSURE: f32 = 1.0;
        // Warm halation fringe — a tasteful film default, linear mode only.
        let halation = if linear { 0.6 } else { 0.0 };
        let dims = make_bloom_dims(
            device,
            queue,
            width,
            height,
            linear,
            LINEAR_EXPOSURE,
            halation,
        );
        let composite_bg = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("onda-bloom-composite-bg"),
            layout: &self.composite_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(&src_view),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::TextureView(&halo_view),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: wgpu::BindingResource::TextureView(&out_view),
                },
                wgpu::BindGroupEntry {
                    binding: 3,
                    resource: dims.as_entire_binding(),
                },
            ],
        });
        let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("onda-bloom-composite-encoder"),
        });
        {
            let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: Some("onda-bloom-composite"),
                timestamp_writes: None,
            });
            pass.set_pipeline(&self.composite_pipeline);
            pass.set_bind_group(0, &composite_bg, &[]);
            pass.dispatch_workgroups(gx, gy, 1);
        }
        queue.submit(Some(encoder.finish()));

        out
    }
}

/// Compute shader: the **color grade** — a single per-pixel color remap (no
/// blur), the cheapest effect pass. Mirrors the CPU `color_grade_framebuffer`
/// math so both backends share a visual look: per-channel exposure
/// (`2^exposure`), temperature (R up / B down), tint (G up/down) and contrast
/// (around a 0.5 pivot), then a saturation lerp toward Rec.601 luma. Operates on
/// straight-alpha RGB; alpha is passed through untouched.
const COLOR_GRADE_WGSL: &str = r#"
struct Params {
    exposure: f32,
    contrast: f32,
    saturation: f32,
    temperature: f32,
    tint: f32,
    width: u32,
    height: u32,
    _pad: u32,
};

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var dst: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> params: Params;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let x = gid.x;
    let y = gid.y;
    if (x >= params.width || y >= params.height) {
        return;
    }
    let p = vec2<i32>(i32(x), i32(y));
    let texel = textureLoad(src, p, 0);

    // Per-channel gains: exposure (2^exposure) folded with temperature (R/B) and
    // tint (G). Positive temperature warms (R up, B down); positive tint greens.
    let gain = exp2(params.exposure);
    let r_mul = gain * (1.0 + params.temperature * 0.5);
    let g_mul = gain * (1.0 + params.tint * 0.5);
    let b_mul = gain * (1.0 - params.temperature * 0.5);
    var rgb = texel.rgb * vec3<f32>(r_mul, g_mul, b_mul);

    // Contrast around a 0.5 pivot.
    rgb = (rgb - vec3<f32>(0.5)) * params.contrast + vec3<f32>(0.5);

    // Saturation: lerp toward Rec.601 luma.
    let luma = dot(rgb, vec3<f32>(0.299, 0.587, 0.114));
    rgb = vec3<f32>(luma) + (rgb - vec3<f32>(luma)) * params.saturation;

    rgb = clamp(rgb, vec3<f32>(0.0), vec3<f32>(1.0));
    textureStore(dst, p, vec4<f32>(rgb, texel.a));
}
"#;

/// Lazily-built color-grade compute pipeline (a single per-pixel pass — no
/// ping-pong, no blur). Cached on the renderer; the per-call texture/uniform are
/// allocated in [`ColorGrade::run`].
pub struct ColorGrade {
    pipeline: wgpu::ComputePipeline,
    layout: wgpu::BindGroupLayout,
}

/// Byte size of the color-grade params uniform (5 × f32 + 3 × u32 = 32, std140-safe).
const COLOR_GRADE_PARAMS_SIZE: u64 = 32;

impl ColorGrade {
    /// Build the compute pipeline + bind-group layout. Cache on the renderer.
    pub fn new(device: &wgpu::Device) -> Self {
        let module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("onda-color-grade-wgsl"),
            source: wgpu::ShaderSource::Wgsl(COLOR_GRADE_WGSL.into()),
        });
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("onda-color-grade-bgl"),
            entries: &[
                sampled_texture_entry(0),
                storage_texture_entry(1),
                uniform_entry(2),
            ],
        });
        let pl = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("onda-color-grade-pl"),
            bind_group_layouts: &[&layout],
            push_constant_ranges: &[],
        });
        let pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some("onda-color-grade-pipeline"),
            layout: Some(&pl),
            module: &module,
            entry_point: "main",
            compilation_options: wgpu::PipelineCompilationOptions::default(),
            cache: None,
        });
        ColorGrade { pipeline, layout }
    }

    /// Grade `source` (the captured subtree texture): one per-pixel compute pass →
    /// a new `Rgba8Unorm` texture (`COPY_SRC`, ready for readback). Runs as its own
    /// command encoder + submit — like the blur/bloom, it never injects into
    /// Vello's pass.
    #[allow(clippy::too_many_arguments)]
    pub fn run(
        &self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        source: &wgpu::Texture,
        width: u32,
        height: u32,
        exposure: f32,
        contrast: f32,
        saturation: f32,
        temperature: f32,
        tint: f32,
    ) -> wgpu::Texture {
        let out = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("onda-color-grade-out"),
            size: wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::STORAGE_BINDING
                | wgpu::TextureUsages::TEXTURE_BINDING
                | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let src_view = source.create_view(&wgpu::TextureViewDescriptor::default());
        let out_view = out.create_view(&wgpu::TextureViewDescriptor::default());

        let mut bytes = Vec::with_capacity(COLOR_GRADE_PARAMS_SIZE as usize);
        bytes.extend_from_slice(&exposure.to_le_bytes());
        bytes.extend_from_slice(&contrast.to_le_bytes());
        bytes.extend_from_slice(&saturation.to_le_bytes());
        bytes.extend_from_slice(&temperature.to_le_bytes());
        bytes.extend_from_slice(&tint.to_le_bytes());
        bytes.extend_from_slice(&width.to_le_bytes());
        bytes.extend_from_slice(&height.to_le_bytes());
        bytes.extend_from_slice(&0u32.to_le_bytes());
        let params = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("onda-color-grade-params"),
            size: COLOR_GRADE_PARAMS_SIZE,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        queue.write_buffer(&params, 0, &bytes);

        let bg = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("onda-color-grade-bg"),
            layout: &self.layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(&src_view),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::TextureView(&out_view),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: params.as_entire_binding(),
                },
            ],
        });
        let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("onda-color-grade-encoder"),
        });
        {
            let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: Some("onda-color-grade"),
                timestamp_writes: None,
            });
            pass.set_pipeline(&self.pipeline);
            pass.set_bind_group(0, &bg, &[]);
            pass.dispatch_workgroups(width.div_ceil(8), height.div_ceil(8), 1);
        }
        queue.submit(Some(encoder.finish()));
        out
    }
}

/// Compute shader: the **alpha matte** combine. Reads the content texture and the
/// matte texture (rendered over the same window) and writes the content's RGB with
/// its alpha multiplied by the matte's coverage — the matte's alpha (mode 0) or its
/// Rec.601 luminance × alpha (mode 1). Content RGB is passed through untouched, so
/// the revealed media's color is pixel-identical to the un-matted media; only
/// coverage is gated. Straight-alpha throughout (no premultiply needed — it's a
/// per-pixel multiply, like ColorGrade/Goo). Mirrors the CPU `render_matte` combine.
const ALPHA_MATTE_WGSL: &str = r#"
struct Params {
    mode: u32,   // 0 = alpha matte, 1 = luminance matte
    width: u32,
    height: u32,
    _pad: u32,
};

@group(0) @binding(0) var content: texture_2d<f32>;
@group(0) @binding(1) var matte: texture_2d<f32>;
@group(0) @binding(2) var dst: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(3) var<uniform> params: Params;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let x = gid.x;
    let y = gid.y;
    if (x >= params.width || y >= params.height) {
        return;
    }
    let p = vec2<i32>(i32(x), i32(y));
    let c = textureLoad(content, p, 0);
    let m = textureLoad(matte, p, 0);
    // Coverage from the matte: its alpha, or its luminance gated by its own alpha
    // (so transparent matte pixels never reveal — CSS mask-mode). Rec.601 luma to
    // match the CPU reference (77/150/29 >> 8).
    var cov = m.a;
    if (params.mode == 1u) {
        let luma = dot(m.rgb, vec3<f32>(0.299, 0.587, 0.114));
        cov = luma * m.a;
    }
    textureStore(dst, p, vec4<f32>(c.rgb, c.a * cov));
}
"#;

/// Lazily-built alpha-matte compute pipeline (a single per-pixel pass over two
/// sampled inputs — content + matte — no ping-pong). Cached on the renderer.
pub struct AlphaMatte {
    pipeline: wgpu::ComputePipeline,
    layout: wgpu::BindGroupLayout,
}

/// Byte size of the alpha-matte params uniform (4 × u32 = 16, std140-safe).
const ALPHA_MATTE_PARAMS_SIZE: u64 = 16;

impl AlphaMatte {
    /// Build the compute pipeline + bind-group layout (two sampled textures, one
    /// storage out, one uniform). Cache on the renderer.
    pub fn new(device: &wgpu::Device) -> Self {
        let module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("onda-alpha-matte-wgsl"),
            source: wgpu::ShaderSource::Wgsl(ALPHA_MATTE_WGSL.into()),
        });
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("onda-alpha-matte-bgl"),
            entries: &[
                sampled_texture_entry(0),
                sampled_texture_entry(1),
                storage_texture_entry(2),
                uniform_entry(3),
            ],
        });
        let pl = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("onda-alpha-matte-pl"),
            bind_group_layouts: &[&layout],
            push_constant_ranges: &[],
        });
        let pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some("onda-alpha-matte-pipeline"),
            layout: Some(&pl),
            module: &module,
            entry_point: "main",
            compilation_options: wgpu::PipelineCompilationOptions::default(),
            cache: None,
        });
        AlphaMatte { pipeline, layout }
    }

    /// Combine `content` and `matte` (same size, pixel-aligned) → a new
    /// `Rgba8Unorm` texture (`COPY_SRC`, ready for readback): `content.rgb` with
    /// `content.a` ×= the matte's coverage. `mode` is 0 (alpha) or 1 (luminance).
    /// Its own encoder + submit — never injects into Vello's pass.
    #[allow(clippy::too_many_arguments)]
    pub fn run(
        &self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        content: &wgpu::Texture,
        matte: &wgpu::Texture,
        width: u32,
        height: u32,
        mode: u32,
    ) -> wgpu::Texture {
        let out = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("onda-alpha-matte-out"),
            size: wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::STORAGE_BINDING
                | wgpu::TextureUsages::TEXTURE_BINDING
                | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let content_view = content.create_view(&wgpu::TextureViewDescriptor::default());
        let matte_view = matte.create_view(&wgpu::TextureViewDescriptor::default());
        let out_view = out.create_view(&wgpu::TextureViewDescriptor::default());

        let mut bytes = Vec::with_capacity(ALPHA_MATTE_PARAMS_SIZE as usize);
        bytes.extend_from_slice(&mode.to_le_bytes());
        bytes.extend_from_slice(&width.to_le_bytes());
        bytes.extend_from_slice(&height.to_le_bytes());
        bytes.extend_from_slice(&0u32.to_le_bytes());
        let params = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("onda-alpha-matte-params"),
            size: ALPHA_MATTE_PARAMS_SIZE,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        queue.write_buffer(&params, 0, &bytes);

        let bg = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("onda-alpha-matte-bg"),
            layout: &self.layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(&content_view),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::TextureView(&matte_view),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: wgpu::BindingResource::TextureView(&out_view),
                },
                wgpu::BindGroupEntry {
                    binding: 3,
                    resource: params.as_entire_binding(),
                },
            ],
        });
        let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("onda-alpha-matte-encoder"),
        });
        {
            let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: Some("onda-alpha-matte"),
                timestamp_writes: None,
            });
            pass.set_pipeline(&self.pipeline);
            pass.set_bind_group(0, &bg, &[]);
            pass.dispatch_workgroups(width.div_ceil(8), height.div_ceil(8), 1);
        }
        queue.submit(Some(encoder.finish()));
        out
    }
}

/// Lazily-built film-grain pass: a single per-pixel compute over the captured
/// subtree that adds luminance-banded, animated monochrome noise. Cached on the
/// renderer (it runs in the effect chain, possibly every frame). Mirrors the CPU
/// `grain_framebuffer` so both backends share the look.
pub struct Grain {
    pipeline: wgpu::ComputePipeline,
    layout: wgpu::BindGroupLayout,
}

/// Byte size of the grain params uniform (3 × f32 + 3 × u32 + 2 pad = 32, std140-safe).
const GRAIN_PARAMS_SIZE: u64 = 32;

impl Grain {
    /// Build the compute pipeline + bind-group layout. Cache on the renderer.
    pub fn new(device: &wgpu::Device) -> Self {
        let module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("onda-grain-wgsl"),
            source: wgpu::ShaderSource::Wgsl(GRAIN_WGSL.into()),
        });
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("onda-grain-bgl"),
            entries: &[
                sampled_texture_entry(0),
                storage_texture_entry(1),
                uniform_entry(2),
            ],
        });
        let pl = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("onda-grain-pl"),
            bind_group_layouts: &[&layout],
            push_constant_ranges: &[],
        });
        let pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some("onda-grain-pipeline"),
            layout: Some(&pl),
            module: &module,
            entry_point: "main",
            compilation_options: wgpu::PipelineCompilationOptions::default(),
            cache: None,
        });
        Grain { pipeline, layout }
    }

    /// Grain `source` (the captured subtree texture) → a new `Rgba8Unorm` texture
    /// (`COPY_SRC`, ready for readback). `linear` adds the grain in linear light
    /// (matching the composition's cinematic finish) instead of gamma. Its own
    /// encoder + submit — never injects into Vello's pass.
    #[allow(clippy::too_many_arguments)]
    pub fn run(
        &self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        source: &wgpu::Texture,
        width: u32,
        height: u32,
        intensity: f32,
        size: f32,
        seed: f32,
    ) -> wgpu::Texture {
        let out = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("onda-grain-out"),
            size: wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::STORAGE_BINDING
                | wgpu::TextureUsages::TEXTURE_BINDING
                | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let src_view = source.create_view(&wgpu::TextureViewDescriptor::default());
        let out_view = out.create_view(&wgpu::TextureViewDescriptor::default());

        let mut bytes = Vec::with_capacity(GRAIN_PARAMS_SIZE as usize);
        bytes.extend_from_slice(&intensity.to_le_bytes());
        bytes.extend_from_slice(&size.max(0.01).to_le_bytes());
        bytes.extend_from_slice(&seed.to_le_bytes());
        bytes.extend_from_slice(&width.to_le_bytes());
        bytes.extend_from_slice(&height.to_le_bytes());
        bytes.extend_from_slice(&0u32.to_le_bytes());
        bytes.extend_from_slice(&0u32.to_le_bytes());
        bytes.extend_from_slice(&0u32.to_le_bytes());
        let params = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("onda-grain-params"),
            size: GRAIN_PARAMS_SIZE,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        queue.write_buffer(&params, 0, &bytes);

        let bg = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("onda-grain-bg"),
            layout: &self.layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(&src_view),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::TextureView(&out_view),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: params.as_entire_binding(),
                },
            ],
        });
        let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("onda-grain-encoder"),
        });
        {
            let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: Some("onda-grain"),
                timestamp_writes: None,
            });
            pass.set_pipeline(&self.pipeline);
            pass.set_bind_group(0, &bg, &[]);
            pass.dispatch_workgroups(width.div_ceil(8), height.div_ceil(8), 1);
        }
        queue.submit(Some(encoder.finish()));
        out
    }
}

/// Compute shader: FILM GRAIN. A value-noise field (scaled by `size`, offset by
/// `seed` so it animates per frame) is centred to [-1,1], banded by a midtone
/// luminance response `2·√(l·(1-l))` (peak at mid-grey, zero at pure black/white),
/// and added MONOCHROME to the colour in the PERCEPTUAL (gamma/sRGB) domain — which
/// is where it both reads filmic (uniform across the tonal range) and dithers the
/// 8-bit banding it's meant to hide; pure-linear additive grain explodes the shadows.
/// The hash/`fract` math is mirrored exactly by the CPU `grain_framebuffer`.
const GRAIN_WGSL: &str = r#"
struct Params {
    intensity: f32,
    size: f32,
    seed: f32,
    width: u32,
    height: u32,
    _p0: u32,
    _p1: u32,
    _p2: u32,
};

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var dst: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> p: Params;

fn hash21(v: vec2<f32>) -> f32 {
    return fract(sin(dot(v, vec2<f32>(127.1, 311.7))) * 43758.5453123);
}
// Value noise: smooth-interpolated hash at the cell corners → [0,1].
fn vnoise(v: vec2<f32>) -> f32 {
    let i = floor(v);
    let f = fract(v);
    let u = f * f * (3.0 - 2.0 * f);
    let a = hash21(i);
    let b = hash21(i + vec2<f32>(1.0, 0.0));
    let c = hash21(i + vec2<f32>(0.0, 1.0));
    let d = hash21(i + vec2<f32>(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let x = gid.x;
    let y = gid.y;
    if (x >= p.width || y >= p.height) {
        return;
    }
    let q = vec2<i32>(i32(x), i32(y));
    let s = textureLoad(src, q, 0);
    // Sample the noise field; the per-frame seed jumps it far enough to decorrelate.
    let coord = (vec2<f32>(f32(x), f32(y)) + 0.5) / p.size
        + vec2<f32>(p.seed * 71.0, p.seed * 113.0);
    let n = (vnoise(coord) - 0.5) * 2.0; // [-1, 1]
    // Midtone-banded response: peaks at mid-grey, 0 at pure black/white.
    let luma = dot(s.rgb, vec3<f32>(0.299, 0.587, 0.114));
    let resp = 2.0 * sqrt(max(luma * (1.0 - luma), 0.0));
    let delta = n * p.intensity * resp;
    let rgb = clamp(s.rgb + vec3<f32>(delta), vec3<f32>(0.0), vec3<f32>(1.0));
    textureStore(dst, q, vec4<f32>(rgb, s.a));
}
"#;

/// Lazily-built light-wrap composite: bleeds the blurred backdrop light onto the
/// foreground's feathered inner edge so a cut-out plate reads as *shot in* the scene
/// rather than pasted on top. Three sampled inputs — the sharp foreground (with its
/// straight-alpha silhouette), a blurred copy of it (for the feathered edge band),
/// and the blurred backdrop (the light to wrap) — combined in LINEAR light. Cached
/// is unnecessary (light-wrap is an export/native finishing pass on a node or two),
/// so [`LightWrap::new`] is cheap to call per resolve.
pub struct LightWrap {
    pipeline: wgpu::ComputePipeline,
    layout: wgpu::BindGroupLayout,
}

/// Byte size of the light-wrap params uniform (`width`,`height`,`strength`,pad).
const LIGHT_WRAP_PARAMS_SIZE: u64 = 16;

impl LightWrap {
    /// Build the compute pipeline + bind-group layout (three sampled textures, one
    /// storage out, one uniform).
    pub fn new(device: &wgpu::Device) -> Self {
        let module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("onda-light-wrap-wgsl"),
            source: wgpu::ShaderSource::Wgsl(LIGHT_WRAP_WGSL.into()),
        });
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("onda-light-wrap-bgl"),
            entries: &[
                sampled_texture_entry(0),
                sampled_texture_entry(1),
                sampled_texture_entry(2),
                storage_texture_entry(3),
                uniform_entry(4),
            ],
        });
        let pl = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("onda-light-wrap-pl"),
            bind_group_layouts: &[&layout],
            push_constant_ranges: &[],
        });
        let pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some("onda-light-wrap-pipeline"),
            layout: Some(&pl),
            module: &module,
            entry_point: "main",
            compilation_options: wgpu::PipelineCompilationOptions::default(),
            cache: None,
        });
        LightWrap { pipeline, layout }
    }

    /// Composite the wrapped light → a new `Rgba8Unorm` texture (`COPY_SRC`, ready
    /// for readback). `fg` is the sharp foreground, `soft_fg` its blurred copy (for
    /// the edge band), `bg_blurred` the blurred backdrop. All same size,
    /// pixel-aligned (full-canvas). Its own encoder + submit.
    #[allow(clippy::too_many_arguments)]
    pub fn run(
        &self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        fg: &wgpu::Texture,
        soft_fg: &wgpu::Texture,
        bg_blurred: &wgpu::Texture,
        width: u32,
        height: u32,
        strength: f32,
    ) -> wgpu::Texture {
        let out = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("onda-light-wrap-out"),
            size: wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::STORAGE_BINDING
                | wgpu::TextureUsages::TEXTURE_BINDING
                | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let fg_view = fg.create_view(&wgpu::TextureViewDescriptor::default());
        let soft_view = soft_fg.create_view(&wgpu::TextureViewDescriptor::default());
        let bg_view = bg_blurred.create_view(&wgpu::TextureViewDescriptor::default());
        let out_view = out.create_view(&wgpu::TextureViewDescriptor::default());

        let mut bytes = Vec::with_capacity(LIGHT_WRAP_PARAMS_SIZE as usize);
        bytes.extend_from_slice(&width.to_le_bytes());
        bytes.extend_from_slice(&height.to_le_bytes());
        bytes.extend_from_slice(&strength.to_le_bytes());
        bytes.extend_from_slice(&0f32.to_le_bytes());
        let params = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("onda-light-wrap-params"),
            size: LIGHT_WRAP_PARAMS_SIZE,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        queue.write_buffer(&params, 0, &bytes);

        let bg = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("onda-light-wrap-bg"),
            layout: &self.layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(&fg_view),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::TextureView(&soft_view),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: wgpu::BindingResource::TextureView(&bg_view),
                },
                wgpu::BindGroupEntry {
                    binding: 3,
                    resource: wgpu::BindingResource::TextureView(&out_view),
                },
                wgpu::BindGroupEntry {
                    binding: 4,
                    resource: params.as_entire_binding(),
                },
            ],
        });
        let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("onda-light-wrap-encoder"),
        });
        {
            let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: Some("onda-light-wrap"),
                timestamp_writes: None,
            });
            pass.set_pipeline(&self.pipeline);
            pass.set_bind_group(0, &bg, &[]);
            pass.dispatch_workgroups(width.div_ceil(8), height.div_ceil(8), 1);
        }
        queue.submit(Some(encoder.finish()));
        out
    }
}

/// Compute shader: the LIGHT-WRAP composite. The wrap region is the foreground's
/// inner edge band — `rim = fg.a * (1 - blurred_fg.a)`, which is ~0 in the solid
/// core (blurred alpha ≈ 1) and outside the silhouette (fg.a = 0) but positive just
/// inside the edge, where the blur has pulled in transparency from beyond the
/// silhouette. Over that band the blurred backdrop light is added in LINEAR light,
/// scaled by `strength`; the silhouette (output alpha) is left untouched so only the
/// existing edge is re-lit. Drawn over the already-composited backdrop, so where the
/// foreground is transparent the scene shows through unchanged.
const LIGHT_WRAP_WGSL: &str = r#"
struct Params {
    width: u32,
    height: u32,
    strength: f32,
    _pad: f32,
};

@group(0) @binding(0) var fg: texture_2d<f32>;
@group(0) @binding(1) var soft: texture_2d<f32>;
@group(0) @binding(2) var bg: texture_2d<f32>;
@group(0) @binding(3) var dst: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(4) var<uniform> p: Params;

fn srgb_to_linear(c: vec3<f32>) -> vec3<f32> {
    let lo = c / 12.92;
    let hi = pow((c + 0.055) / 1.055, vec3<f32>(2.4));
    return select(hi, lo, c <= vec3<f32>(0.04045));
}
fn linear_to_srgb(c: vec3<f32>) -> vec3<f32> {
    let cc = clamp(c, vec3<f32>(0.0), vec3<f32>(1.0));
    let lo = cc * 12.92;
    let hi = 1.055 * pow(cc, vec3<f32>(1.0 / 2.4)) - 0.055;
    return select(hi, lo, cc <= vec3<f32>(0.0031308));
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let x = gid.x;
    let y = gid.y;
    if (x >= p.width || y >= p.height) {
        return;
    }
    let q = vec2<i32>(i32(x), i32(y));
    let f = textureLoad(fg, q, 0);    // sharp foreground (straight alpha)
    let s = textureLoad(soft, q, 0);  // blurred foreground (feathered alpha)
    let b = textureLoad(bg, q, 0);    // blurred backdrop (the light to wrap)

    // Inner edge band: solid foreground whose blurred alpha has been pulled down by
    // the transparency just beyond the silhouette → 0 in the core and outside.
    let rim = clamp(f.a * (1.0 - s.a), 0.0, 1.0) * p.strength;

    // Add the blurred backdrop light (pre-weighted by coverage) in LINEAR light.
    let light = srgb_to_linear(b.rgb * b.a);
    let lit = srgb_to_linear(f.rgb) + light * rim;
    let rgb = linear_to_srgb(lit);
    textureStore(dst, q, vec4<f32>(rgb, f.a));
}
"#;

/// Compute shader: the gooey-morph **alpha threshold**. Reads the blurred subtree
/// texture and sharpens its alpha around `threshold` with a steep smoothstep
/// (half-width `ramp`) — alpha well above the cutoff snaps to opaque, well below
/// to transparent, with a narrow anti-aliased ramp between. RGB is passed through
/// untouched (the straight-alpha color the blur produced), so each blob keeps its
/// color while overlapping halos fuse into one solid metaball form. Mirrors the
/// CPU `goo_framebuffer` LUT so both backends share the look.
const GOO_THRESHOLD_WGSL: &str = r#"
struct Params {
    threshold: f32,
    ramp: f32,
    width: u32,
    height: u32,
};

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var dst: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> params: Params;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let x = gid.x;
    let y = gid.y;
    if (x >= params.width || y >= params.height) {
        return;
    }
    let p = vec2<i32>(i32(x), i32(y));
    let texel = textureLoad(src, p, 0);

    // Smoothstep the alpha across [threshold - ramp, threshold + ramp]. `smoothstep`
    // handles a degenerate (zero-width) edge as a hard step at the cutoff.
    let lo = params.threshold - params.ramp;
    let hi = params.threshold + params.ramp;
    let a = smoothstep(lo, hi, texel.a);
    // RGB preserved; only coverage is re-shaped into the fused silhouette.
    textureStore(dst, p, vec4<f32>(texel.rgb, a));
}
"#;

/// Lazily-built gooey-morph pipeline: an alpha-threshold compute pass that runs
/// *after* the shared [`GaussianBlur`] spread. Cached on the renderer; the
/// per-call texture/uniform are allocated in [`Goo::run`].
pub struct Goo {
    pipeline: wgpu::ComputePipeline,
    layout: wgpu::BindGroupLayout,
}

/// Byte size of the goo-threshold params uniform (2 × f32 + 2 × u32 = 16).
const GOO_PARAMS_SIZE: u64 = 16;

/// Half-width of the alpha-threshold ramp (fraction of the 0..1 alpha range).
/// Matches the CPU `goo_framebuffer`'s `GOO_RAMP` so both backends fuse alike.
const GOO_RAMP: f32 = 0.06;

impl Goo {
    /// Build the threshold compute pipeline + bind-group layout. Cache on the
    /// renderer (the spread reuses the shared [`GaussianBlur`]).
    pub fn new(device: &wgpu::Device) -> Self {
        let module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("onda-goo-threshold-wgsl"),
            source: wgpu::ShaderSource::Wgsl(GOO_THRESHOLD_WGSL.into()),
        });
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("onda-goo-bgl"),
            entries: &[
                sampled_texture_entry(0),
                storage_texture_entry(1),
                uniform_entry(2),
            ],
        });
        let pl = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("onda-goo-pl"),
            bind_group_layouts: &[&layout],
            push_constant_ranges: &[],
        });
        let pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some("onda-goo-pipeline"),
            layout: Some(&pl),
            module: &module,
            entry_point: "main",
            compilation_options: wgpu::PipelineCompilationOptions::default(),
            cache: None,
        });
        Goo { pipeline, layout }
    }

    /// Goo `source` (the captured subtree texture): Gaussian blur (via the shared
    /// `blur` pipeline) → alpha-threshold compute pass. Returns a new `Rgba8Unorm`
    /// texture (`COPY_SRC`, ready for readback) where overlapping shapes have fused
    /// into smooth metaball forms. Runs as its own command encoder + submit — like
    /// the blur/bloom, it never injects into Vello's pass.
    pub fn run(
        &self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        blur: &GaussianBlur,
        source: &wgpu::Texture,
        width: u32,
        height: u32,
        sigma: f32,
        threshold: f32,
    ) -> wgpu::Texture {
        // 1) Blur the captured subtree so neighboring shapes' alpha halos overlap.
        //    A non-positive sigma is a no-op copy (the blur returns a clean texture).
        let blurred = blur.run(device, queue, source, width, height, sigma);

        // 2) Threshold the blurred alpha into the fused metaball silhouette.
        let out = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("onda-goo-out"),
            size: wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::STORAGE_BINDING
                | wgpu::TextureUsages::TEXTURE_BINDING
                | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let src_view = blurred.create_view(&wgpu::TextureViewDescriptor::default());
        let out_view = out.create_view(&wgpu::TextureViewDescriptor::default());

        let mut bytes = Vec::with_capacity(GOO_PARAMS_SIZE as usize);
        bytes.extend_from_slice(&threshold.clamp(0.0, 1.0).to_le_bytes());
        bytes.extend_from_slice(&GOO_RAMP.to_le_bytes());
        bytes.extend_from_slice(&width.to_le_bytes());
        bytes.extend_from_slice(&height.to_le_bytes());
        let params = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("onda-goo-params"),
            size: GOO_PARAMS_SIZE,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        queue.write_buffer(&params, 0, &bytes);

        let bg = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("onda-goo-bg"),
            layout: &self.layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(&src_view),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::TextureView(&out_view),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: params.as_entire_binding(),
                },
            ],
        });
        let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("onda-goo-encoder"),
        });
        {
            let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: Some("onda-goo-threshold"),
                timestamp_writes: None,
            });
            pass.set_pipeline(&self.pipeline);
            pass.set_bind_group(0, &bg, &[]);
            pass.dispatch_workgroups(width.div_ceil(8), height.div_ceil(8), 1);
        }
        queue.submit(Some(encoder.finish()));
        out
    }
}

/// Compute shader: a **fractal-noise gradient** (fBm — fractal Brownian motion —
/// over 2D Simplex noise), the "wispy, expensive" animated gradient (Stripe/Linear
/// tier). Five octaves of Simplex noise (each higher-frequency, half-amplitude) are
/// summed for detail, then DOMAIN-WARPED (the field samples itself, twice — the
/// Iñigo-Quílez warp) for organic, flowing structure. `time` evolves the warp so the
/// field drifts like ink in water; the final value `0..1` samples the color ramp.
/// Pure generator — no input texture; writes straight to the storage target.
/// Simplex noise is the Ashima/McEwan/Gustavson `snoise` (the canonical GLSL port).
const FBM_GRADIENT_WGSL: &str = r#"
struct Stop {
    color: vec4<f32>,
    offset: f32,
    _p0: f32, _p1: f32, _p2: f32,
};
struct Params {
    width: u32,
    height: u32,
    stop_count: u32,
    _pad0: u32,
    scale: f32,
    time: f32,
    warp: f32,
    _pad1: f32,
    stops: array<Stop, 8>,
};

@group(0) @binding(0) var dst: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(1) var<uniform> params: Params;

fn mod289_2(x: vec2<f32>) -> vec2<f32> { return x - floor(x * (1.0 / 289.0)) * 289.0; }
fn mod289_3(x: vec3<f32>) -> vec3<f32> { return x - floor(x * (1.0 / 289.0)) * 289.0; }
fn permute3(x: vec3<f32>) -> vec3<f32> { return mod289_3(((x * 34.0) + 1.0) * x); }

// 2D Simplex noise, range ~[-1, 1].
fn snoise(v: vec2<f32>) -> f32 {
    let C = vec4<f32>(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
    var i = floor(v + dot(v, C.yy));
    let x0 = v - i + dot(i, C.xx);
    var i1 = vec2<f32>(0.0, 1.0);
    if (x0.x > x0.y) { i1 = vec2<f32>(1.0, 0.0); }
    var x12 = x0.xyxy + C.xxzz;
    x12 = vec4<f32>(x12.xy - i1, x12.zw);
    i = mod289_2(i);
    let p = permute3(permute3(i.y + vec3<f32>(0.0, i1.y, 1.0)) + i.x + vec3<f32>(0.0, i1.x, 1.0));
    var m = max(0.5 - vec3<f32>(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), vec3<f32>(0.0));
    m = m * m;
    m = m * m;
    let x = 2.0 * fract(p * C.www) - 1.0;
    let h = abs(x) - 0.5;
    let ox = floor(x + 0.5);
    let a0 = x - ox;
    m = m * (1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h));
    var g: vec3<f32>;
    g.x = a0.x * x0.x + h.x * x0.y;
    let gyz = a0.yz * x12.xz + h.yz * x12.yw;
    g.y = gyz.x;
    g.z = gyz.y;
    return 130.0 * dot(m, g);
}

// Five octaves of Simplex noise: detail without the smooth-blob look.
fn fbm(p_in: vec2<f32>) -> f32 {
    var p = p_in;
    var sum = 0.0;
    var amp = 0.5;
    for (var i = 0; i < 5; i = i + 1) {
        sum = sum + amp * snoise(p);
        p = p * 2.0;
        amp = amp * 0.5;
    }
    return sum;
}

// Sample the color ramp at t (0..1): piecewise-linear over the sorted stops.
fn ramp(t: f32) -> vec3<f32> {
    let n = params.stop_count;
    if (n == 0u) { return vec3<f32>(0.0); }
    if (t <= params.stops[0].offset) { return params.stops[0].color.rgb; }
    for (var i = 1u; i < n; i = i + 1u) {
        if (t <= params.stops[i].offset) {
            let a = params.stops[i - 1u];
            let b = params.stops[i];
            let span = max(b.offset - a.offset, 1e-5);
            let k = clamp((t - a.offset) / span, 0.0, 1.0);
            return mix(a.color.rgb, b.color.rgb, k);
        }
    }
    return params.stops[n - 1u].color.rgb;
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let x = gid.x;
    let y = gid.y;
    if (x >= params.width || y >= params.height) {
        return;
    }
    // Aspect-correct coords (divide both axes by height) so the noise cells are
    // square regardless of canvas ratio. `scale` = noise cells across the height.
    let uv = vec2<f32>(f32(x), f32(y)) / f32(params.height);
    var p = uv * params.scale;
    let t = params.time;

    // Domain warp: the field samples itself twice (q then r), each layer adding
    // swirl; `time` slides the warp octaves so the structure FLOWS rather than
    // scrolls. `warp` scales how violently the field folds (0 = plain fBm).
    let q = vec2<f32>(
        fbm(p + vec2<f32>(0.0, 0.0) + 0.10 * t),
        fbm(p + vec2<f32>(5.2, 1.3) - 0.08 * t),
    );
    let r = vec2<f32>(
        fbm(p + params.warp * q + vec2<f32>(1.7, 9.2) + 0.12 * t),
        fbm(p + params.warp * q + vec2<f32>(8.3, 2.8) + 0.10 * t),
    );
    var f = fbm(p + params.warp * r);
    f = clamp(f * 0.5 + 0.5, 0.0, 1.0);

    let rgb = ramp(f);
    textureStore(dst, vec2<i32>(i32(x), i32(y)), vec4<f32>(rgb, 1.0));
}
"#;

/// Lazily-built fBm-gradient compute pipeline (a pure generator — no input texture,
/// one storage out + a params uniform carrying the color ramp). Cached on the
/// renderer; the per-call texture/uniform are allocated in [`FbmGradient::run`].
pub struct FbmGradient {
    pipeline: wgpu::ComputePipeline,
    layout: wgpu::BindGroupLayout,
}

/// Byte size of the fBm params uniform: 32-byte header + 8 stops × 32 bytes.
const FBM_PARAMS_SIZE: u64 = 32 + 8 * 32;
/// Max color stops the ramp uniform carries (must match the WGSL `array<Stop, 8>`).
const FBM_MAX_STOPS: usize = 8;

impl FbmGradient {
    /// Build the compute pipeline + bind-group layout (one storage out, one
    /// uniform). Cache on the renderer.
    pub fn new(device: &wgpu::Device) -> Self {
        let module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("onda-fbm-gradient-wgsl"),
            source: wgpu::ShaderSource::Wgsl(FBM_GRADIENT_WGSL.into()),
        });
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("onda-fbm-gradient-bgl"),
            entries: &[storage_texture_entry(0), uniform_entry(1)],
        });
        let pl = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("onda-fbm-gradient-pl"),
            bind_group_layouts: &[&layout],
            push_constant_ranges: &[],
        });
        let pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some("onda-fbm-gradient-pipeline"),
            layout: Some(&pl),
            module: &module,
            entry_point: "main",
            compilation_options: wgpu::PipelineCompilationOptions::default(),
            cache: None,
        });
        FbmGradient { pipeline, layout }
    }

    /// Generate the fBm gradient into a fresh `Rgba8Unorm` texture (`COPY_SRC`,
    /// ready for readback). `stops` is the color ramp as `(rgba 0..1, offset)`
    /// pairs, sorted by offset (up to [`FBM_MAX_STOPS`]; extras are ignored).
    #[allow(clippy::too_many_arguments)]
    pub fn run(
        &self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        width: u32,
        height: u32,
        scale: f32,
        time: f32,
        warp: f32,
        stops: &[([f32; 4], f32)],
    ) -> wgpu::Texture {
        let out = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("onda-fbm-gradient-out"),
            size: wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::STORAGE_BINDING
                | wgpu::TextureUsages::TEXTURE_BINDING
                | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let out_view = out.create_view(&wgpu::TextureViewDescriptor::default());

        let count = stops.len().min(FBM_MAX_STOPS);
        let mut bytes = Vec::with_capacity(FBM_PARAMS_SIZE as usize);
        bytes.extend_from_slice(&width.to_le_bytes());
        bytes.extend_from_slice(&height.to_le_bytes());
        bytes.extend_from_slice(&(count as u32).to_le_bytes());
        bytes.extend_from_slice(&0u32.to_le_bytes());
        bytes.extend_from_slice(&scale.to_le_bytes());
        bytes.extend_from_slice(&time.to_le_bytes());
        bytes.extend_from_slice(&warp.to_le_bytes());
        bytes.extend_from_slice(&0f32.to_le_bytes());
        for i in 0..FBM_MAX_STOPS {
            let ([r, g, b, a], off) = stops.get(i).copied().unwrap_or(([0.0; 4], 0.0));
            for c in [r, g, b, a, off, 0.0, 0.0, 0.0] {
                bytes.extend_from_slice(&c.to_le_bytes());
            }
        }
        let params = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("onda-fbm-gradient-params"),
            size: FBM_PARAMS_SIZE,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        queue.write_buffer(&params, 0, &bytes);

        let bg = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("onda-fbm-gradient-bg"),
            layout: &self.layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(&out_view),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: params.as_entire_binding(),
                },
            ],
        });
        let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("onda-fbm-gradient-encoder"),
        });
        {
            let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: Some("onda-fbm-gradient"),
                timestamp_writes: None,
            });
            pass.set_pipeline(&self.pipeline);
            pass.set_bind_group(0, &bg, &[]);
            pass.dispatch_workgroups(width.div_ceil(8), height.div_ceil(8), 1);
        }
        queue.submit(Some(encoder.finish()));
        out
    }
}

/// A sampled (read-only) `texture_2d<f32>` bind-group-layout entry at `binding`.
fn sampled_texture_entry(binding: u32) -> wgpu::BindGroupLayoutEntry {
    wgpu::BindGroupLayoutEntry {
        binding,
        visibility: wgpu::ShaderStages::COMPUTE,
        ty: wgpu::BindingType::Texture {
            sample_type: wgpu::TextureSampleType::Float { filterable: false },
            view_dimension: wgpu::TextureViewDimension::D2,
            multisampled: false,
        },
        count: None,
    }
}

/// A write-only `Rgba8Unorm` storage-texture bind-group-layout entry (never
/// `read_write`, for Dawn portability) at `binding`.
fn storage_texture_entry(binding: u32) -> wgpu::BindGroupLayoutEntry {
    wgpu::BindGroupLayoutEntry {
        binding,
        visibility: wgpu::ShaderStages::COMPUTE,
        ty: wgpu::BindingType::StorageTexture {
            access: wgpu::StorageTextureAccess::WriteOnly,
            format: wgpu::TextureFormat::Rgba8Unorm,
            view_dimension: wgpu::TextureViewDimension::D2,
        },
        count: None,
    }
}

/// A uniform-buffer bind-group-layout entry at `binding`.
fn uniform_entry(binding: u32) -> wgpu::BindGroupLayoutEntry {
    wgpu::BindGroupLayoutEntry {
        binding,
        visibility: wgpu::ShaderStages::COMPUTE,
        ty: wgpu::BindingType::Buffer {
            ty: wgpu::BufferBindingType::Uniform,
            has_dynamic_offset: false,
            min_binding_size: None,
        },
        count: None,
    }
}

/// The bright-pass params uniform (threshold f32, intensity f32, width u32, height u32).
fn make_bloom_bright_params(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    threshold: f32,
    intensity: f32,
    width: u32,
    height: u32,
) -> wgpu::Buffer {
    let mut bytes = Vec::with_capacity(BLOOM_BRIGHT_PARAMS_SIZE as usize);
    bytes.extend_from_slice(&threshold.to_le_bytes());
    bytes.extend_from_slice(&intensity.to_le_bytes());
    bytes.extend_from_slice(&width.to_le_bytes());
    bytes.extend_from_slice(&height.to_le_bytes());
    let buf = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("onda-bloom-bright-params"),
        size: BLOOM_BRIGHT_PARAMS_SIZE,
        usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        mapped_at_creation: false,
    });
    queue.write_buffer(&buf, 0, &bytes);
    buf
}

/// `op` codes for the unified per-pixel effect pass (`PixelFx`): one pipeline +
/// one shader with a `switch`, so a batch of small per-pixel effects shares the
/// plumbing instead of each minting its own pipeline + `Ctx` field.
pub const PIXELFX_CHROMATIC: u32 = 0;
pub const PIXELFX_VIGNETTE: u32 = 1;
pub const PIXELFX_POSTERIZE: u32 = 2;
pub const PIXELFX_DUOTONE: u32 = 3;
pub const PIXELFX_CHROMA_KEY: u32 = 4;

const PIXELFX_PARAMS_SIZE: u64 = 48; // op,w,h,pad (16) + p0 vec4 (16) + p1 vec4 (16)

const PIXELFX_WGSL: &str = r#"
struct Params {
    op: u32,
    width: u32,
    height: u32,
    pad: u32,
    p0: vec4<f32>,
    p1: vec4<f32>,
};

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var dst: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> params: Params;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let x = gid.x;
    let y = gid.y;
    if (x >= params.width || y >= params.height) {
        return;
    }
    let maxx = i32(params.width) - 1;
    let maxy = i32(params.height) - 1;
    let texel = textureLoad(src, vec2<i32>(i32(x), i32(y)), 0);
    var rgb = texel.rgb;
    var a = texel.a;

    if (params.op == 0u) {
        // Chromatic aberration: split R outward / B inward along the radius.
        let cx = f32(params.width) * 0.5;
        let cy = f32(params.height) * 0.5;
        var dir = vec2<f32>(f32(x) - cx, f32(y) - cy);
        dir = dir / max(length(dir), 1.0);
        let amt = params.p0.x;
        let rs = textureLoad(src, vec2<i32>(
            clamp(i32(round(f32(x) + dir.x * amt)), 0, maxx),
            clamp(i32(round(f32(y) + dir.y * amt)), 0, maxy)), 0);
        let bs = textureLoad(src, vec2<i32>(
            clamp(i32(round(f32(x) - dir.x * amt)), 0, maxx),
            clamp(i32(round(f32(y) - dir.y * amt)), 0, maxy)), 0);
        rgb = vec3<f32>(rs.r, texel.g, bs.b);
        a = (rs.a + texel.a + bs.a) / 3.0;
    } else if (params.op == 1u) {
        // Vignette: radial falloff from centre.
        let cx = f32(params.width) * 0.5;
        let cy = f32(params.height) * 0.5;
        let d = length(vec2<f32>((f32(x) - cx) / cx, (f32(y) - cy) / cy));
        let amount = params.p0.x;
        let softness = max(params.p0.y, 0.001);
        rgb = rgb * (1.0 - amount * clamp((d - (1.0 - softness)) / softness, 0.0, 1.0));
    } else if (params.op == 2u) {
        // Posterize: quantize to `levels` evenly-spaced steps (incl. 0 and 1).
        let levels = max(params.p0.x, 2.0);
        rgb = clamp(floor(rgb * (levels - 1.0) + 0.5) / (levels - 1.0),
            vec3<f32>(0.0), vec3<f32>(1.0));
    } else if (params.op == 3u) {
        // Duotone: luma -> gradient from shadow (p0) to highlight (p1).
        let lum = clamp(dot(rgb, vec3<f32>(0.299, 0.587, 0.114)), 0.0, 1.0);
        rgb = mix(params.p0.rgb, params.p1.rgb, lum);
    } else if (params.op == 4u) {
        // Chroma key: cut alpha where rgb is near the key colour, then DESPILL.
        let key = params.p0.rgb;
        let dist = distance(rgb, key);
        a = a * smoothstep(params.p1.x, params.p1.x + max(params.p1.y, 0.001), dist);
        // Despill: clamp the key's dominant channel to the other two, so the
        // anti-aliased edge pixels (a blend of subject + key) don't survive as a
        // coloured fringe — the classic green/blue-screen spill suppression.
        if (key.g >= key.r && key.g >= key.b) {
            rgb.g = min(rgb.g, max(rgb.r, rgb.b));
        } else if (key.b >= key.r && key.b >= key.g) {
            rgb.b = min(rgb.b, max(rgb.r, rgb.g));
        } else {
            rgb.r = min(rgb.r, max(rgb.g, rgb.b));
        }
    }

    textureStore(dst, vec2<i32>(i32(x), i32(y)), vec4<f32>(rgb, a));
}
"#;

/// Unified per-pixel effect compute pass — one pipeline drives chromatic
/// aberration, vignette, posterize, duotone and chroma-key via an `op` code.
pub struct PixelFx {
    pipeline: wgpu::ComputePipeline,
    bind_group_layout: wgpu::BindGroupLayout,
}

impl PixelFx {
    pub fn new(device: &wgpu::Device) -> Self {
        let module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("onda-pixelfx-wgsl"),
            source: wgpu::ShaderSource::Wgsl(PIXELFX_WGSL.into()),
        });
        let bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("onda-pixelfx-bgl"),
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
                        format: wgpu::TextureFormat::Rgba8Unorm,
                        view_dimension: wgpu::TextureViewDimension::D2,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 2,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
            ],
        });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("onda-pixelfx-pl"),
            bind_group_layouts: &[&bind_group_layout],
            push_constant_ranges: &[],
        });
        let pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some("onda-pixelfx-pipeline"),
            layout: Some(&pipeline_layout),
            module: &module,
            entry_point: "main",
            compilation_options: wgpu::PipelineCompilationOptions::default(),
            cache: None,
        });
        PixelFx {
            pipeline,
            bind_group_layout,
        }
    }

    /// Run one per-pixel `op` over `source`, returning a new texture. `p0`/`p1`
    /// pack the op's parameters (see the WGSL `switch`).
    pub fn run(
        &self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        source: &wgpu::Texture,
        width: u32,
        height: u32,
        op: u32,
        p0: [f32; 4],
        p1: [f32; 4],
    ) -> wgpu::Texture {
        let out = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("onda-pixelfx-out"),
            size: wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::STORAGE_BINDING
                | wgpu::TextureUsages::TEXTURE_BINDING
                | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let src_view = source.create_view(&wgpu::TextureViewDescriptor::default());
        let out_view = out.create_view(&wgpu::TextureViewDescriptor::default());

        let mut bytes = Vec::with_capacity(PIXELFX_PARAMS_SIZE as usize);
        bytes.extend_from_slice(&op.to_le_bytes());
        bytes.extend_from_slice(&width.to_le_bytes());
        bytes.extend_from_slice(&height.to_le_bytes());
        bytes.extend_from_slice(&0u32.to_le_bytes());
        for v in p0.iter().chain(p1.iter()) {
            bytes.extend_from_slice(&v.to_le_bytes());
        }
        let params = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("onda-pixelfx-params"),
            size: PIXELFX_PARAMS_SIZE,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        queue.write_buffer(&params, 0, &bytes);

        let bg = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("onda-pixelfx-bg"),
            layout: &self.bind_group_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(&src_view),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::TextureView(&out_view),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: params.as_entire_binding(),
                },
            ],
        });

        let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("onda-pixelfx-encoder"),
        });
        {
            let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: Some("onda-pixelfx"),
                timestamp_writes: None,
            });
            pass.set_pipeline(&self.pipeline);
            pass.set_bind_group(0, &bg, &[]);
            pass.dispatch_workgroups(width.div_ceil(8), height.div_ceil(8), 1);
        }
        queue.submit(Some(encoder.finish()));
        out
    }
}

// === Composition-level cinematic FINISH (linear-HDR chain + ACES) ===========
//
// Per-node effects can't hold HDR: Vello hands each effect subtree back as an
// 8-bit sRGB image, so values >1.0 are clamped between passes and a final ACES
// tone-map would only ever see 0..1 (→ a muddy, desaturated frame). This chain
// sidesteps that by running AFTER the comp rasterizes, entirely in float:
//   1. DECODE the 8-bit sRGB frame → `Rgba16Float` scene-linear.
//   2. BLOOM in linear: bright-pass (keep highlights, scaled — HDR kept) → separable
//      Gaussian → the halo is *added* in linear, so bright accents bleed past 1.0.
//   3. OUTPUT TRANSFORM: + warm halation, × exposure, ACES tone-map (rolls the HDR
//      highlights off smoothly), encode → 8-bit sRGB. The single tone-map.
// Because the intermediates are float, the bloom's >1.0 light survives all the way
// to the one ACES — the "looks shot" output transform, comp-wide, with or without
// any per-node effect.

const FINISH_DECODE_WGSL: &str = r#"
struct D { w: u32, h: u32, p0: u32, p1: u32 };
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var dst: texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var<uniform> d: D;
fn srgb_to_linear(c: vec3<f32>) -> vec3<f32> {
    let lo = c / 12.92;
    let hi = pow((c + 0.055) / 1.055, vec3<f32>(2.4));
    return select(hi, lo, c <= vec3<f32>(0.04045));
}
@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (gid.x >= d.w || gid.y >= d.h) { return; }
    let p = vec2<i32>(i32(gid.x), i32(gid.y));
    let t = textureLoad(src, p, 0);
    textureStore(dst, p, vec4<f32>(srgb_to_linear(t.rgb), t.a));
}
"#;

const FINISH_BRIGHT_WGSL: &str = r#"
struct B { threshold: f32, intensity: f32, w: u32, h: u32 };
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var dst: texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var<uniform> b: B;
@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (gid.x >= b.w || gid.y >= b.h) { return; }
    let p = vec2<i32>(i32(gid.x), i32(gid.y));
    let c = textureLoad(src, p, 0);
    // Linear-light luminance (Rec. 709). Keep highlights only, scaled by intensity;
    // HDR is preserved (no clamp) so a bright pixel can bloom past 1.0.
    let lum = dot(c.rgb, vec3<f32>(0.2126, 0.7152, 0.0722));
    let keep = step(b.threshold, lum);
    textureStore(dst, p, vec4<f32>(c.rgb * b.intensity * keep, keep));
}
"#;

const FINISH_BLUR_WGSL: &str = r#"
struct K { sigma: f32, dir_x: f32, dir_y: f32, pad: f32, w: u32, h: u32, p0: u32, p1: u32 };
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var dst: texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var<uniform> k: K;
@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (gid.x >= k.w || gid.y >= k.h) { return; }
    let maxx = i32(k.w) - 1;
    let maxy = i32(k.h) - 1;
    let sigma = max(k.sigma, 0.0001);
    let radius = min(i32(ceil(sigma * 3.0)), 160);
    let dx = i32(k.dir_x);
    let dy = i32(k.dir_y);
    let two_s2 = 2.0 * sigma * sigma;
    var sum = vec4<f32>(0.0);
    var wsum = 0.0;
    for (var i = -radius; i <= radius; i = i + 1) {
        let w = exp(-f32(i * i) / two_s2);
        let sx = clamp(i32(gid.x) + i * dx, 0, maxx);
        let sy = clamp(i32(gid.y) + i * dy, 0, maxy);
        sum = sum + textureLoad(src, vec2<i32>(sx, sy), 0) * w;
        wsum = wsum + w;
    }
    textureStore(dst, vec2<i32>(i32(gid.x), i32(gid.y)), sum / wsum);
}
"#;

const FINISH_OUTPUT_WGSL: &str = r#"
struct O {
    exposure: f32, halation: f32, has_bloom: u32, pad: u32,
    w: u32, h: u32, contrast: f32, saturation: f32,
    temperature: f32, vignette: f32, grain: f32, grain_seed: f32,
};
@group(0) @binding(0) var base: texture_2d<f32>;
@group(0) @binding(1) var halo: texture_2d<f32>;
@group(0) @binding(2) var dst: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(3) var<uniform> o: O;
fn linear_to_srgb(c: vec3<f32>) -> vec3<f32> {
    let cc = clamp(c, vec3<f32>(0.0), vec3<f32>(1.0));
    let lo = cc * 12.92;
    let hi = 1.055 * pow(cc, vec3<f32>(1.0 / 2.4)) - 0.055;
    return select(hi, lo, cc <= vec3<f32>(0.0031308));
}
// ACES filmic tone-map (Narkowicz approximation): rolls HDR highlights off smoothly.
fn aces(x: vec3<f32>) -> vec3<f32> {
    let a = 2.51; let b = 0.03; let c = 2.43; let d = 0.59; let e = 0.14;
    return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3<f32>(0.0), vec3<f32>(1.0));
}
const LUMA = vec3<f32>(0.2126, 0.7152, 0.0722);
fn hash2(p: vec2<f32>) -> f32 {
    return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453);
}
@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (gid.x >= o.w || gid.y >= o.h) { return; }
    let p = vec2<i32>(i32(gid.x), i32(gid.y));
    let bcol = textureLoad(base, p, 0);
    var add = vec3<f32>(0.0);
    var halo_a = 0.0;
    if (o.has_bloom == 1u) {
        let h = textureLoad(halo, p, 0);
        add = h.rgb;
        halo_a = h.a;
    }
    // HALATION: a warm red/orange echo of the halo (film red-dye scatter), then exposure.
    let halation = add * vec3<f32>(0.55, 0.18, 0.06) * o.halation;
    var g = (bcol.rgb + add + halation) * o.exposure;
    // GRADE in linear: white-balance (warm/cool), contrast around mid-grey, saturation.
    g = g * vec3<f32>(1.0 + 0.25 * o.temperature, 1.0, 1.0 - 0.25 * o.temperature);
    g = max((g - vec3<f32>(0.18)) * o.contrast + vec3<f32>(0.18), vec3<f32>(0.0));
    let glum = dot(g, LUMA);
    g = max(mix(vec3<f32>(glum), g, o.saturation), vec3<f32>(0.0));
    // VIGNETTE: radial edge darkening (linear), centred on the frame.
    if (o.vignette > 0.0) {
        let uv = vec2<f32>(f32(gid.x) / f32(o.w), f32(gid.y) / f32(o.h)) - vec2<f32>(0.5);
        g = g * (1.0 - o.vignette * smoothstep(0.45, 1.3, length(uv * 2.0)));
    }
    // GRAIN: monochrome noise, peaked in the midtones (luminance-banded), animated by
    // the seed (frame). Added in linear so it sits *in* the image, under the tone-map.
    if (o.grain > 0.0) {
        let n = hash2(vec2<f32>(f32(gid.x), f32(gid.y)) + vec2<f32>(o.grain_seed * 1.7 + 0.5, o.grain_seed * 2.3 + 0.9)) - 0.5;
        let lum = dot(g, LUMA);
        g = max(g + n * o.grain * (4.0 * lum * (1.0 - lum)), vec3<f32>(0.0));
    }
    let rgb = linear_to_srgb(aces(g));
    let a = clamp(bcol.a + halo_a, 0.0, 1.0);
    textureStore(dst, p, vec4<f32>(rgb, a));
}
"#;

/// Parameters for one [`LinearFinish`] run — the resolved `Composition::finish`.
/// `bloom` is `(sigma, threshold, intensity)` or `None`; the grade/vignette/grain
/// fields default to no-ops (`contrast`/`saturation` = 1, the rest 0).
pub struct FinishParams {
    pub exposure: f32,
    pub halation: f32,
    pub bloom: Option<(f32, f32, f32)>,
    pub temperature: f32,
    pub contrast: f32,
    pub saturation: f32,
    pub vignette: f32,
    pub grain: f32,
    pub grain_seed: f32,
}

/// The composition-level cinematic finish chain (see the module comment above):
/// decode → linear-HDR bloom → grade/vignette/grain + exposure + ACES → sRGB. Four
/// cached compute pipelines over `Rgba16Float` intermediates; the final encode is 8-bit.
pub struct LinearFinish {
    decode: wgpu::ComputePipeline,
    decode_layout: wgpu::BindGroupLayout,
    bright: wgpu::ComputePipeline,
    bright_layout: wgpu::BindGroupLayout,
    blur: wgpu::ComputePipeline,
    blur_layout: wgpu::BindGroupLayout,
    output: wgpu::ComputePipeline,
    output_layout: wgpu::BindGroupLayout,
}

impl LinearFinish {
    pub fn new(device: &wgpu::Device) -> Self {
        let tex = |binding: u32| wgpu::BindGroupLayoutEntry {
            binding,
            visibility: wgpu::ShaderStages::COMPUTE,
            ty: wgpu::BindingType::Texture {
                sample_type: wgpu::TextureSampleType::Float { filterable: false },
                view_dimension: wgpu::TextureViewDimension::D2,
                multisampled: false,
            },
            count: None,
        };
        let storage = |binding: u32, format: wgpu::TextureFormat| wgpu::BindGroupLayoutEntry {
            binding,
            visibility: wgpu::ShaderStages::COMPUTE,
            ty: wgpu::BindingType::StorageTexture {
                access: wgpu::StorageTextureAccess::WriteOnly,
                format,
                view_dimension: wgpu::TextureViewDimension::D2,
            },
            count: None,
        };
        let uniform = |binding: u32| wgpu::BindGroupLayoutEntry {
            binding,
            visibility: wgpu::ShaderStages::COMPUTE,
            ty: wgpu::BindingType::Buffer {
                ty: wgpu::BufferBindingType::Uniform,
                has_dynamic_offset: false,
                min_binding_size: None,
            },
            count: None,
        };
        let f16 = wgpu::TextureFormat::Rgba16Float;
        let build = |label: &str, wgsl: &str, entries: &[wgpu::BindGroupLayoutEntry]| {
            let module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
                label: Some(label),
                source: wgpu::ShaderSource::Wgsl(wgsl.into()),
            });
            let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some(label),
                entries,
            });
            let pl = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some(label),
                bind_group_layouts: &[&layout],
                push_constant_ranges: &[],
            });
            let pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
                label: Some(label),
                layout: Some(&pl),
                module: &module,
                entry_point: "main",
                compilation_options: wgpu::PipelineCompilationOptions::default(),
                cache: None,
            });
            (pipeline, layout)
        };
        let (decode, decode_layout) = build(
            "onda-finish-decode",
            FINISH_DECODE_WGSL,
            &[tex(0), storage(1, f16), uniform(2)],
        );
        let (bright, bright_layout) = build(
            "onda-finish-bright",
            FINISH_BRIGHT_WGSL,
            &[tex(0), storage(1, f16), uniform(2)],
        );
        let (blur, blur_layout) = build(
            "onda-finish-blur",
            FINISH_BLUR_WGSL,
            &[tex(0), storage(1, f16), uniform(2)],
        );
        let (output, output_layout) = build(
            "onda-finish-output",
            FINISH_OUTPUT_WGSL,
            &[
                tex(0),
                tex(1),
                storage(2, wgpu::TextureFormat::Rgba8Unorm),
                uniform(3),
            ],
        );
        LinearFinish {
            decode,
            decode_layout,
            bright,
            bright_layout,
            blur,
            blur_layout,
            output,
            output_layout,
        }
    }

    /// Run the finish over `source` (the comp's 8-bit sRGB frame), returning a fresh
    /// 8-bit sRGB texture.
    pub fn run(
        &self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        source: &wgpu::Texture,
        width: u32,
        height: u32,
        params: &FinishParams,
    ) -> wgpu::Texture {
        let bloom = params.bloom;
        let f16 = |label: &str| {
            device.create_texture(&wgpu::TextureDescriptor {
                label: Some(label),
                size: wgpu::Extent3d {
                    width,
                    height,
                    depth_or_array_layers: 1,
                },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: wgpu::TextureFormat::Rgba16Float,
                usage: wgpu::TextureUsages::STORAGE_BINDING | wgpu::TextureUsages::TEXTURE_BINDING,
                view_formats: &[],
            })
        };
        let view = |t: &wgpu::Texture| t.create_view(&wgpu::TextureViewDescriptor::default());

        // A single-input float pass (decode / bright / blur): src tex → dst storage.
        let pass3 = |pipeline: &wgpu::ComputePipeline,
                     layout: &wgpu::BindGroupLayout,
                     src: &wgpu::TextureView,
                     dst: &wgpu::TextureView,
                     params: &[u8]| {
            let buf = device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("onda-finish-params"),
                size: params.len() as u64,
                usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            });
            queue.write_buffer(&buf, 0, params);
            let bg = device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("onda-finish-bg"),
                layout,
                entries: &[
                    wgpu::BindGroupEntry {
                        binding: 0,
                        resource: wgpu::BindingResource::TextureView(src),
                    },
                    wgpu::BindGroupEntry {
                        binding: 1,
                        resource: wgpu::BindingResource::TextureView(dst),
                    },
                    wgpu::BindGroupEntry {
                        binding: 2,
                        resource: buf.as_entire_binding(),
                    },
                ],
            });
            let mut enc = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("onda-finish-encoder"),
            });
            {
                let mut p = enc.begin_compute_pass(&wgpu::ComputePassDescriptor {
                    label: Some("onda-finish-pass"),
                    timestamp_writes: None,
                });
                p.set_pipeline(pipeline);
                p.set_bind_group(0, &bg, &[]);
                p.dispatch_workgroups(width.div_ceil(8), height.div_ceil(8), 1);
            }
            queue.submit(Some(enc.finish()));
        };

        // 1) Decode the sRGB frame to scene-linear float.
        let lin = f16("onda-finish-linear");
        let mut decode_p = Vec::with_capacity(16);
        decode_p.extend_from_slice(&width.to_le_bytes());
        decode_p.extend_from_slice(&height.to_le_bytes());
        decode_p.extend_from_slice(&0u32.to_le_bytes());
        decode_p.extend_from_slice(&0u32.to_le_bytes());
        pass3(
            &self.decode,
            &self.decode_layout,
            &view(source),
            &view(&lin),
            &decode_p,
        );

        // 2) Linear-HDR bloom: bright-pass → separable Gaussian (H then V).
        let halo = bloom.map(|(sigma, threshold, intensity)| {
            let bright = f16("onda-finish-bright-tex");
            let mut bp = Vec::with_capacity(16);
            bp.extend_from_slice(&threshold.to_le_bytes());
            bp.extend_from_slice(&intensity.to_le_bytes());
            bp.extend_from_slice(&width.to_le_bytes());
            bp.extend_from_slice(&height.to_le_bytes());
            pass3(
                &self.bright,
                &self.bright_layout,
                &view(&lin),
                &view(&bright),
                &bp,
            );
            let blur_params = |dir: (f32, f32)| {
                let mut k = Vec::with_capacity(32);
                k.extend_from_slice(&sigma.to_le_bytes());
                k.extend_from_slice(&dir.0.to_le_bytes());
                k.extend_from_slice(&dir.1.to_le_bytes());
                k.extend_from_slice(&0f32.to_le_bytes());
                k.extend_from_slice(&width.to_le_bytes());
                k.extend_from_slice(&height.to_le_bytes());
                k.extend_from_slice(&0u32.to_le_bytes());
                k.extend_from_slice(&0u32.to_le_bytes());
                k
            };
            let tmp = f16("onda-finish-blur-h");
            pass3(
                &self.blur,
                &self.blur_layout,
                &view(&bright),
                &view(&tmp),
                &blur_params((1.0, 0.0)),
            );
            let halo = f16("onda-finish-halo");
            pass3(
                &self.blur,
                &self.blur_layout,
                &view(&tmp),
                &view(&halo),
                &blur_params((0.0, 1.0)),
            );
            halo
        });

        // 3) Output transform: + halation, × exposure, ACES, encode → 8-bit sRGB.
        let out = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("onda-finish-out"),
            size: wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::STORAGE_BINDING
                | wgpu::TextureUsages::TEXTURE_BINDING
                | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        // No bloom → bind `lin` as a stand-in for the unused halo sampler (has_bloom=0).
        let halo_view = halo.as_ref().map(view).unwrap_or_else(|| view(&lin));
        let mut op = Vec::with_capacity(48);
        op.extend_from_slice(&params.exposure.to_le_bytes());
        op.extend_from_slice(&params.halation.to_le_bytes());
        op.extend_from_slice(&(bloom.is_some() as u32).to_le_bytes());
        op.extend_from_slice(&0u32.to_le_bytes());
        op.extend_from_slice(&width.to_le_bytes());
        op.extend_from_slice(&height.to_le_bytes());
        op.extend_from_slice(&params.contrast.to_le_bytes());
        op.extend_from_slice(&params.saturation.to_le_bytes());
        op.extend_from_slice(&params.temperature.to_le_bytes());
        op.extend_from_slice(&params.vignette.to_le_bytes());
        op.extend_from_slice(&params.grain.to_le_bytes());
        op.extend_from_slice(&params.grain_seed.to_le_bytes());
        let buf = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("onda-finish-output-params"),
            size: op.len() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        queue.write_buffer(&buf, 0, &op);
        let bg = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("onda-finish-output-bg"),
            layout: &self.output_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(&view(&lin)),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::TextureView(&halo_view),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: wgpu::BindingResource::TextureView(&view(&out)),
                },
                wgpu::BindGroupEntry {
                    binding: 3,
                    resource: buf.as_entire_binding(),
                },
            ],
        });
        let mut enc = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("onda-finish-output-encoder"),
        });
        {
            let mut p = enc.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: Some("onda-finish-output"),
                timestamp_writes: None,
            });
            p.set_pipeline(&self.output);
            p.set_bind_group(0, &bg, &[]);
            p.dispatch_workgroups(width.div_ceil(8), height.div_ceil(8), 1);
        }
        queue.submit(Some(enc.finish()));
        out
    }
}

/// The composite dims uniform (width u32, height u32, + std140 padding to 16 bytes).
fn make_bloom_dims(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    width: u32,
    height: u32,
    linear: bool,
    exposure: f32,
    halation: f32,
) -> wgpu::Buffer {
    let mut bytes = Vec::with_capacity(BLOOM_DIMS_SIZE as usize);
    bytes.extend_from_slice(&width.to_le_bytes());
    bytes.extend_from_slice(&height.to_le_bytes());
    bytes.extend_from_slice(&(linear as u32).to_le_bytes());
    bytes.extend_from_slice(&exposure.to_le_bytes());
    bytes.extend_from_slice(&halation.to_le_bytes());
    bytes.extend_from_slice(&0f32.to_le_bytes());
    bytes.extend_from_slice(&0f32.to_le_bytes());
    bytes.extend_from_slice(&0f32.to_le_bytes());
    let buf = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("onda-bloom-dims"),
        size: BLOOM_DIMS_SIZE,
        usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        mapped_at_creation: false,
    });
    queue.write_buffer(&buf, 0, &bytes);
    buf
}

/// A `Params` uniform buffer (radius, direction, width, height), written via the
/// queue.
fn make_params(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    radius: u32,
    dir_x: f32,
    dir_y: f32,
    width: u32,
    height: u32,
) -> wgpu::Buffer {
    // Field order MUST match the WGSL `Params` struct (radius, width, height,
    // dir_x, dir_y = 5 scalars / 20 bytes), padded to the 16-aligned uniform
    // stride (32).
    let mut bytes = Vec::with_capacity(PARAMS_SIZE as usize);
    bytes.extend_from_slice(&radius.to_le_bytes());
    bytes.extend_from_slice(&width.to_le_bytes());
    bytes.extend_from_slice(&height.to_le_bytes());
    bytes.extend_from_slice(&dir_x.to_le_bytes());
    bytes.extend_from_slice(&dir_y.to_le_bytes());
    bytes.resize(PARAMS_SIZE as usize, 0);
    let buf = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("onda-blur-params"),
        size: PARAMS_SIZE,
        usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        mapped_at_creation: false,
    });
    queue.write_buffer(&buf, 0, &bytes);
    buf
}

/// Normalized 1-D Gaussian taps for `sigma`, indexed `0..=2*radius` with center
/// at `radius` (offset 0). Radius = `ceil(3σ)` (matches the spec's 3σ cutoff and
/// the CPU path). A non-positive/`NaN` sigma collapses to a single 1.0 tap
/// (identity), so a degenerate effect is a harmless passthrough.
fn gaussian_weights(sigma: f32) -> Vec<f32> {
    if sigma <= 0.0 || sigma.is_nan() {
        return vec![1.0];
    }
    let radius = (3.0 * sigma).ceil() as i32;
    let two_sigma2 = 2.0 * sigma * sigma;
    let mut w: Vec<f32> = (-radius..=radius)
        .map(|i| {
            let x = i as f32;
            (-(x * x) / two_sigma2).exp()
        })
        .collect();
    let sum: f32 = w.iter().sum();
    if sum > 0.0 {
        for v in &mut w {
            *v /= sum;
        }
    }
    w
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn weights_sum_to_one_and_are_symmetric() {
        let w = gaussian_weights(8.0);
        let sum: f32 = w.iter().sum();
        assert!((sum - 1.0).abs() < 1e-5, "weights should normalize to 1");
        let r = w.len() / 2;
        for i in 0..r {
            assert!(
                (w[i] - w[w.len() - 1 - i]).abs() < 1e-6,
                "gaussian taps should be symmetric"
            );
        }
        // radius = ceil(3*8) = 24 → 49 taps.
        assert_eq!(w.len(), 49);
    }

    #[test]
    fn degenerate_sigma_is_identity() {
        assert_eq!(gaussian_weights(0.0), vec![1.0]);
        assert_eq!(gaussian_weights(-3.0), vec![1.0]);
    }
}
