//! Vello vector renderer for ONDA — step 1 (probe).
//!
//! Vello is a GPU compute-based 2D vector renderer (anti-aliased paths, strokes,
//! gradients, clips). This probe confirms it builds and renders headlessly here,
//! drawing things the quad+SDF `onda-gpu` pipeline *cannot* (arbitrary Béziers,
//! strokes). Mapping the ONDA scene graph onto Vello — and retiring quad+SDF — is
//! the migration this de-risks.
//!
//! Note: vello 0.3 pins wgpu 22, so this uses `vello::wgpu` (a different wgpu than
//! `onda-gpu`'s 24) until the migration consolidates on Vello.

use vello::kurbo::{Affine, BezPath, Circle, Rect, Stroke};
use vello::peniko::{Color, Fill};
use vello::{wgpu, AaConfig, RenderParams, Renderer, RendererOptions, Scene};

/// A rendered frame: straight-alpha RGBA8, row-major, top-left origin.
pub struct Frame {
    pub width: u32,
    pub height: u32,
    pub pixels: Vec<u8>,
}

/// Render a sample vector scene (backdrop, filled circle, stroked Bézier curve)
/// via Vello. `None` if no GPU adapter is available.
pub fn render_sample(width: u32, height: u32) -> Option<Frame> {
    pollster::block_on(render_async(width, height))
}

async fn render_async(width: u32, height: u32) -> Option<Frame> {
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

    // A dark backdrop, a filled circle, and a stroked cubic Bézier — arbitrary
    // paths + strokes, the whole point of Vello.
    let mut scene = Scene::new();
    let (w, h) = (width as f64, height as f64);
    scene.fill(
        Fill::NonZero,
        Affine::IDENTITY,
        Color::rgb8(10, 13, 23),
        None,
        &Rect::new(0.0, 0.0, w, h),
    );
    scene.fill(
        Fill::NonZero,
        Affine::IDENTITY,
        Color::rgb8(41, 115, 242),
        None,
        &Circle::new((w * 0.5, h * 0.4), h * 0.22),
    );
    let mut path = BezPath::new();
    path.move_to((w * 0.1, h * 0.8));
    path.curve_to((w * 0.3, h * 0.2), (w * 0.7, h * 1.1), (w * 0.9, h * 0.5));
    scene.stroke(
        &Stroke::new(10.0),
        Affine::IDENTITY,
        Color::rgb8(235, 90, 110),
        None,
        &path,
    );

    let mut renderer = Renderer::new(
        &device,
        RendererOptions {
            surface_format: None,
            use_cpu: false,
            antialiasing_support: vello::AaSupport::area_only(),
            num_init_threads: None,
        },
    )
    .ok()?;

    let texture = device.create_texture(&wgpu::TextureDescriptor {
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

    renderer
        .render_to_texture(
            &device,
            &queue,
            &scene,
            &view,
            &RenderParams {
                base_color: Color::TRANSPARENT,
                width,
                height,
                antialiasing_method: AaConfig::Area,
            },
        )
        .ok()?;

    Some(read_back(&device, &queue, &texture, width, height))
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
    #[test]
    fn renders_a_vector_scene() {
        let Some(frame) = super::render_sample(80, 80) else {
            eprintln!("no GPU adapter; skipping");
            return;
        };
        assert_eq!(frame.pixels.len(), 80 * 80 * 4);
        // The backdrop is opaque, so the corner pixel is opaque.
        assert_eq!(frame.pixels[3], 255);
    }
}
