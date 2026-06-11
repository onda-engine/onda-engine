//! Decode the bitmap images referenced by a scene's `Image` nodes.
//!
//! Mirrors `onda-svg`: a pre-pass over the scene graph, run once before frame
//! evaluation. Each [`Image`] node's `src` — a file path (relative to
//! `base_dir`) or a `data:` URI — is decoded to straight-alpha RGBA8 and
//! attached as [`Image::data`], so renderers draw pixels without touching the
//! filesystem. The scene-graph JSON is unchanged (it carries only `src`); the
//! decoded buffer is shared via `Arc`, so per-frame scene clones stay cheap.
//!
//! `http(s)://` URLs are left unresolved (the offline pass doesn't fetch); a
//! renderer simply skips an image whose pixels aren't attached.

use std::collections::HashMap;
use std::fmt;
use std::path::Path;
use std::sync::Arc;

use base64::Engine;
use onda_scene::{ImageData, Node, NodeKind, Scene};

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
/// differ per frame, and caching them would grow unboundedly). The per-node `blur`
/// focus-pull is still applied per call on a clone of the cached SHARP decode, so the
/// output is byte-identical to the uncached path.
pub fn load_images_cached(
    scene: &Scene,
    base_dir: &Path,
    cache: &mut HashMap<String, Option<ImageData>>,
) -> Result<Scene, ImageError> {
    Ok(Scene {
        composition: scene.composition,
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
            if let Some(mut data) =
                decode_src_cached(&image.src, base_dir, display_max_dim(image), cache)?
            {
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
            if let Some(data) = decode_src_cached(&video.src, base_dir, None, cache)? {
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

/// Headroom over a node's display box when right-sizing its decoded image. The
/// texture stays crisp under a moderate camera zoom (≤1.5×) without holding the
/// full source resolution: a 12 MP phone photo drawn in a 400 px tile becomes
/// ~0.4 MP instead of a 48 MB RGBA texture, so many large images no longer
/// overrun the GPU texture budget (which silently DROPPED the overflow before).
const DISPLAY_HEADROOM: f32 = 1.5;

/// The longest decoded dimension worth keeping for an [`Image`] node, or `None`
/// to leave it at source resolution. We only right-size when the node has an
/// explicit width×height box AND no active blur — an intrinsic-size image has no
/// known draw size, and a focus-pull (`blur > 0`) measures its sigma in SOURCE
/// pixels, so downscaling mid-pull would change the blur. (A box with blur is
/// left full-res until the pull resolves to `blur == 0`, then right-sized.)
fn display_max_dim(image: &onda_scene::Image) -> Option<u32> {
    if image.blur > 0.0 {
        return None;
    }
    match (image.width, image.height) {
        (Some(w), Some(h)) if w > 0.0 && h > 0.0 => {
            Some((w.max(h) * DISPLAY_HEADROOM).ceil().max(1.0) as u32)
        }
        _ => None,
    }
}

/// Shrink a decoded image so its longest side is ≤ `max_dim`, preserving aspect.
/// Only ever DOWNscales — an image already at/under the box is returned untouched
/// (so small assets and the wasm path keep byte-identical output). Lanczos3 keeps
/// downsized photos clean.
fn downscale_to_fit(data: ImageData, max_dim: u32) -> ImageData {
    let longest = data.width.max(data.height);
    if max_dim == 0 || longest <= max_dim {
        return data;
    }
    let scale = max_dim as f32 / longest as f32;
    let nw = ((data.width as f32 * scale).round() as u32).max(1);
    let nh = ((data.height as f32 * scale).round() as u32).max(1);
    match image::RgbaImage::from_raw(data.width, data.height, (*data.rgba).clone()) {
        Some(buf) => {
            let resized =
                image::imageops::resize(&buf, nw, nh, image::imageops::FilterType::Lanczos3);
            ImageData {
                width: nw,
                height: nh,
                rgba: Arc::new(resized.into_raw()),
            }
        }
        None => data,
    }
}

/// [`decode_src`] with a cross-call cache for stable sources, right-sized to the
/// node's display box (`max_dim` = longest kept dimension; `None` keeps source
/// resolution). The cached value is the SHARP, right-sized decode (pre-blur); the
/// caller applies any per-node blur to a clone, so the stored entry is reused
/// untouched. Keyed by `(src, max_dim)` so the same image drawn at two sizes
/// caches separately. `onda-noise:` (per-frame procedural) and `data:`
/// (potentially distinct + large per frame) are never cached.
fn decode_src_cached(
    src: &str,
    base_dir: &Path,
    max_dim: Option<u32>,
    cache: &mut HashMap<String, Option<ImageData>>,
) -> Result<Option<ImageData>, ImageError> {
    let cacheable = !src.starts_with("onda-noise:") && !src.starts_with("data:");
    let key = match max_dim {
        Some(m) => format!("{src}\u{1}{m}"),
        None => src.to_string(),
    };
    if cacheable {
        if let Some(hit) = cache.get(&key) {
            return Ok(hit.clone());
        }
    }
    let decoded = match (decode_src(src, base_dir)?, max_dim) {
        (Some(data), Some(m)) => Some(downscale_to_fit(data, m)),
        (other, _) => other,
    };
    if cacheable {
        cache.insert(key, decoded.clone());
    }
    Ok(decoded)
}

/// Decode one `src` to pixels. Returns `Ok(None)` for sources the offline pass
/// can't resolve (e.g. remote URLs), which renderers then skip.
fn decode_src(src: &str, base_dir: &Path) -> Result<Option<ImageData>, ImageError> {
    if let Some(spec) = src.strip_prefix("onda-noise:") {
        // Procedural film grain — generated, not decoded. Deterministic per
        // (pixel, seed), so animating `seed` (e.g. by frame) gives moving grain.
        // Works identically on native + wasm, so preview == export.
        Ok(Some(generate_noise(spec)?))
    } else if let Some(rest) = src.strip_prefix("data:") {
        Ok(Some(decode_data_uri(rest)?))
    } else if src.starts_with("http://") || src.starts_with("https://") {
        Ok(None)
    } else {
        let path = base_dir.join(src);
        match std::fs::read(&path) {
            Ok(bytes) => Ok(Some(decode_bytes(&bytes)?)),
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

    /// A solid `w×h` RGBA PNG (gray), base64-able — for size-related tests.
    fn solid_png(w: u32, h: u32) -> Vec<u8> {
        let mut buf = Vec::new();
        {
            let mut enc = png::Encoder::new(&mut buf, w, h);
            enc.set_color(png::ColorType::Rgba);
            enc.set_depth(png::BitDepth::Eight);
            let mut wr = enc.write_header().unwrap();
            wr.write_image_data(&vec![180u8; (w * h * 4) as usize])
                .unwrap();
        }
        buf
    }

    #[test]
    fn downscale_only_ever_shrinks() {
        let big = ImageData {
            width: 400,
            height: 200,
            rgba: Arc::new(vec![200u8; 400 * 200 * 4]),
        };
        let sized = downscale_to_fit(big, 150);
        assert_eq!(sized.width.max(sized.height), 150); // longest side hits the cap
        assert_eq!(sized.width, 150);
        assert_eq!(sized.height, 75); // aspect preserved

        let small = ImageData {
            width: 80,
            height: 60,
            rgba: Arc::new(vec![0u8; 80 * 60 * 4]),
        };
        let kept = downscale_to_fit(small, 150);
        assert_eq!((kept.width, kept.height), (80, 60)); // never upscaled
    }

    #[test]
    fn display_max_dim_uses_the_box_and_skips_blur_and_unboxed() {
        let mut img = onda_scene::Image::new("x".to_string());
        assert_eq!(display_max_dim(&img), None); // no box → intrinsic size, no downscale
        img.width = Some(100.0);
        img.height = Some(200.0);
        assert_eq!(display_max_dim(&img), Some(300)); // max(100,200) × 1.5 headroom
        img.blur = 2.0;
        assert_eq!(display_max_dim(&img), None); // a focus-pull keeps full source res
    }

    #[test]
    fn an_oversized_image_is_right_sized_to_its_display_box() {
        let b64 = base64::engine::general_purpose::STANDARD.encode(solid_png(400, 400));
        let mut img = onda_scene::Image::new(format!("data:image/png;base64,{b64}"));
        img.width = Some(100.0);
        img.height = Some(100.0);
        let scene = Scene {
            composition: Composition::new(8, 8, 30.0, 1),
            root: Node::new(NodeKind::Image(img)),
        };
        let loaded = load_images(&scene, Path::new("")).expect("decode + right-size");
        let NodeKind::Image(out) = &loaded.root.kind else {
            panic!("expected image node");
        };
        let data = out.data.as_ref().expect("pixels attached");
        // 400×400 source drawn in a 100×100 box → 100 × 1.5 headroom = 150.
        assert_eq!(data.width.max(data.height), 150);
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
