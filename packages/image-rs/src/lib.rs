//! Decode the bitmap images referenced by a scene's `Image` nodes.
//!
//! Mirrors `onda-svg`: a pre-pass over the scene graph, run once before frame
//! evaluation. Each [`Image`] node's `src` — a file path (relative to
//! `base_dir`) or a `data:` URI — is decoded to straight-alpha RGBA8,
//! **right-sized to the node's display box** (a 12 MP photo shown at 400×300 is
//! downscaled at decode, capped at `MAX_DECODE_EDGE` either way — see
//! `downscale_for_display`), and attached as [`Image::data`], so renderers
//! draw pixels without touching the filesystem. The scene-graph JSON is
//! unchanged (it carries only `src`); the decoded buffer is shared via `Arc`,
//! so per-frame scene clones stay cheap.
//!
//! `http(s)://` URLs are left unresolved (the offline pass doesn't fetch); a
//! renderer simply skips an image whose pixels aren't attached.

use std::collections::HashMap;
use std::fmt;
use std::path::Path;
use std::sync::Arc;

use base64::Engine;
use onda_scene::{ImageData, ImageFit, Node, NodeKind, Scene};

/// Hard cap on a decoded image's longest edge, in pixels. The GPU backend packs
/// every image a frame draws into ONE shared atlas texture no larger than
/// 8192×8192 (Vello's `MAX_ATLAS_SIZE`); an image that doesn't fit is silently
/// dropped — a 12-megapixel phone photo decoded at full resolution (~4000×3000)
/// can single-handedly crowd that atlas out, which reads as "my image is a
/// blank tile" in production. 4096 keeps even a box-less image to a quarter of
/// the atlas and inside wgpu's default `max_texture_dimension_2d` (8192).
const MAX_DECODE_EDGE: u32 = 4096;

/// Quality headroom kept above the display box when downscaling: 2× the box
/// covers retina output plus a moderate zoom-in (Ken Burns) without retaining
/// the full source resolution.
const DISPLAY_HEADROOM: f32 = 2.0;

/// An error decoding one of a scene's images.
#[derive(Debug)]
pub enum ImageError {
    /// Reading an image file failed (path included).
    Io(String, std::io::Error),
    /// The bytes could not be decoded as a supported image format.
    Decode(String),
    /// A `data:` URI was malformed or used an unsupported encoding.
    DataUri(String),
}

impl fmt::Display for ImageError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ImageError::Io(path, e) => write!(f, "reading image '{path}': {e}"),
            ImageError::Decode(msg) => write!(f, "decoding image: {msg}"),
            ImageError::DataUri(msg) => write!(f, "invalid data URI: {msg}"),
        }
    }
}

impl std::error::Error for ImageError {}

/// Decode every `Image` node's `src` and attach the pixels, returning a new
/// scene. File `src`s resolve relative to `base_dir`; `data:` URIs decode in
/// place; `http(s)://` URLs are left unresolved.
pub fn load_images(scene: &Scene, base_dir: &Path) -> Result<Scene, ImageError> {
    let mut cache = HashMap::new();
    load_images_cached(scene, base_dir, &mut cache)
}

/// Like [`load_images`], but reuses a caller-owned decode CACHE across calls — so a
/// `src` referenced by every frame (e.g. a background plate) is decoded ONCE instead
/// of per frame. Only stable sources (file paths / URLs) are cached; procedural
/// `onda-noise:` grain and `data:` URIs are regenerated each call (they re-seed or
/// differ per frame, and caching them would grow unboundedly). Entries are keyed by
/// `src` **plus the node's display-size bucket** (see `DecodeTarget`) — the decode
/// is downscaled to what the node actually displays, so the same `src` shown at two
/// sizes gets two entries and a large consumer is never served a small decode. The
/// per-node `blur` focus-pull is still applied per call on a clone of the cached
/// SHARP decode, so the output is byte-identical to the uncached path.
pub fn load_images_cached(
    scene: &Scene,
    base_dir: &Path,
    cache: &mut HashMap<String, Option<ImageData>>,
) -> Result<Scene, ImageError> {
    Ok(Scene {
        composition: scene.composition.clone(),
        root: load_node(&scene.root, base_dir, cache)?,
    })
}

