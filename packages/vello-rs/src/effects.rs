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
    direction: u32, // 0 = horizontal, 1 = vertical
    width: u32,
    height: u32,
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
        var sx = i32(x);
        var sy = i32(y);
        if (params.direction == 0u) {
            sx = clamp(i32(x) + i, 0, maxx);
        } else {
            sy = clamp(i32(y) + i, 0, maxy);
        }
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
const PARAMS_SIZE: u64 = 16;

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

        // Per-pass params uniforms (direction differs).
        let params_h = make_params(device, queue, radius, 0, width, height);
        let params_v = make_params(device, queue, radius, 1, width, height);

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

/// A `Params` uniform buffer (radius, direction, width, height), written via the
/// queue.
fn make_params(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    radius: u32,
    direction: u32,
    width: u32,
    height: u32,
) -> wgpu::Buffer {
    let mut bytes = Vec::with_capacity(PARAMS_SIZE as usize);
    bytes.extend_from_slice(&radius.to_le_bytes());
    bytes.extend_from_slice(&direction.to_le_bytes());
    bytes.extend_from_slice(&width.to_le_bytes());
    bytes.extend_from_slice(&height.to_le_bytes());
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
