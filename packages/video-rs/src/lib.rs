//! ONDA video: decode the frame each `Video` node wants, for native export.
//!
//! The browser preview decodes video in the player (an off-screen `<video>` /
//! WebCodecs). For `onda export` there's no browser, so this crate extracts the
//! frame at a node's source `time` by shelling out to the **ffmpeg binary** — the
//! same dependency the encode path already needs — and decoding the PNG it pipes
//! back. No libav linking; nothing here runs in wasm.
//!
//! Usage mirrors `onda-image`: a pre-pass over the scene that fills every
//! [`onda_scene::Video`] node's `data` with its decoded frame; the renderer then
//! draws it like an image. Frames are cached within one pass by `(src, time)` so
//! a scene with the same clip at the same time decodes once.

use std::collections::HashMap;
use std::fmt;
use std::process::Command;
use std::sync::Arc;

use onda_scene::{ImageData, Node, NodeKind, Scene};

/// A failure decoding a video frame.
#[derive(Debug)]
pub enum VideoError {
    /// The ffmpeg binary couldn't be launched (not installed / not on PATH).
    Spawn(String),
    /// ffmpeg ran but failed to extract the frame (bad src, time past the end…).
    Ffmpeg {
        src: String,
        time: f32,
        stderr: String,
    },
    /// The frame bytes ffmpeg produced couldn't be decoded as a PNG.
    Decode(String),
}

impl fmt::Display for VideoError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            VideoError::Spawn(e) => write!(f, "could not run ffmpeg (is it installed?): {e}"),
            VideoError::Ffmpeg { src, time, stderr } => {
                write!(f, "ffmpeg failed to read '{src}' at {time}s: {stderr}")
            }
            VideoError::Decode(e) => write!(f, "decoding the extracted frame failed: {e}"),
        }
    }
}

impl std::error::Error for VideoError {}

/// Time quantization (frames/sec) for the per-pass frame cache, matching the
/// player's preview bucketing so native + browser pick the same source frame.
const BUCKET_FPS: f32 = 30.0;

/// Decode the frame at `time` seconds of `src` to straight-alpha RGBA8.
///
/// Shells `ffmpeg -ss <time> -i <src> -frames:v 1 ... png` and decodes the piped
/// PNG. `-ss` before `-i` uses ffmpeg's fast accurate-seek (decode from the
/// nearest keyframe to the target), which is plenty for frame-stepped export.
pub fn decode_frame(src: &str, time: f32) -> Result<ImageData, VideoError> {
    let t = time.max(0.0);
    let output = Command::new("ffmpeg")
        .args([
            "-v",
            "error",
            "-ss",
            &format!("{t}"),
            "-i",
            src,
            "-frames:v",
            "1",
            "-f",
            "image2pipe",
            "-vcodec",
            "png",
            "-",
        ])
        .output()
        .map_err(|e| VideoError::Spawn(e.to_string()))?;

    if !output.status.success() || output.stdout.is_empty() {
        return Err(VideoError::Ffmpeg {
            src: src.to_string(),
            time: t,
            stderr: String::from_utf8_lossy(&output.stderr).trim().to_string(),
        });
    }
    decode_png(&output.stdout)
}

/// Decode PNG bytes to straight-alpha RGBA8.
fn decode_png(bytes: &[u8]) -> Result<ImageData, VideoError> {
    let decoded = image::load_from_memory(bytes).map_err(|e| VideoError::Decode(e.to_string()))?;
    let rgba = decoded.to_rgba8();
    let (width, height) = (rgba.width(), rgba.height());
    Ok(ImageData {
        width,
        height,
        rgba: Arc::new(rgba.into_raw()),
    })
}

/// Decode every `Video` node's current frame and attach it as `data`, returning a
/// new scene. A node already carrying pixels, or with an empty `src`, is left
/// alone. Frames are cached within this call by `(src, time-bucket)`.
pub fn load_video_frames(scene: &Scene) -> Result<Scene, VideoError> {
    let mut cache: HashMap<(String, i64), ImageData> = HashMap::new();
    Ok(Scene {
        composition: scene.composition,
        root: load_node(&scene.root, &mut cache)?,
    })
}

fn load_node(
    node: &Node,
    cache: &mut HashMap<(String, i64), ImageData>,
) -> Result<Node, VideoError> {
    let mut children = Vec::with_capacity(node.children.len());
    for child in &node.children {
        children.push(load_node(child, cache)?);
    }

    if let NodeKind::Video(video) = &node.kind {
        if video.data.is_none() && !video.src.is_empty() {
            let key = (video.src.clone(), (video.time * BUCKET_FPS).round() as i64);
            let data = match cache.get(&key) {
                Some(d) => d.clone(),
                None => {
                    let d = decode_frame(&video.src, video.time)?;
                    cache.insert(key, d.clone());
                    d
                }
            };
            return Ok(Node {
                kind: NodeKind::Video(video.clone().with_data(data)),
                children,
                ..node.clone()
            });
        }
    }

    Ok(Node {
        children,
        ..node.clone()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A 2×1 RGBA PNG (one red, one semi-transparent blue pixel), base64-free.
    fn tiny_png_bytes() -> Vec<u8> {
        let mut buf = Vec::new();
        {
            use image::ImageEncoder;
            let enc = image::codecs::png::PngEncoder::new(&mut buf);
            enc.write_image(
                &[255, 0, 0, 255, 0, 0, 255, 128],
                2,
                1,
                image::ExtendedColorType::Rgba8,
            )
            .unwrap();
        }
        buf
    }

    #[test]
    fn decodes_png_frame_bytes_to_rgba() {
        let data = decode_png(&tiny_png_bytes()).expect("decode png");
        assert_eq!((data.width, data.height), (2, 1));
        assert_eq!(&data.rgba[0..4], &[255, 0, 0, 255]); // first pixel red
        assert_eq!(data.rgba[7], 128); // second pixel's alpha preserved
    }

    #[test]
    fn a_node_without_video_is_unchanged() {
        let scene = Scene::new(onda_scene::Composition::new(8, 8, 30.0, 1))
            .with_root(Node::group().with_child(Node::image("a.png")));
        // No video nodes -> no ffmpeg, returns Ok with the tree intact.
        let out = load_video_frames(&scene).expect("no-op");
        assert_eq!(out.root.children.len(), 1);
    }
}