fn load_node(
    node: &Node,
    base_dir: &Path,
    cache: &mut HashMap<String, Option<ImageData>>,
) -> Result<Node, ImageError> {
    let mut children = Vec::with_capacity(node.children.len());
    for child in &node.children {
        children.push(load_node(child, base_dir, cache)?);
    }

    if let NodeKind::Image(image) = &node.kind {
        if image.data.is_none() {
            // Focus-pull blur (`blur > 0`) measures its sigma in SOURCE pixels,
            // so any display-size downscale mid-pull would change the look —
            // those frames decode at source resolution and are right-sized once
            // the pull resolves to `blur == 0`.
            let sizing = if image.blur > 0.0 {
                DecodeSizing::Source
            } else {
                DecodeSizing::Display(decode_target(image.width, image.height, image.fit))
            };
            if let Some(mut data) = decode_src_cached(&image.src, base_dir, cache, sizing)? {
                // Optional gaussian "focus pull": blurring here (in the shared
                // decode pass) keeps native/GPU/CPU byte-identical and needs no
                // renderer support. Sigma is in source pixels; animating it
                // frame-to-frame gives a soft→sharp entrance.
                if image.blur > 0.0 {
                    data = blur_image(data, image.blur);
                }
                return Ok(Node {
                    kind: NodeKind::Image(image.clone().with_data(data)),
                    children,
                    ..node.clone()
                });
            }
        }
    }

    // A Video node's CURRENT frame arrives as a `data:` URI from the browser
    // player; decode it like an image so the renderer can draw it. A path/URL
    // `src` is a video container, NOT an image — image-decoding it would fail, so
    // skip it here. Native export fills `data` first via `onda-video` (ffmpeg);
    // any still-unresolved video src is simply left for the renderer to skip.
    if let NodeKind::Video(video) = &node.kind {
        if video.data.is_none() && video.src.starts_with("data:") {
            let sizing = DecodeSizing::Display(decode_target(video.width, video.height, video.fit));
            if let Some(data) = decode_src_cached(&video.src, base_dir, cache, sizing)? {
                return Ok(Node {
                    kind: NodeKind::Video(video.clone().with_data(data)),
                    children,
                    ..node.clone()
                });
            }
        }
    }

    Ok(Node {
        children,
        ..node.clone()
    })
}

/// The display-size constraint a decode may downscale to: the node's
/// `width`×`height` box rounded UP to power-of-two buckets, plus whether the
/// fit scales by the larger axis ratio (fill/cover — the cropped axis keeps
/// full quality) or the smaller (contain). Bucketing keeps an *animated* box
/// from forcing a fresh decode every frame (at most a handful of buckets per
/// `src`), and the bucket is part of the cache key so the same `src` displayed
/// at two sizes never serves the small decode to the big consumer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct DecodeTarget {
    bucket_w: u32,
    bucket_h: u32,
    contain: bool,
}

/// Bucket a node's display box into a [`DecodeTarget`]; `None` (no/degenerate
/// box → intrinsic-size draw) means only the global [`MAX_DECODE_EDGE`] applies.
fn decode_target(width: Option<f32>, height: Option<f32>, fit: ImageFit) -> Option<DecodeTarget> {
    match (width, height) {
        (Some(w), Some(h)) if w.is_finite() && h.is_finite() && w > 0.0 && h > 0.0 => {
            Some(DecodeTarget {
                bucket_w: (w.ceil() as u32).max(1).next_power_of_two(),
                bucket_h: (h.ceil() as u32).max(1).next_power_of_two(),
                contain: fit == ImageFit::Contain,
            })
        }
        _ => None,
    }
}

/// How a fresh decode is sized. `Display` right-sizes to the node's box (and
/// always applies the global [`MAX_DECODE_EDGE`] cap); `Source` keeps source
/// resolution — focus-pull blur measures its sigma in source pixels, so any
/// resize would change the look. `Source` decodes are never cached: a full-res
/// entry must not shadow the right-sized ones, and pulls resolve to
/// `blur == 0`, which re-enters the cached `Display` path.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DecodeSizing {
    Display(Option<DecodeTarget>),
    Source,
}

/// Cache key for a decode: the `src` plus the display bucket that shaped it.
/// NUL separators can't appear in a path/URL `src`, so keys never collide.
fn cache_key(src: &str, target: Option<DecodeTarget>) -> String {
    match target {
        Some(t) => {
            let fit = if t.contain { "contain" } else { "cover" };
            format!("{src}\0{}x{}\0{fit}", t.bucket_w, t.bucket_h)
        }
        None => src.to_string(),
    }
}

