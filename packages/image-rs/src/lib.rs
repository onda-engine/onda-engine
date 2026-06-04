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
    Ok(Scene {
        composition: scene.composition,
        root: load_node(&scene.root, base_dir)?,
    })
}

fn load_node(node: &Node, base_dir: &Path) -> Result<Node, ImageError> {
    let mut children = Vec::with_capacity(node.children.len());
    for child in &node.children {
        children.push(load_node(child, base_dir)?);
    }

    if let NodeKind::Image(image) = &node.kind {
        if image.data.is_none() {
            if let Some(data) = decode_src(&image.src, base_dir)? {
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
            if let Some(data) = decode_src(&video.src, base_dir)? {
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
    for kv in spec.trim_start_matches('/').trim_start_matches('?').split('&') {
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
}
