//! ONDA renderer — CPU reference rasterizer.
//!
//! It walks a [`Scene`] and produces an in-memory RGBA8 [`Framebuffer`] on the
//! CPU — no GPU — so it renders anywhere (headless servers, CI, browsers without
//! WebGPU via `@onda/wasm`) and pins down the scene-graph → pixels *contract*
//! (transform/opacity inheritance, src-over compositing, coordinate conventions)
//! deterministically.
//!
//! Shapes — rects, rounded rects, ellipses and arbitrary SVG paths, with solid or
//! linear/radial gradient fills and strokes, anti-aliased — are rasterized by
//! [`tiny_skia`] (the pure-Rust Skia raster pipeline behind resvg) into a temp
//! pixmap and composited into the framebuffer. Images blit per [`ImageFit`]; text
//! composites `onda-typography` coverage masks when the [`Renderer`] has a
//! [`FontContext`]. Deferred (Vello/GPU only): rotation ([`Transform::then`]
//! drops it on the CPU path), clipping, blend modes, and blur/filter passes.
//!
//! Coordinate convention: pixel space, origin top-left, +x right, +y down. A
//! shape's geometry is authored in its own local space with origin at top-left;
//! the node's (composed) transform places it on the canvas.

use kurbo::{BezPath, PathEl, Shape as _};
use onda_core::{Color, Size, Transform, Vec2};
use onda_scene::{
    Effect, Gradient, GradientStop, ImageData, ImageFit, LineCap, LineJoin, Matte, MatteMode, Node,
    NodeKind, Scene, Shape, ShapeGeometry, Text,
};
pub use onda_typography::{FontContext, TextMetrics, TextRaster};
use tiny_skia as tsk;

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

    /// A new framebuffer holding the `[x, y, w, h]` sub-rectangle, clamped to the
    /// framebuffer's bounds (an over-large region just yields what exists). Used by
    /// the agent-vision zoom (`onda render-frame --crop`) and frame tiling.
    pub fn crop(&self, x: u32, y: u32, w: u32, h: u32) -> Framebuffer {
        let x = x.min(self.width);
        let y = y.min(self.height);
        let w = w.min(self.width - x);
        let h = h.min(self.height - y);
        let row_bytes = (w as usize) * 4;
        let mut pixels = Vec::with_capacity((h as usize) * row_bytes);
        for row in 0..h as usize {
            let start = (((y as usize) + row) * (self.width as usize) + (x as usize)) * 4;
            pixels.extend_from_slice(&self.pixels[start..start + row_bytes]);
        }
        Framebuffer::from_rgba(w, h, pixels)
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

/// Quantization total for the integer Gaussian kernel. Weights are scaled to sum
/// to exactly this fixed value so the convolution divides by a constant — keeping
/// the hot loop pure integer math (no platform-varying float reduction), which is
/// what makes the blur byte-identical across runs and architectures.
const BLUR_WEIGHT_TOTAL: u32 = 1 << 16;

/// Upper bound on a matte's capture-window dimension, so a pathological scene
/// (e.g. a huge content box) can't request a giant temp framebuffer.
const MAX_MATTE_DIM: u32 = 8192;

/// Build the 1-D Gaussian kernel for `sigma`, quantized to integer weights that
/// sum to exactly [`BLUR_WEIGHT_TOTAL`]. Returns `(radius, weights)` where
/// `weights.len() == 2*radius + 1` (index 0 = `-radius`, center at `radius`).
///
/// Determinism: the f32 weights are computed once, normalized, scaled to the
/// fixed total and rounded to `u32`; any rounding remainder is folded into the
/// center weight so the sum is *exactly* `BLUR_WEIGHT_TOTAL`. The convolution
/// itself never touches floats.
fn blur_kernel(sigma: f32) -> (usize, Vec<u32>) {
    // 3σ cutoff (per the RTT spec); always at least radius 1 so a tiny σ still
    // produces a real 3-tap blur rather than a degenerate identity.
    let radius = (3.0 * sigma).ceil().max(1.0) as usize;
    let len = 2 * radius + 1;

    // f32 Gaussian samples, then normalize to sum 1.0.
    let inv_two_sigma_sq = 1.0 / (2.0 * sigma * sigma);
    let mut samples = Vec::with_capacity(len);
    let mut sum = 0.0f32;
    for i in 0..len {
        let x = i as f32 - radius as f32;
        let w = (-(x * x) * inv_two_sigma_sq).exp();
        samples.push(w);
        sum += w;
    }

    // Quantize to integers summing to exactly BLUR_WEIGHT_TOTAL. Round each weight
    // independently, then push the (small) remainder onto the center tap so the
    // total is exact and the kernel stays symmetric-ish around its peak.
    let scale = BLUR_WEIGHT_TOTAL as f32 / sum;
    let mut weights: Vec<u32> = samples
        .iter()
        .map(|&w| (w * scale).round() as u32)
        .collect();
    let quantized_sum: u32 = weights.iter().sum();
    // Fold the rounding remainder into the center (the largest weight), clamping so
    // we never underflow if rounding overshot.
    let center = &mut weights[radius];
    if quantized_sum <= BLUR_WEIGHT_TOTAL {
        *center += BLUR_WEIGHT_TOTAL - quantized_sum;
    } else {
        *center = center.saturating_sub(quantized_sum - BLUR_WEIGHT_TOTAL);
    }
    debug_assert_eq!(weights.iter().sum::<u32>(), BLUR_WEIGHT_TOTAL);

    (radius, weights)
}

/// Apply a deterministic separable Gaussian blur (std-dev `sigma`, in pixels) to
/// `fb` in place. Two passes (horizontal then vertical) over premultiplied-alpha
/// channels with clamp-to-edge borders; integer-quantized weights and `u32`
/// accumulation make it byte-identical across runs and architectures.
///
/// `sigma <= 0` is a no-op. The framebuffer's straight-alpha contract is
/// preserved: each pixel is premultiplied on read and un-premultiplied on write.
pub fn blur_framebuffer(fb: &mut Framebuffer, sigma: f32) {
    if sigma <= 0.0 || fb.width == 0 || fb.height == 0 {
        return;
    }
    let (radius, weights) = blur_kernel(sigma);
    let w = fb.width as usize;
    let h = fb.height as usize;

    // Work in premultiplied alpha so the blur doesn't bleed color from fully
    // transparent texels (their RGB is undefined in straight-alpha). Stored as
    // u16 per channel (0..=255 fits) for compact, exact accumulation.
    let mut premul = vec![0u16; w * h * 4];
    for (dst, src) in premul.chunks_exact_mut(4).zip(fb.pixels.chunks_exact(4)) {
        let a = src[3] as u32;
        // Premultiply with round-to-nearest, /255, so it round-trips with the
        // demultiply below (both use +127 .. /255).
        dst[0] = ((src[0] as u32 * a + 127) / 255) as u16;
        dst[1] = ((src[1] as u32 * a + 127) / 255) as u16;
        dst[2] = ((src[2] as u32 * a + 127) / 255) as u16;
        dst[3] = a as u16;
    }

    // Horizontal pass: premul -> tmp. Vertical pass: tmp -> premul.
    let mut tmp = vec![0u16; w * h * 4];
    blur_pass_h(&premul, &mut tmp, w, h, radius, &weights);
    blur_pass_v(&tmp, &mut premul, w, h, radius, &weights);

    // Un-premultiply back into the straight-alpha framebuffer.
    for (dst, src) in fb.pixels.chunks_exact_mut(4).zip(premul.chunks_exact(4)) {
        let a = src[3] as u32;
        if a == 0 {
            dst.copy_from_slice(&[0, 0, 0, 0]);
            continue;
        }
        dst[0] = (((src[0] as u32 * 255 + a / 2) / a).min(255)) as u8;
        dst[1] = (((src[1] as u32 * 255 + a / 2) / a).min(255)) as u8;
        dst[2] = (((src[2] as u32 * 255 + a / 2) / a).min(255)) as u8;
        dst[3] = a as u8;
    }
}

/// One horizontal separable-blur pass over premultiplied u16 channels, clamping
/// sample indices to the row's edges. `src`/`dst` are `w*h*4` premultiplied
/// buffers. Accumulation is `u32`; the divide by [`BLUR_WEIGHT_TOTAL`] is the
/// only reduction and it's exact.
fn blur_pass_h(src: &[u16], dst: &mut [u16], w: usize, h: usize, radius: usize, weights: &[u32]) {
    for y in 0..h {
        let row = y * w;
        for x in 0..w {
            let mut acc = [0u32; 4];
            for (k, &weight) in weights.iter().enumerate() {
                let sx =
                    (x as isize + k as isize - radius as isize).clamp(0, w as isize - 1) as usize;
                let i = (row + sx) * 4;
                acc[0] += src[i] as u32 * weight;
                acc[1] += src[i + 1] as u32 * weight;
                acc[2] += src[i + 2] as u32 * weight;
                acc[3] += src[i + 3] as u32 * weight;
            }
            let o = (row + x) * 4;
            dst[o] = (acc[0] / BLUR_WEIGHT_TOTAL) as u16;
            dst[o + 1] = (acc[1] / BLUR_WEIGHT_TOTAL) as u16;
            dst[o + 2] = (acc[2] / BLUR_WEIGHT_TOTAL) as u16;
            dst[o + 3] = (acc[3] / BLUR_WEIGHT_TOTAL) as u16;
        }
    }
}

/// One vertical separable-blur pass (mirror of [`blur_pass_h`], clamping to the
/// column's edges).
fn blur_pass_v(src: &[u16], dst: &mut [u16], w: usize, h: usize, radius: usize, weights: &[u32]) {
    for y in 0..h {
        for x in 0..w {
            let mut acc = [0u32; 4];
            for (k, &weight) in weights.iter().enumerate() {
                let sy =
                    (y as isize + k as isize - radius as isize).clamp(0, h as isize - 1) as usize;
                let i = (sy * w + x) * 4;
                acc[0] += src[i] as u32 * weight;
                acc[1] += src[i + 1] as u32 * weight;
                acc[2] += src[i + 2] as u32 * weight;
                acc[3] += src[i + 3] as u32 * weight;
            }
            let o = (y * w + x) * 4;
            dst[o] = (acc[0] / BLUR_WEIGHT_TOTAL) as u16;
            dst[o + 1] = (acc[1] / BLUR_WEIGHT_TOTAL) as u16;
            dst[o + 2] = (acc[2] / BLUR_WEIGHT_TOTAL) as u16;
            dst[o + 3] = (acc[3] / BLUR_WEIGHT_TOTAL) as u16;
        }
    }
}

/// Fixed-point shift for the bloom intensity multiplier — `intensity` is encoded
/// as `round(intensity * 256)` so the bright-pass scale stays integer math
/// (`channel * mul >> 8`), keeping bloom byte-identical across runs/architectures.
const BLOOM_INTENSITY_SHIFT: u32 = 8;

/// Apply a deterministic bloom/glow to `fb` in place: bright-pass → large-σ blur →
/// additive composite over the original sharp pixels.
///
/// 1. **Bright-pass.** Each pixel's Rec. 601 luminance (integer 0..255, computed on
///    its straight-alpha RGB) is compared to `threshold` (mapped once to a 0..255
///    cutoff). Pixels at/above it are kept, their RGB scaled by `intensity`
///    (fixed-point, clamped to 255) at full alpha; the rest become transparent.
/// 2. **Blur.** The bright copy is blurred with [`blur_framebuffer`] (`sigma`) — the
///    same deterministic integer kernel — spreading each highlight into a soft halo.
/// 3. **Additive composite.** The blurred halo is added (per channel, clamped to
///    255) onto the sharp pixels, weighted by the halo's alpha, so a bright accent
///    glows without washing out the dark background.
///
/// All arithmetic is integer/fixed-point, so the result is byte-identical across
/// runs and architectures (matching the blur's determinism contract). A
/// non-positive `sigma` or `intensity` is a no-op (nothing to spread/add).
pub fn bloom_framebuffer(fb: &mut Framebuffer, threshold: f32, intensity: f32, sigma: f32) {
    if sigma <= 0.0 || intensity <= 0.0 || fb.width() == 0 || fb.height() == 0 {
        return;
    }
    // Threshold → 0..255 luminance cutoff (clamped; NaN → no pixels pass).
    let cutoff = (threshold.clamp(0.0, 1.0) * 255.0).round() as u32;
    // Intensity → fixed-point multiplier (round-to-nearest, integer).
    let mul = (intensity.max(0.0) * (1u32 << BLOOM_INTENSITY_SHIFT) as f32).round() as u32;

    // Bright-pass copy: a separate framebuffer holding only the scaled highlights.
    let mut bright = Framebuffer::new(fb.width(), fb.height());
    for (src, dst) in fb
        .pixels
        .chunks_exact(4)
        .zip(bright.pixels.chunks_exact_mut(4))
    {
        let (r, g, b, a) = (src[0] as u32, src[1] as u32, src[2] as u32, src[3] as u32);
        if a == 0 {
            continue; // fully transparent → contributes no light
        }
        // Rec. 601 luminance on straight-alpha RGB, integer weights /256.
        let luma = (r * 77 + g * 150 + b * 29) >> 8;
        if luma < cutoff {
            continue; // below threshold → no bloom from this pixel
        }
        // Keep the (scaled, clamped) color at full alpha so the blur spreads a
        // solid highlight; the original alpha gates *whether* a pixel blooms.
        dst[0] = ((r * mul) >> BLOOM_INTENSITY_SHIFT).min(255) as u8;
        dst[1] = ((g * mul) >> BLOOM_INTENSITY_SHIFT).min(255) as u8;
        dst[2] = ((b * mul) >> BLOOM_INTENSITY_SHIFT).min(255) as u8;
        dst[3] = 255;
    }

    // Spread the highlights into a soft halo (same deterministic integer kernel).
    blur_framebuffer(&mut bright, sigma);

    // Additive composite: add the halo (weighted by its alpha) onto the sharp
    // pixels, clamping each channel to 255. Additive blending is what makes bloom
    // read as *light* rather than a flat overlay.
    for (dst, halo) in fb
        .pixels
        .chunks_exact_mut(4)
        .zip(bright.pixels.chunks_exact(4))
    {
        let ha = halo[3] as u32;
        if ha == 0 {
            continue;
        }
        // Premultiply the halo's straight-alpha color by its coverage (round /255),
        // then add. The destination alpha grows toward opaque where light lands.
        let add = |c: u32| (c * ha + 127) / 255;
        dst[0] = (dst[0] as u32 + add(halo[0] as u32)).min(255) as u8;
        dst[1] = (dst[1] as u32 + add(halo[1] as u32)).min(255) as u8;
        dst[2] = (dst[2] as u32 + add(halo[2] as u32)).min(255) as u8;
        dst[3] = (dst[3] as u32 + ha).min(255) as u8;
    }
}

/// Half-width of the alpha-threshold ramp for the gooey morph, as a fraction of
/// the full 0..1 alpha range. A few percent gives a crisp-but-anti-aliased edge:
/// blurred alpha within `±GOO_RAMP` of the cutoff smoothsteps from transparent to
/// opaque; outside it snaps to 0 / 255. Small enough that overlapping blurred
/// halos fuse into one solid form, wide enough that the fused edge isn't aliased.
const GOO_RAMP: f32 = 0.06;

/// Apply a deterministic gooey / metaball morph to `fb` in place: blur with
/// `sigma` (the shared integer kernel), then sharpen the blurred alpha around
/// `threshold` so overlapping shapes — whose halos merge in the blur — fuse into
/// solid forms joined by smooth necks.
///
/// 1. **Blur.** [`blur_framebuffer`] spreads each shape's alpha; where two shapes
///    are close, their halos sum past the cutoff in the gap between them.
/// 2. **Alpha threshold.** Each pixel's blurred alpha is remapped through a steep
///    smoothstep centered on `threshold` (half-width [`GOO_RAMP`]): alpha well
///    above the cutoff → ~opaque (255), well below → ~transparent (0), with a
///    few-percent anti-aliased ramp between. RGB is left untouched (the straight-
///    alpha color the blur produced), so a colored blob keeps its color; only the
///    coverage is re-shaped into the fused metaball silhouette.
///
/// The remap is a 256-entry `u8` LUT built once (round-to-nearest f32 → u8) and
/// indexed per pixel, so the per-pixel work is an integer table lookup — the
/// result is byte-identical across runs and architectures (matching the blur's
/// determinism contract). `threshold` is clamped to `0..1`. A non-positive
/// `sigma` skips the blur but still thresholds (a hard alpha edge); the same 3σ
/// capture margin as a plain blur applies upstream.
pub fn goo_framebuffer(fb: &mut Framebuffer, sigma: f32, threshold: f32) {
    if fb.width == 0 || fb.height == 0 {
        return;
    }
    // 1) Blur the captured subtree so neighboring shapes' alpha halos overlap.
    blur_framebuffer(fb, sigma);

    // 2) Build the alpha remap LUT: a steep smoothstep around `threshold`. Below
    //    `lo` → 0, above `hi` → 255, smoothstep in between (so the fused edge is
    //    anti-aliased rather than a hard 1px step). NaN threshold → clamps to 0.
    let cutoff = threshold.clamp(0.0, 1.0);
    let lo = (cutoff - GOO_RAMP).max(0.0);
    let hi = (cutoff + GOO_RAMP).min(1.0);
    let span = hi - lo;
    let mut alpha_lut = [0u8; GRADE_LUT_LEN];
    for (i, slot) in alpha_lut.iter_mut().enumerate() {
        let a = i as f32 / 255.0;
        let t = if span <= 0.0 {
            // Degenerate ramp (threshold at an edge) → a hard step at the cutoff.
            if a >= cutoff {
                1.0
            } else {
                0.0
            }
        } else {
            ((a - lo) / span).clamp(0.0, 1.0)
        };
        // Smoothstep 3t² − 2t³ for an eased, symmetric edge.
        let s = t * t * (3.0 - 2.0 * t);
        *slot = (s * 255.0).round() as u8;
    }

    // Remap each pixel's alpha through the LUT. RGB is preserved as-is: it's the
    // straight-alpha color the blur produced; re-thresholding only the coverage
    // sculpts the fused silhouette while every blob keeps its own color.
    for px in fb.pixels.chunks_exact_mut(4) {
        px[3] = alpha_lut[px[3] as usize];
    }
}

/// Fixed-point shift for the color-grade per-channel lookup table. The grade is a
/// pure per-channel function of the input byte, so we precompute a 256-entry `u8`
/// LUT per channel once and index it per pixel — the hot loop is a table lookup,
/// no float math, so the result is byte-identical across runs and architectures.
const GRADE_LUT_LEN: usize = 256;

/// Apply a deterministic cinematic color grade to `fb` in place: a per-pixel color
/// remap (exposure → contrast → temperature/tint → saturation), operating on
/// straight-alpha RGB (alpha is untouched). No blur — a single cheap pass.
///
/// The order and math (all in 0..1 float, but resolved through fixed 256-entry
/// per-channel LUTs so the per-pixel work is integer table lookups):
/// 1. **Exposure** — linear gain `2^exposure` (`0` = identity; +1 ≈ one stop
///    brighter). A per-channel pre-LUT is built from this.
/// 2. **Contrast** — pivot around `0.5`: `c' = (c - 0.5) * contrast + 0.5`
///    (`1` = identity). Folded into the same per-channel pre-LUT as exposure.
/// 3. **Temperature / tint** — a constant per-channel multiplier: `temperature`
///    lifts R and lowers B (positive = warmer), `tint` lifts G (positive =
///    greener, negative = magenta). Folded into the per-channel pre-LUTs so R/G/B
///    each get their own LUT. `0`/`0` is neutral.
/// 4. **Saturation** — lerp each pixel's RGB toward its Rec.601 luma
///    (`0.299r + 0.587g + 0.114b`): `out = luma + (rgb - luma) * saturation`
///    (`1` = identity, `0` = grayscale, >1 = punchier). This couples the three
///    channels, so it runs per pixel *after* the per-channel LUTs (still integer:
///    fixed-point luma weights, round-to-nearest).
///
/// The neutral identity (exposure 0, contrast 1, saturation 1, temperature 0,
/// tint 0) is a no-op fast path, so a grade that does nothing leaves `fb`
/// byte-identical.
pub fn color_grade_framebuffer(
    fb: &mut Framebuffer,
    exposure: f32,
    contrast: f32,
    saturation: f32,
    temperature: f32,
    tint: f32,
) {
    // Neutral identity → nothing to do (and keeps any neutral grade a true no-op).
    let neutral = exposure == 0.0
        && contrast == 1.0
        && saturation == 1.0
        && temperature == 0.0
        && tint == 0.0;
    if neutral || fb.width == 0 || fb.height == 0 {
        return;
    }

    // Per-channel pre-LUTs fold the channel-independent stages (exposure, contrast,
    // temperature/tint) into one 0..255 → 0..255 table each, evaluated once.
    let gain = exposure.exp2(); // 2^exposure (0 → 1.0, identity)
                                // Temperature: warm (positive) lifts red, cools blue; symmetric small gains.
    let r_mul = gain * (1.0 + temperature * 0.5);
    let b_mul = gain * (1.0 - temperature * 0.5);
    // Tint: positive → green, negative → magenta (lift/drop green).
    let g_mul = gain * (1.0 + tint * 0.5);

    let build_lut = |channel_mul: f32| -> [u8; GRADE_LUT_LEN] {
        let mut lut = [0u8; GRADE_LUT_LEN];
        for (i, slot) in lut.iter_mut().enumerate() {
            let v = i as f32 / 255.0;
            let v = v * channel_mul; // exposure + temperature/tint
            let v = (v - 0.5) * contrast + 0.5; // contrast around 0.5 pivot
                                                // Round-to-nearest f32 → u8 (deterministic clamp), no platform-varying
                                                // reduction: each entry is an independent scalar evaluation.
            *slot = (v.clamp(0.0, 1.0) * 255.0).round() as u8;
        }
        lut
    };
    let lut_r = build_lut(r_mul);
    let lut_g = build_lut(g_mul);
    let lut_b = build_lut(b_mul);

    // Saturation as a fixed-point multiplier (round-to-nearest); 1<<8 unit. Applied
    // per pixel after the LUTs, lerping each channel toward integer Rec.601 luma.
    let sat_fp = (saturation.max(0.0) * 256.0).round() as i32;

    for px in fb.pixels.chunks_exact_mut(4) {
        if px[3] == 0 {
            continue; // fully transparent → no visible color to grade
        }
        // 1–3) per-channel LUT (exposure, contrast, temperature/tint).
        let r = lut_r[px[0] as usize] as i32;
        let g = lut_g[px[1] as usize] as i32;
        let b = lut_b[px[2] as usize] as i32;
        // 4) saturation: lerp toward Rec.601 luma. Integer weights /256 (77+150+29).
        let luma = (r * 77 + g * 150 + b * 29) >> 8;
        let mix = |c: i32| {
            // c' = luma + (c - luma) * sat (fixed-point), round-to-nearest, clamp.
            let v = luma + (((c - luma) * sat_fp) + 128) / 256;
            v.clamp(0, 255) as u8
        };
        px[0] = mix(r);
        px[1] = mix(g);
        px[2] = mix(b);
    }
}

/// The first [`Effect::BackdropBlur`] in a node's chain (frosted glass), if any.
/// Backdrop blur is handled separately from the subtree-capture effects because
/// it samples the backdrop behind the node rather than the node's own subtree.
fn backdrop_blur_of(node: &Node) -> Option<Effect> {
    node.effects
        .iter()
        .copied()
        .find(|e| matches!(e, Effect::BackdropBlur { .. }))
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

    /// Load an additional font (`.ttf`/`.otf` bytes), returning the family
    /// name(s) it provides — select them by family on a `Text`/run. A renderer
    /// with no font context gains the bundled default first, so loaded fonts
    /// always have a default to fall back to.
    pub fn load_font(&mut self, data: Vec<u8>) -> Vec<String> {
        self.fonts
            .get_or_insert_with(FontContext::with_default_font)
            .load_font(data)
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

        // A MATTE reveals this node's content only through a second subtree's
        // alpha/luminance — it replaces the node's whole draw (capture content +
        // matte, combine, composite), so it runs first and returns. (A matted node
        // ignores any co-located backdrop/subtree effects for now.)
        if let Some(matte) = &node.matte {
            self.render_matte(fb, node, matte, transform, opacity);
            return;
        }

        // Frosted glass (`Effect::BackdropBlur`) is the odd effect: it samples the
        // backdrop ALREADY in `fb` behind this node, blurs/tints it, clips it to the
        // node's region, and composites it UNDER the node's own content. So it runs
        // first, then we fall through to the normal draw (the panel's fill/stroke/
        // children paint on top of the frost). A node with backdrop blur ignores any
        // co-located subtree effects for now.
        if let Some(backdrop) = backdrop_blur_of(node) {
            self.render_backdrop_blur(fb, node, transform, opacity, backdrop);
        } else if !node.effects.is_empty() {
            // A node carrying (subtree-capture) effects renders its subtree to an
            // offscreen surface in LOCAL space, runs the effect chain (blur), then
            // composites the result back at this node's transform/opacity (CSS
            // filter semantics). This branch returns — the normal draw is skipped.
            self.render_effects_subtree(fb, node, transform, opacity);
            return;
        }

        match &node.kind {
            NodeKind::Group => {}
            NodeKind::Shape(shape) => rasterize_shape(fb, shape, transform, opacity),
            NodeKind::Text(text) => self.rasterize_text(fb, text, transform, opacity),
            // Draws the decoded pixels (attached by the onda-image pass); an
            // unresolved image (no pixels) is skipped. A Video draws its current
            // frame the same way — pixels attached by a decode pass.
            NodeKind::Image(image) => rasterize_image(
                fb,
                image.data.as_ref(),
                image.width,
                image.height,
                image.fit,
                transform,
                opacity,
            ),
            NodeKind::Video(video) => rasterize_image(
                fb,
                video.data.as_ref(),
                video.width,
                video.height,
                video.fit,
                transform,
                opacity,
            ),
            // Audio is non-visual — the player plays it; the renderer skips it.
            NodeKind::Audio(_) => {}
            // SVG nodes are expanded to shapes (onda-svg) before rendering; the
            // CPU backend can't draw paths anyway, so an unexpanded one is a no-op.
            NodeKind::Svg(_) => {}
        }

        for child in &node.children {
            self.render_node(fb, child, transform, opacity);
        }
    }

    /// Frosted glass (`Effect::BackdropBlur`): sample the backdrop already in `fb`
    /// behind `node`, blur it (and optionally adjust brightness/saturation, then
    /// lay a `tint` over it), clip it to the node's region (its `clip`, its own
    /// `Shape` geometry, or — for a bare container — its subtree bounds), and
    /// composite that frosted backdrop into `fb`. The caller then draws the node's
    /// own content on top of the frost. Uses the same deterministic
    /// [`blur_framebuffer`] / [`color_grade_framebuffer`] kernels as the other
    /// effects, and mirrors the GPU (Vello) backdrop pass.
    fn render_backdrop_blur(
        &mut self,
        fb: &mut Framebuffer,
        node: &Node,
        transform: Transform,
        opacity: f32,
        effect: Effect,
    ) {
        let Effect::BackdropBlur {
            sigma,
            tint,
            brightness,
            saturation,
        } = effect
        else {
            return;
        };
        // Nothing visible → leave `fb` untouched and let the node draw normally.
        if opacity <= 0.0
            || (sigma <= 0.0 && tint.a <= 0.0 && brightness == 1.0 && saturation == 1.0)
        {
            return;
        }

        // The frosted region, in the node's LOCAL space, plus a local offset
        // (a `clip`/own-`Shape` sits at the local origin; a bare container falls
        // back to its subtree bounds, which carry an offset from the origin).
        let (geometry, offset) = if let Some(clip) = &node.clip {
            (clip.clone(), Vec2::new(0.0, 0.0))
        } else if let NodeKind::Shape(shape) = &node.kind {
            (shape.geometry.clone(), Vec2::new(0.0, 0.0))
        } else {
            let Some((bx0, by0, bx1, by1)) = self.captured_local_bounds(node) else {
                return;
            };
            let (w, h) = (bx1 - bx0, by1 - by0);
            if !(w > 0.0 && h > 0.0) {
                return;
            }
            (
                ShapeGeometry::Rect {
                    size: Size::new(w, h),
                    corner_radius: 0.0,
                },
                Vec2::new(bx0, by0),
            )
        };

        let Some(path) = build_path(&geometry) else {
            return;
        };
        let ts = skia_transform(transform);
        // local (shifted by the region offset) → device.
        let region_xf = ts.pre_concat(tsk::Transform::from_translate(offset.x, offset.y));
        let Some(dev_path) = path.clone().transform(region_xf) else {
            return;
        };

        // Inflate the sampled region by the 3σ blur margin so the kernel reads real
        // backdrop neighbours instead of clamping to a hard edge; clamp to the fb.
        let bounds = dev_path.bounds();
        let margin = (3.0 * sigma).ceil().max(0.0);
        let x0 = (bounds.left() - margin).floor().max(0.0);
        let y0 = (bounds.top() - margin).floor().max(0.0);
        let x1 = (bounds.right() + margin).ceil().min(fb.width() as f32);
        let y1 = (bounds.bottom() + margin).ceil().min(fb.height() as f32);
        if x1 <= x0 || y1 <= y0 {
            return; // fully off-canvas
        }
        let (ox, oy) = (x0 as u32, y0 as u32);
        let (rw, rh) = ((x1 - x0) as u32, (y1 - y0) as u32);
        if rw == 0 || rh == 0 {
            return;
        }

        // Copy the backdrop out of the live framebuffer, blur + grade it.
        let mut backdrop = fb.crop(ox, oy, rw, rh);
        blur_framebuffer(&mut backdrop, sigma);
        if brightness != 1.0 || saturation != 1.0 {
            // brightness is a linear multiply → encode as exposure (2^exposure).
            let exposure = if brightness > 0.0 {
                brightness.log2()
            } else {
                f32::NEG_INFINITY
            };
            color_grade_framebuffer(&mut backdrop, exposure, 1.0, saturation, 0.0, 0.0);
        }

        // Per-pixel coverage mask for the glass shape (AA), in the cropped frame.
        let Some(mut mask) = tsk::Pixmap::new(rw, rh) else {
            return;
        };
        let into_temp = tsk::Transform::from_translate(-x0, -y0).pre_concat(region_xf);
        let mask_paint = tsk::Paint {
            shader: tsk::Shader::SolidColor(tsk::Color::WHITE),
            anti_alias: true,
            ..Default::default()
        };
        mask.fill_path(&path, &mask_paint, tsk::FillRule::Winding, into_temp, None);

        // Composite the frosted backdrop back, clipped to the shape (and tinted).
        // NOTE: the blurred crop is composited (src-over) on top of the sharp
        // backdrop still in `fb`. For an OPAQUE backdrop (the normal case — glass
        // over a filled scene) over(blurred@1, sharp@1) == blurred, so it replaces
        // exactly. Over a partially-transparent region the frost reads slightly
        // denser than the true backdrop; both backends behave identically here, and
        // proper "replace-within-mask" semantics are deferred to the matte work.
        for ty in 0..rh {
            for tx in 0..rw {
                let Some(m) = mask.pixel(tx, ty) else {
                    continue;
                };
                let cov = m.alpha();
                if cov == 0 {
                    continue;
                }
                let [r, g, b, a] = backdrop.pixel(tx, ty);
                let mut c = Color::from_rgba8(r, g, b, a);
                if tint.a > 0.0 {
                    c = over(tint, c); // lay the tint over the blurred backdrop
                }
                let final_alpha = c.a * (cov as f32 / 255.0) * opacity;
                if final_alpha <= 0.0 {
                    continue;
                }
                fb.blend(ox + tx, oy + ty, Color::new(c.r, c.g, c.b, final_alpha));
            }
        }
    }

    /// Matte (track matte / mask): reveal `node`'s content subtree only through
    /// `matte.source`'s alpha or luminance — the signature media-through-type move.
    /// Captures the content and the matte to two pixel-aligned temp framebuffers
    /// over a shared window, multiplies the content's alpha by the matte's coverage
    /// (integer Rec.601 luma for luminance mode, so it stays byte-deterministic),
    /// then composites the result at the node's transform/opacity. Mirrors the GPU
    /// `AlphaMatte` pass.
    fn render_matte(
        &mut self,
        fb: &mut Framebuffer,
        node: &Node,
        matte: &Matte,
        transform: Transform,
        opacity: f32,
    ) {
        if opacity <= 0.0 {
            return;
        }
        // Shared capture window = union of the content subtree's bounds (this node
        // at identity + children, like the effect capture) and the matte subtree's
        // bounds (the matte source through its own transform), in node-local space.
        // Both must exist — no content or an empty matte reveals nothing.
        let (Some(cb), Some(mb)) = (
            self.captured_local_bounds(node),
            self.subtree_local_bounds(&matte.source, Transform::IDENTITY),
        ) else {
            return;
        };
        let ox = cb.0.min(mb.0).floor();
        let oy = cb.1.min(mb.1).floor();
        let tw = ((cb.2.max(mb.2).ceil() - ox).max(1.0) as u32).min(MAX_MATTE_DIM);
        let th = ((cb.3.max(mb.3).ceil() - oy).max(1.0) as u32).min(MAX_MATTE_DIM);

        let into_temp = Transform {
            translate: Vec2::new(-ox, -oy),
            ..Transform::IDENTITY
        };
        // CONTENT: this node's kind + children, captured at identity in the window.
        let mut temp_c = Framebuffer::new(tw, th);
        self.draw_subtree_local(&mut temp_c, node, into_temp, 1.0);
        // MATTE: the matte source positioned by its OWN transform, into the SAME
        // window so it's pixel-aligned with the content.
        let mut temp_m = Framebuffer::new(tw, th);
        // Honor the matte source ROOT's own opacity (a faded matte reveals less),
        // matching the GPU path where `build` folds `matte.source.opacity` into the
        // matte's drawn alpha — so an animated fade-in matte agrees CPU==GPU.
        self.draw_subtree_local(
            &mut temp_m,
            &matte.source,
            into_temp.then(&matte.source.transform),
            matte.source.opacity,
        );

        // Alpha-combine: content.alpha ×= matte coverage. Coverage is the matte's
        // alpha (Alpha mode) or its Rec.601 luma × alpha (Luminance mode) — integer
        // math (the same 77/150/29 >> 8 weights the grade/bloom use), round-nearest
        // /255, so the matte is byte-identical across runs/architectures.
        let luminance = matches!(matte.mode, MatteMode::Luminance);
        for (c, m) in temp_c
            .pixels
            .chunks_exact_mut(4)
            .zip(temp_m.pixels.chunks_exact(4))
        {
            let ma = m[3] as u32;
            let cov = if luminance {
                let luma = (m[0] as u32 * 77 + m[1] as u32 * 150 + m[2] as u32 * 29) >> 8;
                (luma * ma + 127) / 255
            } else {
                ma
            };
            c[3] = ((c[3] as u32 * cov + 127) / 255) as u8;
        }

        // Composite the matted content back at the node's transform/opacity (the
        // same nearest-neighbor straight-alpha map the effect path uses).
        let sx = transform.scale.x;
        let sy = transform.scale.y;
        if sx == 0.0 || sy == 0.0 {
            return;
        }
        let c0 = transform.apply(Vec2::new(ox, oy));
        let c1 = transform.apply(Vec2::new(ox + tw as f32, oy + th as f32));
        let (cx0, cx1) = (c0.x.min(c1.x), c0.x.max(c1.x));
        let (cy0, cy1) = (c0.y.min(c1.y), c0.y.max(c1.y));
        let px_min = cx0.floor().max(0.0) as i64;
        let py_min = cy0.floor().max(0.0) as i64;
        let px_max = (cx1.ceil() as i64).min(fb.width() as i64);
        let py_max = (cy1.ceil() as i64).min(fb.height() as i64);
        for py in py_min..py_max {
            for px in px_min..px_max {
                let canvas = Vec2::new(px as f32 + 0.5, py as f32 + 0.5);
                let local_x = (canvas.x - transform.translate.x) / sx;
                let local_y = (canvas.y - transform.translate.y) / sy;
                let tx = (local_x - ox).floor();
                let ty = (local_y - oy).floor();
                if tx < 0.0 || ty < 0.0 || tx >= tw as f32 || ty >= th as f32 {
                    continue;
                }
                let [r, g, b, a] = temp_c.pixel(tx as u32, ty as u32);
                if a == 0 {
                    continue;
                }
                let color = Color::new(
                    r as f32 / 255.0,
                    g as f32 / 255.0,
                    b as f32 / 255.0,
                    (a as f32 / 255.0) * opacity,
                );
                fb.blend(px as u32, py as u32, color);
            }
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
        // Rich runs render per-run color/size on the GPU (Vello) backend; the CPU
        // reference draws their concatenated text in the node's color/size.
        // `letter_spacing` is likewise GPU-only for now — this coverage path
        // rasterizes the whole string in one pass (no per-glyph offset). Applying
        // it here means a per-glyph rasterize; the export/preview path is Vello.
        let content = if text.runs.is_empty() {
            text.content.clone()
        } else {
            text.runs
                .iter()
                .map(|r| r.text.as_str())
                .collect::<String>()
        };
        let Some(raster) = fonts.rasterize_with(
            &content,
            text.font_size,
            text.font_family.as_deref(),
            text.weight.unwrap_or(400),
            text.italic.unwrap_or(false),
        ) else {
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

    /// Render a node's subtree into a temp framebuffer in LOCAL space, run its
    /// effect chain, then composite the result back into `fb` at `transform`
    /// (translate+scale; rotation dropped per the CPU contract) with `opacity`.
    ///
    /// `transform`/`opacity` are this node's *composed* (parent-inherited) values;
    /// the subtree is captured at identity/full-opacity so the effect operates on
    /// clean pixels (CSS filter semantics: blur first, opacity at composite-back).
    fn render_effects_subtree(
        &mut self,
        fb: &mut Framebuffer,
        node: &Node,
        transform: Transform,
        opacity: f32,
    ) {
        // Local-space bounds of the subtree, inflated by the effect margin (the
        // largest 3σ across the chain) so the blur has room to spread; fall back to
        // the framebuffer size when nothing is bounded.
        let margin = node
            .effects
            .iter()
            .map(|e| match e {
                Effect::Blur { sigma } => (3.0 * sigma.max(0.0)).ceil(),
                // Bloom blurs its bright-pass with `sigma`; the halo needs the same
                // 3σ headroom around the subtree so the glow isn't clipped.
                Effect::Bloom { sigma, .. } => (3.0 * sigma.max(0.0)).ceil(),
                // ColorGrade is a per-pixel remap (no spread) — it needs no margin.
                Effect::ColorGrade { .. } => 0.0,
                // Goo blurs the subtree with `sigma` before thresholding; it needs
                // the same 3σ headroom so the spread (and the fused neck) isn't
                // clipped at the capture edge.
                Effect::Goo { sigma, .. } => (3.0 * sigma.max(0.0)).ceil(),
                // BackdropBlur is handled before this subtree path (it samples the
                // backdrop, not the subtree), so it contributes no capture margin.
                Effect::BackdropBlur { .. } => 0.0,
            })
            .fold(0.0f32, f32::max);
        let bounds = self.captured_local_bounds(node);
        let (lx0, ly0, lx1, ly1) = match bounds {
            Some(b) => (b.0 - margin, b.1 - margin, b.2 + margin, b.3 + margin),
            // Unbounded (e.g. text without fonts) — capture the whole composition.
            None => (0.0, 0.0, fb.width() as f32, fb.height() as f32),
        };
        let ox = lx0.floor();
        let oy = ly0.floor();
        let tw = (lx1.ceil() - ox).max(1.0) as u32;
        let th = (ly1.ceil() - oy).max(1.0) as u32;
        // Guard against pathological sizes (e.g. a huge unbounded fallback already
        // matches the framebuffer; this just bounds memory for runaway inputs).
        if tw == 0 || th == 0 {
            return;
        }

        // Capture the subtree at identity, shifted so local point (ox, oy) lands at
        // the temp origin. Children draw via their own transforms; the node's own
        // composed transform is applied only at composite-back.
        let mut temp = Framebuffer::new(tw, th);
        let into_temp = Transform {
            translate: Vec2::new(-ox, -oy),
            ..Transform::IDENTITY
        };
        self.draw_subtree_local(&mut temp, node, into_temp, 1.0);

        // Run the effect chain on the captured surface.
        for effect in &node.effects {
            match effect {
                Effect::Blur { sigma } => blur_framebuffer(&mut temp, *sigma),
                Effect::Bloom {
                    threshold,
                    intensity,
                    sigma,
                } => bloom_framebuffer(&mut temp, *threshold, *intensity, *sigma),
                Effect::ColorGrade {
                    exposure,
                    contrast,
                    saturation,
                    temperature,
                    tint,
                } => color_grade_framebuffer(
                    &mut temp,
                    *exposure,
                    *contrast,
                    *saturation,
                    *temperature,
                    *tint,
                ),
                Effect::Goo { sigma, threshold } => goo_framebuffer(&mut temp, *sigma, *threshold),
                // Handled in `render_backdrop_blur` (samples the backdrop, not this
                // captured subtree) — a no-op within the subtree chain.
                Effect::BackdropBlur { .. } => {}
            }
        }

        // Composite the temp back at the node's transform/opacity. Each temp pixel
        // (tx, ty) is local point (ox + tx, oy + ty); map it through `transform`
        // (translate + scale) to a canvas box and blit nearest-neighbor, the same
        // straight-alpha src-over loop shapes use. Rotation is dropped (CPU
        // contract). `transform.apply` folds scale-about-origin into translate.
        let sx = transform.scale.x;
        let sy = transform.scale.y;
        // Skip degenerate scales (would map the whole surface to nothing).
        if sx == 0.0 || sy == 0.0 {
            return;
        }
        // Destination canvas box of the temp surface.
        let c0 = transform.apply(Vec2::new(ox, oy));
        let c1 = transform.apply(Vec2::new(ox + tw as f32, oy + th as f32));
        let (cx0, cx1) = (c0.x.min(c1.x), c0.x.max(c1.x));
        let (cy0, cy1) = (c0.y.min(c1.y), c0.y.max(c1.y));
        let px_min = cx0.floor().max(0.0) as i64;
        let py_min = cy0.floor().max(0.0) as i64;
        let px_max = (cx1.ceil() as i64).min(fb.width() as i64);
        let py_max = (cy1.ceil() as i64).min(fb.height() as i64);

        for py in py_min..py_max {
            for px in px_min..px_max {
                // Map this canvas pixel center back into the temp surface.
                let canvas = Vec2::new(px as f32 + 0.5, py as f32 + 0.5);
                let local_x = (canvas.x - transform.translate.x) / sx;
                let local_y = (canvas.y - transform.translate.y) / sy;
                let tx = (local_x - ox).floor();
                let ty = (local_y - oy).floor();
                if tx < 0.0 || ty < 0.0 || tx >= tw as f32 || ty >= th as f32 {
                    continue;
                }
                let [r, g, b, a] = temp.pixel(tx as u32, ty as u32);
                if a == 0 {
                    continue;
                }
                let color = Color::new(
                    r as f32 / 255.0,
                    g as f32 / 255.0,
                    b as f32 / 255.0,
                    (a as f32 / 255.0) * opacity,
                );
                fb.blend(px as u32, py as u32, color);
            }
        }
    }

    /// Draw `node`'s own kind plus its children into `fb` at `parent` (no effect
    /// handling — the effect-carrying node was already captured at identity by its
    /// parent's [`Self::render_effects_subtree`]). Mirrors [`Self::render_node`]'s
    /// draw arm but never re-enters the effects branch (avoiding self-recursion);
    /// nested effects deeper in the subtree are still honored.
    fn draw_subtree_local(
        &mut self,
        fb: &mut Framebuffer,
        node: &Node,
        transform: Transform,
        opacity: f32,
    ) {
        match &node.kind {
            NodeKind::Group => {}
            NodeKind::Shape(shape) => rasterize_shape(fb, shape, transform, opacity),
            NodeKind::Text(text) => self.rasterize_text(fb, text, transform, opacity),
            NodeKind::Image(image) => rasterize_image(
                fb,
                image.data.as_ref(),
                image.width,
                image.height,
                image.fit,
                transform,
                opacity,
            ),
            NodeKind::Video(video) => rasterize_image(
                fb,
                video.data.as_ref(),
                video.width,
                video.height,
                video.fit,
                transform,
                opacity,
            ),
            NodeKind::Audio(_) | NodeKind::Svg(_) => {}
        }
        // Children render through the normal path so nested effects still apply.
        for child in &node.children {
            let child_t = transform.then(&child.transform);
            let child_o = opacity * child.opacity;
            if child.effects.is_empty() {
                self.draw_subtree_local(fb, child, child_t, child_o);
            } else {
                self.render_effects_subtree(fb, child, child_t, child_o);
            }
        }
    }

    /// Union of the subtree's drawable bounds in the space defined by `parent`
    /// (for the top-level call, `parent = IDENTITY`, i.e. the node's local space).
    /// Returns `(x0, y0, x1, y1)` or `None` when nothing in the subtree has a
    /// determinable box (e.g. text with no font context). Generalizes the
    /// per-shape transformed-bounds logic over the whole subtree.
    fn subtree_local_bounds(
        &mut self,
        node: &Node,
        parent: Transform,
    ) -> Option<(f32, f32, f32, f32)> {
        let transform = parent.then(&node.transform);
        let mut acc: Option<(f32, f32, f32, f32)> = None;
        let mut push = |x0: f32, y0: f32, x1: f32, y1: f32| {
            acc = Some(match acc {
                Some((ax0, ay0, ax1, ay1)) => (ax0.min(x0), ay0.min(y0), ax1.max(x1), ay1.max(y1)),
                None => (x0, y0, x1, y1),
            });
        };

        // Local box of this node's own kind, mapped through `transform`.
        if let Some((w, h)) = node_local_size(node) {
            // Inflate a shape's box by half its (scaled) stroke width + 1px AA, the
            // same fringe rasterize_shape uses, so the blur capture never clips it.
            let stroke_inflate = match &node.kind {
                NodeKind::Shape(s) => {
                    let max_scale = transform.scale.x.abs().max(transform.scale.y.abs());
                    s.stroke.as_ref().map_or(0.0, |st| st.width.max(0.0)) * max_scale * 0.5 + 1.0
                }
                _ => 0.0,
            };
            let a = transform.apply(Vec2::new(0.0, 0.0));
            let b = transform.apply(Vec2::new(w, h));
            push(
                a.x.min(b.x) - stroke_inflate,
                a.y.min(b.y) - stroke_inflate,
                a.x.max(b.x) + stroke_inflate,
                a.y.max(b.y) + stroke_inflate,
            );
        } else if let NodeKind::Text(text) = &node.kind {
            // Text has no intrinsic box; rasterize to recover its inked bounds (the
            // same raster the draw uses), placed at the node's translation.
            if let Some(b) = self.text_local_bounds(text, transform) {
                push(b.0, b.1, b.2, b.3);
            }
        }

        for child in &node.children {
            if let Some((x0, y0, x1, y1)) = self.subtree_local_bounds(child, transform) {
                push(x0, y0, x1, y1);
            }
        }
        acc
    }

    /// Local-space bounds of an effect node's CAPTURED subtree — exactly what
    /// [`Self::draw_subtree_local`] draws: the effect node's own kind at IDENTITY
    /// (its own transform is applied only at composite-back, NOT inside the
    /// capture) and each child through its own transform. This must mirror the
    /// draw, or the node's transform is double-counted (once in the bounds window,
    /// once at composite-back), which mis-places / clips the captured subtree.
    /// Matches the GPU path, which contributes the effect node at identity.
    fn captured_local_bounds(&mut self, node: &Node) -> Option<(f32, f32, f32, f32)> {
        let mut acc: Option<(f32, f32, f32, f32)> = None;
        let mut push = |x0: f32, y0: f32, x1: f32, y1: f32| {
            acc = Some(match acc {
                Some((ax0, ay0, ax1, ay1)) => (ax0.min(x0), ay0.min(y0), ax1.max(x1), ay1.max(y1)),
                None => (x0, y0, x1, y1),
            });
        };

        // The effect node's own kind at IDENTITY (scale 1 → the AA/stroke fringe
        // matches a capture at native resolution; the node's real transform applies
        // at composite-back).
        if let Some((w, h)) = node_local_size(node) {
            let stroke_inflate = match &node.kind {
                NodeKind::Shape(s) => {
                    s.stroke.as_ref().map_or(0.0, |st| st.width.max(0.0)) * 0.5 + 1.0
                }
                _ => 0.0,
            };
            push(
                -stroke_inflate,
                -stroke_inflate,
                w + stroke_inflate,
                h + stroke_inflate,
            );
        } else if let NodeKind::Text(text) = &node.kind {
            if let Some(b) = self.text_local_bounds(text, Transform::IDENTITY) {
                push(b.0, b.1, b.2, b.3);
            }
        }

        // Children through their OWN transforms (subtree_local_bounds applies
        // child.transform when called with an IDENTITY parent).
        for child in &node.children {
            if let Some((x0, y0, x1, y1)) = self.subtree_local_bounds(child, Transform::IDENTITY) {
                push(x0, y0, x1, y1);
            }
        }
        acc
    }

    /// Inked bounds of a text node in `transform`'s space, recovered by
    /// rasterizing it (the same coverage mask the draw path produces). `None`
    /// without a font context or for empty text.
    fn text_local_bounds(
        &mut self,
        text: &Text,
        transform: Transform,
    ) -> Option<(f32, f32, f32, f32)> {
        let fonts = self.fonts.as_mut()?;
        let content = if text.runs.is_empty() {
            text.content.clone()
        } else {
            text.runs
                .iter()
                .map(|r| r.text.as_str())
                .collect::<String>()
        };
        let raster = fonts.rasterize_with(
            &content,
            text.font_size,
            text.font_family.as_deref(),
            text.weight.unwrap_or(400),
            text.italic.unwrap_or(false),
        )?;
        // Draw places the raster at round(translate) + raster offsets; mirror that.
        let origin_x = transform.translate.x.round();
        let origin_y = transform.translate.y.round();
        let x0 = origin_x + raster.offset_x as f32;
        let y0 = origin_y + raster.offset_y as f32;
        Some((x0, y0, x0 + raster.width as f32, y0 + raster.height as f32))
    }
}

/// The local-space `(width, height)` box of a node's own kind, or `None` when it
/// has no intrinsic box (group, text, audio, unexpanded svg). Shapes report their
/// geometry size; images/videos their layout box (falling back to decoded pixel
/// size). Used by the subtree-bounds walk to size the blur capture.
fn node_local_size(node: &Node) -> Option<(f32, f32)> {
    match &node.kind {
        NodeKind::Shape(shape) => match &shape.geometry {
            ShapeGeometry::Rect { size, .. } | ShapeGeometry::Ellipse { size } => {
                Some((size.width, size.height))
            }
            // SVG path data: bound it via kurbo's bounding box (local space).
            ShapeGeometry::Path { data } => {
                let bez = BezPath::from_svg(data).ok()?;
                let bb = bez.bounding_box();
                Some((bb.x1 as f32, bb.y1 as f32))
            }
        },
        NodeKind::Image(image) => image_box(image.data.as_ref(), image.width, image.height),
        NodeKind::Video(video) => image_box(video.data.as_ref(), video.width, video.height),
        _ => None,
    }
}

/// The layout box of an image/video: its explicit `width`×`height` box, else its
/// decoded pixel size, else `None` (unresolved — nothing to bound).
fn image_box(
    data: Option<&ImageData>,
    box_w: Option<f32>,
    box_h: Option<f32>,
) -> Option<(f32, f32)> {
    match (box_w, box_h) {
        (Some(w), Some(h)) if w > 0.0 && h > 0.0 => Some((w, h)),
        _ => {
            let d = data?;
            (d.width > 0 && d.height > 0).then_some((d.width as f32, d.height as f32))
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

/// onda `Color` (straight-alpha, 0..1) → tiny-skia color.
fn skia_color(c: Color) -> tsk::Color {
    tsk::Color::from_rgba(
        c.r.clamp(0.0, 1.0),
        c.g.clamp(0.0, 1.0),
        c.b.clamp(0.0, 1.0),
        c.a.clamp(0.0, 1.0),
    )
    .unwrap_or(tsk::Color::TRANSPARENT)
}

/// Composed onda transform → tiny-skia. Translate + scale only: `Transform::then`
/// drops rotation, so the CPU path never carries it (Vello rotates on the GPU).
fn skia_transform(t: Transform) -> tsk::Transform {
    tsk::Transform::from_row(t.scale.x, 0.0, 0.0, t.scale.y, t.translate.x, t.translate.y)
}

/// A kurbo Bézier path → tiny-skia path (used for rounded rects + SVG path data).
fn kurbo_to_skia(bez: &BezPath) -> Option<tsk::Path> {
    let mut pb = tsk::PathBuilder::new();
    for el in bez.elements() {
        match el {
            PathEl::MoveTo(p) => pb.move_to(p.x as f32, p.y as f32),
            PathEl::LineTo(p) => pb.line_to(p.x as f32, p.y as f32),
            PathEl::QuadTo(c, p) => pb.quad_to(c.x as f32, c.y as f32, p.x as f32, p.y as f32),
            PathEl::CurveTo(a, b, p) => pb.cubic_to(
                a.x as f32, a.y as f32, b.x as f32, b.y as f32, p.x as f32, p.y as f32,
            ),
            PathEl::ClosePath => pb.close(),
        }
    }
    pb.finish()
}

/// Build the tiny-skia path for a geometry, in the shape's LOCAL space (origin
/// top-left). Rounded rects + SVG paths route through kurbo; plain rects/ellipses
/// use tiny-skia builders directly.
fn build_path(geometry: &ShapeGeometry) -> Option<tsk::Path> {
    match geometry {
        ShapeGeometry::Rect {
            size,
            corner_radius,
        } => {
            let (w, h) = (size.width, size.height);
            if !(w > 0.0 && h > 0.0) {
                return None;
            }
            // Below half the shorter side, with a 2px margin: at the exact
            // stadium boundary the rounded-rect path degenerates (zero-length
            // straight edges) and a stroke leaves a stray line — keep a hair of
            // straight edge so every pill stays well-formed (matches vello-rs).
            let r = corner_radius.clamp(0.0, (w.min(h) / 2.0 - 2.0).max(0.0));
            if r <= 0.0 {
                let mut pb = tsk::PathBuilder::new();
                pb.push_rect(tsk::Rect::from_xywh(0.0, 0.0, w, h)?);
                pb.finish()
            } else {
                let rr = kurbo::RoundedRect::new(0.0, 0.0, w as f64, h as f64, r as f64);
                kurbo_to_skia(&rr.to_path(0.1))
            }
        }
        ShapeGeometry::Ellipse { size } => {
            let (w, h) = (size.width, size.height);
            if !(w > 0.0 && h > 0.0) {
                return None;
            }
            let mut pb = tsk::PathBuilder::new();
            pb.push_oval(tsk::Rect::from_xywh(0.0, 0.0, w, h)?);
            pb.finish()
        }
        // Arbitrary SVG path data, parsed by kurbo (handles abs/rel + arcs).
        ShapeGeometry::Path { data } => kurbo_to_skia(&BezPath::from_svg(data).ok()?),
    }
}

/// A gradient → tiny-skia shader. The gradient's points are in the shape's LOCAL
/// space; the shader transform is identity because `fill_path`'s transform (the
/// canvas matrix) already maps both the path AND the shader local→device — the
/// analog of Vello filling with `brush_transform: None`.
fn gradient_shader(gradient: &Gradient) -> Option<tsk::Shader<'static>> {
    let to_stops = |stops: &[GradientStop]| -> Vec<tsk::GradientStop> {
        stops
            .iter()
            .map(|s| tsk::GradientStop::new(s.offset, skia_color(s.color)))
            .collect()
    };
    match gradient {
        Gradient::Linear { start, end, stops } => tsk::LinearGradient::new(
            tsk::Point::from_xy(start.x, start.y),
            tsk::Point::from_xy(end.x, end.y),
            to_stops(stops),
            tsk::SpreadMode::Pad,
            tsk::Transform::identity(),
        ),
        Gradient::Radial {
            center,
            radius,
            stops,
        } => tsk::RadialGradient::new(
            tsk::Point::from_xy(center.x, center.y),
            tsk::Point::from_xy(center.x, center.y),
            *radius,
            to_stops(stops),
            tsk::SpreadMode::Pad,
            tsk::Transform::identity(),
        ),
    }
}

/// Rasterize a shape via tiny-skia (the Skia raster pipeline behind resvg):
/// anti-aliased fills, linear/radial gradients, strokes, rounded rects and SVG
/// paths. The shape is drawn into a temporary pixmap sized to its transformed
/// bounds, then composited (straight-alpha src-over, `opacity` folded in) into
/// the framebuffer — so text/image compositing is unchanged.
fn rasterize_shape(fb: &mut Framebuffer, shape: &Shape, transform: Transform, opacity: f32) {
    if opacity <= 0.0
        || (shape.fill.is_none() && shape.gradient.is_none() && shape.stroke.is_none())
    {
        return;
    }
    let Some(path) = build_path(&shape.geometry) else {
        return; // empty/invalid geometry, or unparseable path data
    };
    let ts = skia_transform(transform); // local → canvas
    let Some(dev_path) = path.clone().transform(ts) else {
        return;
    };

    // Canvas bounds of the transformed path, inflated by half the (scaled) stroke
    // width plus 1px for the AA fringe, then clamped to the framebuffer.
    let bounds = dev_path.bounds();
    let max_scale = transform.scale.x.abs().max(transform.scale.y.abs());
    let inflate = shape.stroke.as_ref().map_or(0.0, |s| s.width.max(0.0)) * max_scale * 0.5 + 1.0;
    let x0 = (bounds.left() - inflate).floor().max(0.0);
    let y0 = (bounds.top() - inflate).floor().max(0.0);
    let x1 = (bounds.right() + inflate).ceil().min(fb.width() as f32);
    let y1 = (bounds.bottom() + inflate).ceil().min(fb.height() as f32);
    if x1 <= x0 || y1 <= y0 {
        return; // fully off-canvas
    }
    let (ox, oy) = (x0 as u32, y0 as u32);
    let (pw, ph) = ((x1 - x0) as u32, (y1 - y0) as u32);
    if pw == 0 || ph == 0 {
        return;
    }
    let Some(mut pixmap) = tsk::Pixmap::new(pw, ph) else {
        return;
    };
    // local → temp-pixmap space (canvas, shifted by the pixmap's origin).
    let into_temp = tsk::Transform::from_translate(-x0, -y0).pre_concat(ts);

    // Fill (gradient wins over solid, matching the scene contract).
    if shape.gradient.is_some() || shape.fill.is_some() {
        let shader = match &shape.gradient {
            Some(g) => gradient_shader(g),
            None => shape.fill.map(|c| tsk::Shader::SolidColor(skia_color(c))),
        };
        if let Some(shader) = shader {
            let paint = tsk::Paint {
                shader,
                anti_alias: true,
                ..Default::default()
            };
            pixmap.fill_path(&path, &paint, tsk::FillRule::Winding, into_temp, None);
        }
    }
    // Stroke (color + width + cap/join/dash).
    if let Some(stroke) = &shape.stroke {
        if stroke.width > 0.0 && stroke.color.a > 0.0 {
            let paint = tsk::Paint {
                shader: tsk::Shader::SolidColor(skia_color(stroke.color)),
                anti_alias: true,
                ..Default::default()
            };
            let sk_stroke = tsk::Stroke {
                width: stroke.width,
                line_cap: match stroke.cap {
                    LineCap::Butt => tsk::LineCap::Butt,
                    LineCap::Round => tsk::LineCap::Round,
                    LineCap::Square => tsk::LineCap::Square,
                },
                line_join: match stroke.join {
                    LineJoin::Miter => tsk::LineJoin::Miter,
                    LineJoin::Round => tsk::LineJoin::Round,
                    LineJoin::Bevel => tsk::LineJoin::Bevel,
                },
                dash: (!stroke.dash.is_empty())
                    .then(|| tsk::StrokeDash::new(stroke.dash.clone(), stroke.dash_offset))
                    .flatten(),
                ..Default::default()
            };
            pixmap.stroke_path(&path, &paint, &sk_stroke, into_temp, None);
        }
    }

    // Composite the temp pixmap (premultiplied) into the framebuffer (straight),
    // folding node opacity into each pixel's alpha.
    for ty in 0..ph {
        for tx in 0..pw {
            let Some(p) = pixmap.pixel(tx, ty) else {
                continue;
            };
            if p.alpha() == 0 {
                continue;
            }
            let c = p.demultiply();
            let color = Color::new(
                c.red() as f32 / 255.0,
                c.green() as f32 / 255.0,
                c.blue() as f32 / 255.0,
                (c.alpha() as f32 / 255.0) * opacity,
            );
            fb.blend(ox + tx, oy + ty, color);
        }
    }
}

/// Blit a decoded [`Image`] into the framebuffer. The image's box (its
/// `width`×`height` if set, else its natural pixel size) is mapped through
/// `transform` to an axis-aligned canvas box (translate + scale; no rotation);
/// each destination pixel samples the source per [`Image::fit`] (cover/contain/
/// fill), nearest-neighbor, composited straight-alpha with `opacity` folded in.
/// Rasterize decoded RGBA pixels into the optional `box_width`×`box_height` box
/// per `fit` — shared by Image and Video nodes (a video frame is just an image).
fn rasterize_image(
    fb: &mut Framebuffer,
    data: Option<&ImageData>,
    box_width: Option<f32>,
    box_height: Option<f32>,
    fit: ImageFit,
    transform: Transform,
    opacity: f32,
) {
    let Some(data) = data else {
        return; // unresolved (no pixels) — nothing to draw
    };
    if data.width == 0 || data.height == 0 || opacity <= 0.0 {
        return;
    }

    let (iw, ih) = (data.width as f32, data.height as f32);
    // The layout box the image fills (default: its intrinsic size).
    let (box_w, box_h) = match (box_width, box_height) {
        (Some(w), Some(h)) if w > 0.0 && h > 0.0 => (w, h),
        _ => (iw, ih),
    };
    // Source→box scale per fit mode, plus the centering offset of the scaled
    // image within the box (negative for cover, which overflows + crops).
    let (fsx, fsy) = match fit {
        ImageFit::Fill => (box_w / iw, box_h / ih),
        ImageFit::Cover => {
            let s = (box_w / iw).max(box_h / ih);
            (s, s)
        }
        ImageFit::Contain => {
            let s = (box_w / iw).min(box_h / ih);
            (s, s)
        }
    };
    let off_x = (box_w - iw * fsx) / 2.0;
    let off_y = (box_h - ih * fsy) / 2.0;

    // Destination box = the layout box mapped through the transform.
    let a = transform.apply(Vec2::ZERO);
    let b = transform.apply(Vec2::new(box_w, box_h));
    let (x0, x1) = (a.x.min(b.x), a.x.max(b.x));
    let (y0, y1) = (a.y.min(b.y), a.y.max(b.y));
    let (bw, bh) = ((x1 - x0).max(f32::EPSILON), (y1 - y0).max(f32::EPSILON));

    let px_min = x0.floor().max(0.0) as u32;
    let py_min = y0.floor().max(0.0) as u32;
    let px_max = (x1.ceil() as i64).clamp(0, fb.width() as i64) as u32;
    let py_max = (y1.ceil() as i64).clamp(0, fb.height() as i64) as u32;

    for py in py_min..py_max {
        for px in px_min..px_max {
            let (sx, sy) = (px as f32 + 0.5, py as f32 + 0.5);
            if sx < x0 || sx >= x1 || sy < y0 || sy >= y1 {
                continue;
            }
            // Map the destination pixel back into box space, then into the source
            // via the fit scale/offset. Samples outside the source (contain's
            // letterbox) are skipped → the backing shows through.
            let u = (sx - x0) / bw * box_w;
            let v = (sy - y0) / bh * box_h;
            let src_x = (u - off_x) / fsx;
            let src_y = (v - off_y) / fsy;
            if src_x < 0.0 || src_x >= iw || src_y < 0.0 || src_y >= ih {
                continue;
            }
            let ix = (src_x as i64).clamp(0, data.width as i64 - 1);
            let iy = (src_y as i64).clamp(0, data.height as i64 - 1);
            let i = (iy as usize * data.width as usize + ix as usize) * 4;
            let Some(texel) = data.rgba.get(i..i + 4) else {
                continue;
            };
            let src = Color::new(
                texel[0] as f32 / 255.0,
                texel[1] as f32 / 255.0,
                texel[2] as f32 / 255.0,
                texel[3] as f32 / 255.0,
            );
            let src = src.with_alpha(src.a * opacity);
            if src.a > 0.0 {
                fb.blend(px, py, src);
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
    fn crop_extracts_subrect_and_clamps_to_bounds() {
        // 4×4 where the red channel encodes x*10 + y, so each pixel is identifiable.
        let mut bytes = vec![0u8; 4 * 4 * 4];
        for y in 0..4u32 {
            for x in 0..4u32 {
                let i = ((y * 4 + x) * 4) as usize;
                bytes[i] = (x * 10 + y) as u8;
                bytes[i + 3] = 255;
            }
        }
        let fb = Framebuffer::from_rgba(4, 4, bytes);

        let c = fb.crop(1, 1, 2, 2);
        assert_eq!((c.width(), c.height()), (2, 2));
        assert_eq!(c.pixel(0, 0), [11, 0, 0, 255]); // src (1,1)
        assert_eq!(c.pixel(1, 0), [21, 0, 0, 255]); // src (2,1)
        assert_eq!(c.pixel(1, 1), [22, 0, 0, 255]); // src (2,2)

        // A region running past the edge is clamped to what exists.
        let c2 = fb.crop(3, 3, 10, 10);
        assert_eq!((c2.width(), c2.height()), (1, 1));
        assert_eq!(c2.pixel(0, 0), [33, 0, 0, 255]); // src (3,3)
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
                ..Transform::IDENTITY
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
                ..Transform::IDENTITY
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
                    ..Transform::IDENTITY
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
                ..Transform::IDENTITY
            });
        let root = Node::group()
            .with_transform(Transform {
                translate: Vec2::new(3.0, 0.0),
                scale: Vec2::splat(1.0),
                ..Transform::IDENTITY
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
            ..Transform::IDENTITY
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

    #[test]
    fn image_cover_fills_the_box_and_contain_letterboxes() {
        use onda_scene::{Image, ImageData, ImageFit};
        use std::sync::Arc;
        // A 2×1 source (left red, right blue) into a 4×4 box — aspect mismatch.
        let data = ImageData {
            width: 2,
            height: 1,
            rgba: Arc::new(vec![255, 0, 0, 255, 0, 0, 255, 255]),
        };
        let img = |fit: ImageFit| {
            Node::new(NodeKind::Image(
                Image::new("x")
                    .with_data(data.clone())
                    .with_box(4.0, 4.0, fit),
            ))
        };

        // Cover overflows + crops, so every pixel of the box is opaque (no gaps).
        let fb = render(
            &Scene::new(comp(4, 4)).with_root(Node::group().with_child(img(ImageFit::Cover))),
        );
        for y in 0..4 {
            for x in 0..4 {
                assert_eq!(fb.pixel(x, y)[3], 255, "cover should fill ({x},{y})");
            }
        }

        // Contain centers a 4×2 image, so the top and bottom rows letterbox.
        let fb = render(
            &Scene::new(comp(4, 4)).with_root(Node::group().with_child(img(ImageFit::Contain))),
        );
        assert_eq!(fb.pixel(0, 0)[3], 0, "contain should letterbox the top row");
        assert_eq!(
            fb.pixel(0, 3)[3],
            0,
            "contain should letterbox the bottom row"
        );
        assert!(
            (0..4).all(|x| fb.pixel(x, 1)[3] == 255),
            "contain fills the middle band"
        );
    }

    use onda_scene::Effect;

    fn blurred_scene() -> Scene {
        // A shape + a text node under a blurred group — exercises both raster paths
        // through the effect capture/composite seam.
        Scene::new(comp(120, 80)).with_root(
            Node::group().with_child(
                Node::group()
                    .with_effect(Effect::Blur { sigma: 5.0 })
                    .with_transform(translate(20.0, 15.0))
                    .with_children([
                        Node::shape(Shape::rect(Size::new(60.0, 40.0)).with_fill(Color::WHITE)),
                        Node::text("Hi").with_transform(translate(10.0, 30.0)),
                    ]),
            ),
        )
    }

    #[test]
    fn blur_is_deterministic() {
        // Two independent renders of the same blurred scene must be byte-identical
        // (the integer-quantized kernel + u32 accumulation guarantee it).
        let a = Renderer::with_default_font().render(&blurred_scene());
        let b = Renderer::with_default_font().render(&blurred_scene());
        assert_eq!(
            a.as_bytes(),
            b.as_bytes(),
            "blur render must be reproducible"
        );
        // Sanity: the blur actually drew something (not an empty/no-op surface).
        assert!(inked_pixels(&a) > 0, "blurred subtree should ink pixels");
    }

    #[test]
    fn blur_framebuffer_is_a_noop_for_zero_sigma() {
        let mut fb = Framebuffer::filled(8, 8, Color::rgb(1.0, 0.0, 0.0));
        let before = fb.as_bytes().to_vec();
        blur_framebuffer(&mut fb, 0.0);
        assert_eq!(fb.as_bytes(), before.as_slice());
    }

    #[test]
    fn blur_kernel_sums_to_fixed_total_and_is_symmetric() {
        for &sigma in &[0.5f32, 1.0, 3.0, 6.0, 12.5] {
            let (radius, weights) = blur_kernel(sigma);
            assert_eq!(weights.len(), 2 * radius + 1);
            assert_eq!(
                weights.iter().sum::<u32>(),
                BLUR_WEIGHT_TOTAL,
                "kernel for sigma={sigma} must sum to the fixed total"
            );
            // The remainder is folded into the center, so the kernel stays
            // mirror-symmetric on the taps either side of it.
            for k in 0..radius {
                assert_eq!(
                    weights[k],
                    weights[2 * radius - k],
                    "kernel for sigma={sigma} must be symmetric"
                );
            }
        }
    }

    #[test]
    fn blur_spreads_a_single_inked_block_outward() {
        // A small opaque square on a transparent field: after blur, pixels just
        // outside the original square gain partial alpha (the spread), proving the
        // kernel convolves rather than copies.
        let mut fb = Framebuffer::new(32, 32);
        for y in 12..20 {
            for x in 12..20 {
                fb.blend(x, y, Color::rgb(1.0, 1.0, 1.0));
            }
        }
        blur_framebuffer(&mut fb, 3.0);
        // A pixel two px outside the square edge should now be partly inked.
        let outside = fb.pixel(10, 16)[3];
        assert!(outside > 0, "blur should spread alpha outside the source");
        // The center stays the most opaque region.
        assert!(fb.pixel(16, 16)[3] >= outside);
    }

    #[test]
    fn bloom_framebuffer_is_deterministic() {
        // Bloom is integer/fixed-point throughout, so two independent runs over the
        // same input must be byte-identical (the determinism contract bloom shares
        // with blur).
        let base = || {
            let mut fb = Framebuffer::new(32, 32);
            for y in 12..20 {
                for x in 12..20 {
                    fb.blend(x, y, Color::rgb(1.0, 0.9, 0.2)); // a bright square
                }
            }
            fb
        };
        let mut a = base();
        let mut b = base();
        bloom_framebuffer(&mut a, 0.3, 1.5, 4.0);
        bloom_framebuffer(&mut b, 0.3, 1.5, 4.0);
        assert_eq!(a.as_bytes(), b.as_bytes(), "bloom must be reproducible");
    }

    #[test]
    fn bloom_is_a_noop_for_zero_sigma_or_intensity() {
        let make = || Framebuffer::filled(8, 8, Color::rgb(1.0, 1.0, 1.0));
        let mut fb = make();
        bloom_framebuffer(&mut fb, 0.1, 1.5, 0.0); // no spread
        assert_eq!(fb.as_bytes(), make().as_bytes());
        let mut fb = make();
        bloom_framebuffer(&mut fb, 0.1, 0.0, 5.0); // no intensity
        assert_eq!(fb.as_bytes(), make().as_bytes());
    }

    #[test]
    fn bloom_spreads_a_halo_and_brightens_bright_pixels() {
        // A bright square on a dark (opaque) field: after bloom, the dark area just
        // outside the square gains light (the additive halo), and the dark stays
        // strictly darker than the bright core.
        let mut fb = Framebuffer::filled(40, 40, Color::rgb(0.02, 0.02, 0.03));
        for y in 16..24 {
            for x in 16..24 {
                fb.blend(x, y, Color::rgb(1.0, 0.95, 0.3)); // a bright accent
            }
        }
        let dark_before = fb.pixel(8, 20)[0];
        bloom_framebuffer(&mut fb, 0.3, 1.4, 4.0);
        let dark_after = fb.pixel(8, 20)[0];
        // Far-from-square dark pixel still picks up some glow (halo spread).
        assert!(
            fb.pixel(11, 20)[0] > dark_before,
            "bloom should add light around the highlight"
        );
        // The remote dark pixel didn't go *below* its original (additive only).
        assert!(dark_after >= dark_before);
        // The bright core stays brighter than the surrounding dark.
        assert!(fb.pixel(20, 20)[0] > fb.pixel(8, 20)[0]);
    }

    #[test]
    fn bloom_skips_below_threshold_pixels() {
        // A dim square below the threshold contributes no halo: a high cutoff means
        // nothing passes the bright-pass, so bloom is a visual no-op here.
        let mut dim = Framebuffer::filled(24, 24, Color::rgb(0.0, 0.0, 0.0));
        for y in 8..16 {
            for x in 8..16 {
                dim.blend(x, y, Color::rgb(0.1, 0.1, 0.1)); // luminance ~26/255
            }
        }
        let before = dim.as_bytes().to_vec();
        bloom_framebuffer(&mut dim, 0.5, 1.5, 4.0); // cutoff ~128 → nothing passes
        assert_eq!(
            dim.as_bytes(),
            before.as_slice(),
            "below-threshold pixels should not bloom"
        );
    }

    #[test]
    fn goo_framebuffer_is_deterministic() {
        // Goo = blur (integer kernel) + an integer alpha LUT → byte-identical runs.
        let base = || {
            let mut fb = Framebuffer::new(32, 32);
            for y in 10..22 {
                for x in 10..22 {
                    fb.blend(x, y, Color::rgb(0.9, 0.3, 0.5));
                }
            }
            fb
        };
        let mut a = base();
        let mut b = base();
        goo_framebuffer(&mut a, 4.0, 0.5);
        goo_framebuffer(&mut b, 4.0, 0.5);
        assert_eq!(a.as_bytes(), b.as_bytes(), "goo must be reproducible");
    }

    #[test]
    fn goo_thresholds_blurred_alpha_to_near_binary() {
        // A solid square, blurred then thresholded: the core stays fully opaque,
        // the far field stays transparent, and the soft blurred ramp is sharpened —
        // away from the cutoff edge, alpha snaps to 0 or 255 (the metaball look).
        let mut fb = Framebuffer::new(40, 40);
        for y in 14..26 {
            for x in 14..26 {
                fb.blend(x, y, Color::rgb(1.0, 1.0, 1.0));
            }
        }
        goo_framebuffer(&mut fb, 5.0, 0.5);
        assert_eq!(fb.pixel(20, 20)[3], 255, "the core should snap to opaque");
        assert_eq!(fb.pixel(0, 0)[3], 0, "the far field should snap to clear");
        // Every pixel is either near-clear or near-opaque (no broad soft gradient):
        // only the thin AA ramp around the cutoff sits in between.
        let mid = fb
            .as_bytes()
            .chunks_exact(4)
            .filter(|p| p[3] > 32 && p[3] < 223)
            .count();
        let inked = fb.as_bytes().chunks_exact(4).filter(|p| p[3] > 0).count();
        assert!(
            (mid as f64) < 0.5 * inked as f64,
            "most inked pixels should be near-binary alpha (mid={mid}, inked={inked})"
        );
    }

    #[test]
    fn goo_fuses_two_overlapping_blobs_into_a_neck() {
        // Two opaque circles with a gap between them. After goo, the blurred halos
        // sum past the cutoff in the gap, so the midpoint — clear before — becomes
        // solid: the fused metaball neck.
        let mut fb = Framebuffer::new(80, 40);
        let circle = |fb: &mut Framebuffer, cx: i32, cy: i32, r: i32| {
            for y in (cy - r)..=(cy + r) {
                for x in (cx - r)..=(cx + r) {
                    if (x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r && x >= 0 && y >= 0 {
                        fb.blend(x as u32, y as u32, Color::rgb(0.9, 0.4, 0.6));
                    }
                }
            }
        };
        // Centers 24px apart, radius 11 → an ~2px gap at the midpoint (x=40).
        circle(&mut fb, 28, 20, 11);
        circle(&mut fb, 52, 20, 11);
        // The midpoint is transparent before goo (the gap).
        assert_eq!(fb.pixel(40, 20)[3], 0, "the gap is clear before goo");
        goo_framebuffer(&mut fb, 6.0, 0.5);
        // After goo, the halos merge and the midpoint snaps opaque — the neck.
        assert_eq!(
            fb.pixel(40, 20)[3],
            255,
            "overlapping blobs should fuse into a solid neck"
        );
    }

    #[test]
    fn color_grade_neutral_is_a_noop() {
        // The documented identity (exposure 0, contrast 1, saturation 1, temp 0,
        // tint 0) must leave the framebuffer byte-identical.
        let make = || Framebuffer::filled(8, 8, Color::rgb(0.4, 0.6, 0.2));
        let mut fb = make();
        color_grade_framebuffer(&mut fb, 0.0, 1.0, 1.0, 0.0, 0.0);
        assert_eq!(fb.as_bytes(), make().as_bytes());
    }

    #[test]
    fn color_grade_is_deterministic() {
        // Pure integer LUT + fixed-point saturation → two runs are byte-identical.
        let make = || Framebuffer::filled(16, 16, Color::rgb(0.5, 0.3, 0.7));
        let mut a = make();
        let mut b = make();
        color_grade_framebuffer(&mut a, 0.3, 1.2, 0.6, 0.4, -0.2);
        color_grade_framebuffer(&mut b, 0.3, 1.2, 0.6, 0.4, -0.2);
        assert_eq!(a.as_bytes(), b.as_bytes(), "grade must be reproducible");
    }

    #[test]
    fn color_grade_warms_and_desaturates() {
        // A neutral mid-gray graded warm (positive temperature) should gain red and
        // lose blue; pushing saturation toward 0 pulls all channels toward luma.
        let mut warm = Framebuffer::filled(4, 4, Color::rgb(0.5, 0.5, 0.5));
        color_grade_framebuffer(&mut warm, 0.0, 1.0, 1.0, 0.6, 0.0);
        let [r, _g, b, _a] = warm.pixel(0, 0);
        assert!(
            r > b,
            "warm grade should lift red above blue (r={r}, b={b})"
        );

        // A saturated red driven to saturation 0 becomes gray (R≈G≈B at its luma).
        let mut gray = Framebuffer::filled(4, 4, Color::rgb(1.0, 0.0, 0.0));
        color_grade_framebuffer(&mut gray, 0.0, 1.0, 0.0, 0.0, 0.0);
        let [r, g, b, _a] = gray.pixel(0, 0);
        assert_eq!((r, g, b), (76, 76, 76), "sat 0 → Rec.601 luma gray");
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