/// [`decode_src`] with a cross-call cache for stable sources. The cached value is the
/// SHARP decode (pre-blur); the caller applies any per-node blur to a clone, so the
/// stored entry is reused untouched. `onda-noise:` (per-frame procedural) and `data:`
/// (potentially distinct + large per frame) are never cached. Keyed by `src` + the
/// display bucket (see [`cache_key`]).
fn decode_src_cached(
    src: &str,
    base_dir: &Path,
    cache: &mut HashMap<String, Option<ImageData>>,
    sizing: DecodeSizing,
) -> Result<Option<ImageData>, ImageError> {
    let cacheable = !src.starts_with("onda-noise:")
        && !src.starts_with("data:")
        && sizing != DecodeSizing::Source;
    if cacheable {
        if let DecodeSizing::Display(target) = sizing {
            if let Some(hit) = cache.get(&cache_key(src, target)) {
                return Ok(hit.clone());
            }
        }
    }
    let decoded = decode_src(src, base_dir, sizing)?;
    if cacheable {
        if let DecodeSizing::Display(target) = sizing {
            cache.insert(cache_key(src, target), decoded.clone());
        }
    }
    Ok(decoded)
}

/// Decode one `src` to pixels, downscaled to the display `target` (see
/// [`downscale_for_display`]). Returns `Ok(None)` for sources the offline pass
/// can't resolve (e.g. remote URLs), which renderers then skip.
fn decode_src(
    src: &str,
    base_dir: &Path,
    sizing: DecodeSizing,
) -> Result<Option<ImageData>, ImageError> {
    // `Source` sizing skips right-sizing entirely (focus-pull blur fidelity).
    let size = |data: ImageData| match sizing {
        DecodeSizing::Display(target) => downscale_for_display(data, target),
        DecodeSizing::Source => data,
    };
    if let Some(spec) = src.strip_prefix("onda-noise:") {
        // Procedural film grain — generated, not decoded, at exactly the spec'd
        // size (never resized). Deterministic per (pixel, seed), so animating
        // `seed` (e.g. by frame) gives moving grain. Works identically on
        // native + wasm, so preview == export.
        Ok(Some(generate_noise(spec)?))
    } else if let Some(rest) = src.strip_prefix("data:") {
        Ok(Some(size(decode_data_uri(rest)?)))
    } else if src.starts_with("http://") || src.starts_with("https://") {
        Ok(None)
    } else {
        let path = base_dir.join(src);
        match std::fs::read(&path) {
            Ok(bytes) => Ok(Some(size(decode_bytes(&bytes)?))),
            // No filesystem in the browser, so a path `src` can't be loaded by the
            // offline pass — skip it (like a remote URL) instead of failing the
            // whole render. The Player resolves loadable images to `data:` URIs;
            // a still-unresolved path is simply not available yet, and a hard
            // error here would tear down the entire GPU preview. Native keeps the
            // error so a genuinely missing file in `onda export` is still reported.
            #[cfg(target_arch = "wasm32")]
            Err(_) => Ok(None),
            #[cfg(not(target_arch = "wasm32"))]
            Err(e) => Err(ImageError::Io(path.display().to_string(), e)),
        }
    }
}

