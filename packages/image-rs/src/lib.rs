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

    // A Video node carries the CURRENT frame's `src` (the browser player rewrites
    // it to a `data:` URI per frame; native export sets it from ffmpeg). Decode it
    // the same way as an image so the renderer can draw it.
    if let NodeKind::Video(video) = &node.kind {
        if video.data.is_none() {
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
    if let Some(rest) = src.strip_prefix("data:") {
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