/// Downscale freshly decoded pixels to what the composition actually needs:
/// at most [`DISPLAY_HEADROOM`]× the display box (when the node declares one),
/// and never longer than [`MAX_DECODE_EDGE`] on the longest edge. Without this,
/// a 12 MP phone photo is decoded — and uploaded — at full resolution, which
/// overruns the GPU's shared image atlas and gets the image silently dropped
/// (a blank tile). Aspect ratio is preserved; an image already small enough
/// passes through UNTOUCHED (this never upscales), so icons/logos and existing
/// golden frames are byte-identical. One-time CatmullRom resample at decode —
/// quality over speed.
fn downscale_for_display(data: ImageData, target: Option<DecodeTarget>) -> ImageData {
    let (iw, ih) = (data.width, data.height);
    if iw == 0 || ih == 0 {
        return data;
    }
    // Fraction of the source resolution to keep: the global cap…
    let mut keep = f64::from(MAX_DECODE_EDGE) / f64::from(iw.max(ih));
    if let Some(t) = target {
        // …tightened to HEADROOM× the factor the renderer will scale the image
        // by to fit its box (cover/fill take the larger axis ratio so the
        // CROPPED axis keeps full quality; contain takes the smaller). Decoding
        // beyond that is pixels nobody ever sees.
        let sx = f64::from(t.bucket_w) / f64::from(iw);
        let sy = f64::from(t.bucket_h) / f64::from(ih);
        let fit_scale = if t.contain { sx.min(sy) } else { sx.max(sy) };
        keep = keep.min(fit_scale * f64::from(DISPLAY_HEADROOM));
    }
    if keep >= 1.0 {
        return data;
    }
    let nw = ((f64::from(iw) * keep).round() as u32).clamp(1, iw);
    let nh = ((f64::from(ih) * keep).round() as u32).clamp(1, ih);
    if nw == iw && nh == ih {
        return data;
    }
    // A degenerate buffer (wrong length) is returned as-is rather than panicking.
    if data.rgba.len() != (iw as usize) * (ih as usize) * 4 {
        return data;
    }
    // Freshly decoded → the Arc is unshared, so this reclaims the buffer
    // without copying; a shared Arc (shouldn't happen here) clones.
    let rgba = Arc::try_unwrap(data.rgba).unwrap_or_else(|arc| (*arc).clone());
    let buf = image::RgbaImage::from_raw(iw, ih, rgba).expect("buffer length checked above");
    let resized = image::imageops::resize(&buf, nw, nh, image::imageops::FilterType::CatmullRom);
    ImageData {
        width: nw,
        height: nh,
        rgba: Arc::new(resized.into_raw()),
    }
}

/// Generate procedural grain from an `onda-noise://w=..&h=..&seed=..&intensity=..&mono=..`
/// spec: gray noise centred on 128 (the neutral value for an `overlay` blend, so
/// it modulates luminance) at the given amplitude. `mono=0` gives per-channel
/// (colour) grain. Deterministic per (pixel, seed).
fn generate_noise(spec: &str) -> Result<ImageData, ImageError> {
    let (mut w, mut h, mut seed) = (0u32, 0u32, 0u32);
    let mut intensity = 0.1_f32;
    let mut mono = true;
    for kv in spec
        .trim_start_matches('/')
        .trim_start_matches('?')
        .split('&')
    {
        let (k, v) = kv.split_once('=').unwrap_or((kv, ""));
        match k {
            "w" => w = v.parse().unwrap_or(0),
            "h" => h = v.parse().unwrap_or(0),
            "seed" => seed = v.parse().unwrap_or(0),
            "intensity" => intensity = v.parse().unwrap_or(0.1),
            "mono" => mono = v != "0",
            _ => {}
        }
    }
    if w == 0 || h == 0 {
        return Err(ImageError::Decode("onda-noise needs w and h".into()));
    }
    let amp = intensity.clamp(0.0, 1.0) * 255.0;
    let count = (w as usize) * (h as usize);
    let mut rgba = Vec::with_capacity(count * 4);
    let key = seed.wrapping_mul(0x9E37_79B9);
    for i in 0..count {
        let base = hash32(i as u32 ^ key);
        let g = noise_val(base, amp);
        if mono {
            rgba.extend_from_slice(&[g, g, g, 255]);
        } else {
            rgba.extend_from_slice(&[
                noise_val(hash32(base ^ 0xA5A5_A5A5), amp),
                g,
                noise_val(hash32(base ^ 0x5A5A_5A5A), amp),
                255,
            ]);
        }
    }
    Ok(ImageData {
        width: w,
        height: h,
        rgba: std::sync::Arc::new(rgba),
    })
}

/// Gaussian-blur decoded RGBA8 by `sigma` source pixels (the `image` crate's
/// separable gaussian — no hand-rolled kernel). Straight-alpha in, straight-alpha
/// out; fully-opaque photos (the common case) blur cleanly. A degenerate buffer
/// (wrong length) is returned unblurred rather than panicking.
fn blur_image(data: ImageData, sigma: f32) -> ImageData {
    let ImageData {
        width,
        height,
        rgba,
    } = data;
    match image::RgbaImage::from_raw(width, height, (*rgba).clone()) {
        Some(buf) => {
            let blurred = image::imageops::blur(&buf, sigma.max(0.0));
            ImageData {
                width,
                height,
                rgba: Arc::new(blurred.into_raw()),
            }
        }
        None => ImageData {
            width,
            height,
            rgba,
        },
    }
}

/// A fast integer hash (Murmur3-style finalizer) — good per-pixel scatter.
fn hash32(mut x: u32) -> u32 {
    x ^= x >> 16;
    x = x.wrapping_mul(0x7feb_352d);
    x ^= x >> 15;
    x = x.wrapping_mul(0x846c_a68b);
    x ^= x >> 16;
    x
}

/// Map a hash to a grain byte centred on 128 with `amp` peak deviation.
fn noise_val(h: u32, amp: f32) -> u8 {
    let t = (h as f32 / u32::MAX as f32) - 0.5;
    (128.0 + t * 2.0 * amp).clamp(0.0, 255.0) as u8
}

/// `<mediatype>[;base64],<data>` — only base64 payloads are supported (a raster
/// image isn't meaningfully URL-encoded text).
fn decode_data_uri(rest: &str) -> Result<ImageData, ImageError> {
    let comma = rest
        .find(',')
        .ok_or_else(|| ImageError::DataUri("missing ','".into()))?;
    let meta = &rest[..comma];
    let payload = &rest[comma + 1..];
    if !meta.contains("base64") {
        return Err(ImageError::DataUri(
            "only base64-encoded image data URIs are supported".into(),
        ));
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(payload.trim())
        .map_err(|e| ImageError::DataUri(e.to_string()))?;
    decode_bytes(&bytes)
}

/// Decode encoded image bytes (PNG/JPEG/GIF/WebP) to straight-alpha RGBA8.
fn decode_bytes(bytes: &[u8]) -> Result<ImageData, ImageError> {
    let decoded = image::load_from_memory(bytes).map_err(|e| ImageError::Decode(e.to_string()))?;
    let rgba = decoded.to_rgba8();
    let (width, height) = (rgba.width(), rgba.height());
    Ok(ImageData {
        width,
        height,
        rgba: Arc::new(rgba.into_raw()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use onda_scene::{Composition, Node, Scene};

    /// A 2×1 RGBA PNG (one red, one semi-transparent blue pixel), base64'd.
    fn tiny_png_bytes() -> Vec<u8> {
        let mut buf = Vec::new();
        {
            let mut enc = png::Encoder::new(&mut buf, 2, 1);
            enc.set_color(png::ColorType::Rgba);
            enc.set_depth(png::BitDepth::Eight);
            let mut w = enc.write_header().unwrap();
            w.write_image_data(&[255, 0, 0, 255, 0, 0, 255, 128])
                .unwrap();
        }
        buf
    }

    #[test]
    fn decodes_a_data_uri_image_onto_the_node() {
        let b64 = base64::engine::general_purpose::STANDARD.encode(tiny_png_bytes());
        let src = format!("data:image/png;base64,{b64}");
        let scene = Scene {
            composition: Composition::new(4, 4, 30.0, 1),
            root: Node::group().with_child(Node::image(src)),
        };
        let loaded = load_images(&scene, Path::new("")).expect("decode");
        let NodeKind::Image(img) = &loaded.root.children[0].kind else {
            panic!("expected image node");
        };
        let data = img.data.as_ref().expect("pixels attached");
        assert_eq!((data.width, data.height), (2, 1));
        assert_eq!(&data.rgba[0..4], &[255, 0, 0, 255]); // first pixel red
        assert_eq!(data.rgba[7], 128); // second pixel's alpha preserved
    }

    #[test]
    fn remote_urls_are_left_unresolved_not_errors() {
        let scene = Scene {
            composition: Composition::new(4, 4, 30.0, 1),
            root: Node::image("https://example.com/logo.png"),
        };
        let loaded = load_images(&scene, Path::new("")).expect("no error for remote");
        let NodeKind::Image(img) = &loaded.root.kind else {
            panic!("expected image node");
        };
        assert!(img.data.is_none());
    }

    // Native only: with a real filesystem, a missing file is a hard error so a
    // bad path in `onda export` is reported. In the browser (wasm) there's no
    // filesystem, so an unreadable path `src` is skipped instead (see `decode_src`).
    #[cfg(not(target_arch = "wasm32"))]
    #[test]
    fn a_missing_file_is_a_clear_error() {
        let scene = Scene {
            composition: Composition::new(4, 4, 30.0, 1),
            root: Node::image("does-not-exist.png"),
        };
        let err = load_images(&scene, Path::new("/tmp")).unwrap_err();
        assert!(format!("{err}").contains("reading image"));
    }

    #[test]
    fn blur_softens_a_hard_edge() {
        // 8×8: left half black, right half white. A gaussian should turn the
        // columns straddling the seam into intermediate grays (the edge melts),
        // while fully-opaque alpha stays opaque.
        let (w, h) = (8u32, 8u32);
        let mut rgba = Vec::with_capacity((w * h * 4) as usize);
        for _y in 0..h {
            for x in 0..w {
                let v = if x < w / 2 { 0 } else { 255 };
                rgba.extend_from_slice(&[v, v, v, 255]);
            }
        }
        let data = ImageData {
            width: w,
            height: h,
            rgba: Arc::new(rgba),
        };
        let blurred = blur_image(data, 2.0);
        assert_eq!((blurred.width, blurred.height), (w, h));
        // The pixel just left of the seam (x = 3, row 0) should now be a gray.
        let idx = 3 * 4;
        assert!(
            blurred.rgba[idx] > 0 && blurred.rgba[idx] < 255,
            "edge pixel should be gray, got {}",
            blurred.rgba[idx]
        );
        assert_eq!(blurred.rgba[idx + 3], 255, "alpha stays opaque");
    }

    /// Encode a `w`×`h` flat-color RGBA PNG (tiny file, fast decode) via the
    /// `image` crate — the synthetic "12 MP phone photo" for the cap tests.
    fn big_png_bytes(w: u32, h: u32, color: [u8; 4]) -> Vec<u8> {
        let buf = image::RgbaImage::from_pixel(w, h, image::Rgba(color));
        let mut bytes = std::io::Cursor::new(Vec::new());
        image::DynamicImage::ImageRgba8(buf)
            .write_to(&mut bytes, image::ImageFormat::Png)
            .unwrap();
        bytes.into_inner()
    }

    fn data_uri(bytes: &[u8]) -> String {
        let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
        format!("data:image/png;base64,{b64}")
    }

    #[test]
    fn a_huge_image_in_a_small_box_is_decoded_to_the_display_bucket() {
        // 6000×4000 source displayed at 400×300 (cover): box buckets to 512×512,
        // cover scale = max(512/6000, 512/4000) = 0.128, ×2 headroom = 0.256 →
        // decode 1536×1024 — far under both the source and the 4096 global cap.
        let src = data_uri(&big_png_bytes(6000, 4000, [10, 200, 120, 255]));
        let scene = Scene {
            composition: Composition::new(800, 600, 30.0, 1),
            root: Node::new(NodeKind::Image(onda_scene::Image::new(src).with_box(
                400.0,
                300.0,
                ImageFit::Cover,
            ))),
        };
        let loaded = load_images(&scene, Path::new("")).expect("decode");
        let NodeKind::Image(img) = &loaded.root.kind else {
            panic!("expected image node");
        };
        let data = img.data.as_ref().expect("pixels attached");
        assert_eq!((data.width, data.height), (1536, 1024));
        assert!(data.width.max(data.height) <= MAX_DECODE_EDGE);
        // Aspect preserved (3:2) and content intact — not a blank buffer.
        assert_eq!(data.rgba.len(), 1536 * 1024 * 4);
        assert_eq!(&data.rgba[0..4], &[10, 200, 120, 255]);
    }

    #[test]
    fn a_blurred_image_decodes_at_source_resolution() {
        // Focus-pull blur measures its sigma in SOURCE pixels — a display-size
        // downscale mid-pull would change the look, so `blur > 0` bypasses both
        // the display bucket and the global cap (and the cache).
        let src = data_uri(&big_png_bytes(4500, 3000, [60, 60, 220, 255]));
        let mut image = onda_scene::Image::new(src).with_box(400.0, 300.0, ImageFit::Cover);
        image.blur = 0.5;
        let scene = Scene {
            composition: Composition::new(800, 600, 30.0, 1),
            root: Node::new(NodeKind::Image(image)),
        };
        let loaded = load_images(&scene, Path::new("")).expect("decode");
        let NodeKind::Image(img) = &loaded.root.kind else {
            panic!("expected image node");
        };
        let data = img.data.as_ref().expect("pixels attached");
        assert_eq!((data.width, data.height), (4500, 3000));
    }

    #[test]
    fn a_huge_image_without_a_box_is_capped_at_the_global_max_edge() {
        // No display box → only the global cap applies: 6000×4000 → 4096×2731.
        let src = data_uri(&big_png_bytes(6000, 4000, [200, 40, 40, 255]));
        let scene = Scene {
            composition: Composition::new(800, 600, 30.0, 1),
            root: Node::image(src),
        };
        let loaded = load_images(&scene, Path::new("")).expect("decode");
        let NodeKind::Image(img) = &loaded.root.kind else {
            panic!("expected image node");
        };
        let data = img.data.as_ref().expect("pixels attached");
        assert_eq!((data.width, data.height), (MAX_DECODE_EDGE, 2731));
        assert_eq!(&data.rgba[0..4], &[200, 40, 40, 255]);
    }

    #[test]
    fn small_images_are_never_resized() {
        // Downscale only — a source already at/below what the box needs passes
        // through byte-identical (keeps icons/logos sharp and goldens stable).
        let src = data_uri(&big_png_bytes(100, 80, [1, 2, 3, 255]));
        let scene = Scene {
            composition: Composition::new(800, 600, 30.0, 1),
            root: Node::new(NodeKind::Image(onda_scene::Image::new(src).with_box(
                400.0,
                300.0,
                ImageFit::Contain,
            ))),
        };
        let loaded = load_images(&scene, Path::new("")).expect("decode");
        let NodeKind::Image(img) = &loaded.root.kind else {
            panic!("expected image node");
        };
        let data = img.data.as_ref().expect("pixels attached");
        assert_eq!((data.width, data.height), (100, 80));
    }

    #[test]
    fn the_cache_never_serves_a_small_decode_to_a_big_consumer() {
        // The SAME file src displayed small first, then box-less (full size):
        // entries are keyed by src + display bucket, so the second consumer must
        // get its own (bigger) decode, not the first node's small one.
        let dir =
            std::env::temp_dir().join(format!("onda-image-cache-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("plate.png");
        std::fs::write(&path, big_png_bytes(1200, 800, [9, 9, 9, 255])).unwrap();

        let small = Node::new(NodeKind::Image(
            onda_scene::Image::new("plate.png").with_box(100.0, 75.0, ImageFit::Cover),
        ));
        let big = Node::image("plate.png");
        let scene = Scene {
            composition: Composition::new(800, 600, 30.0, 1),
            root: Node::group().with_children([small, big]),
        };
        let mut cache = HashMap::new();
        let loaded = load_images_cached(&scene, &dir, &mut cache).expect("decode");
        std::fs::remove_dir_all(&dir).ok();

        let dims = |node: &Node| -> (u32, u32) {
            let NodeKind::Image(img) = &node.kind else {
                panic!("expected image node");
            };
            let d = img.data.as_ref().expect("pixels attached");
            (d.width, d.height)
        };
        // Small consumer: bucket 128×128, cover scale 0.16, ×2 → 384×256.
        assert_eq!(dims(&loaded.root.children[0]), (384, 256));
        // Big consumer: full intrinsic size (under the 4096 cap → untouched).
        assert_eq!(dims(&loaded.root.children[1]), (1200, 800));
        // And the cache holds one entry per display bucket.
        assert_eq!(cache.len(), 2);
    }

    #[test]
    fn blur_is_applied_through_the_load_pass() {
        // An Image node with `blur > 0` comes back blurred (edge no longer a
        // hard 0/255 step) after the decode pass.
        let b64 = base64::engine::general_purpose::STANDARD.encode(tiny_png_bytes());
        let src = format!("data:image/png;base64,{b64}");
        let scene = Scene {
            composition: Composition::new(4, 4, 30.0, 1),
            root: Node::new(NodeKind::Image(onda_scene::Image::new(src).with_blur(1.5))),
        };
        let loaded = load_images(&scene, Path::new("")).expect("decode + blur");
        let NodeKind::Image(img) = &loaded.root.kind else {
            panic!("expected image node");
        };
        let data = img.data.as_ref().expect("pixels attached");
        assert_eq!((data.width, data.height), (2, 1));
        // The original first pixel was pure red (255,0,0); a blur with the blue
        // neighbour pulls its green/blue up off zero.
        assert!(
            data.rgba[2] > 0,
            "blue channel bleeds in from the neighbour"
        );
    }
}
