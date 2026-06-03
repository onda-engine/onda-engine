//! ONDA video: decode the frame each `Video` node wants, for native export.
//!
//! The browser preview decodes video in the player (an off-screen `<video>` /
//! WebCodecs). For `onda export` there's no browser, so this crate extracts
//! frames by shelling out to the **ffmpeg binary** — the same dependency the
//! encode path already needs. No libav linking; nothing here runs in wasm.
//!
//! Two access patterns:
//! - [`VideoDecoder`] — for an animated export (many frames in increasing time):
//!   one persistent ffmpeg process per `src`, resampled to the composition fps,
//!   piping frames sequentially. Reading frame N is one cheap read, not a fresh
//!   `ffmpeg -ss` spawn — 10-100× faster for a real export, and frame-accurate
//!   (ffmpeg picks the right source frame per output tick, not the nearest
//!   keyframe). Backward / out-of-order requests fall back to a one-off seek.
//! - [`load_video_frames`] — a single-scene seek (the `onda render` still path),
//!   where reading a whole stream just to reach one far frame would be wasteful.
//!
//! Both fill every [`onda_scene::Video`] node's `data` with its decoded frame;
//! the renderer then draws it like an image.

use std::collections::HashMap;
use std::fmt;
use std::io::{BufRead, BufReader};
use std::process::{Child, ChildStdout, Command, Stdio};
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
    /// The frame bytes ffmpeg produced couldn't be decoded.
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

/// Decode the frame at `time` seconds of `src` to straight-alpha RGBA8 by a
/// one-off seek. Shells `ffmpeg -ss <time> -i <src> -frames:v 1 … png` and
/// decodes the piped PNG. `-ss` before `-i` is ffmpeg's fast accurate-seek
/// (decode from the nearest keyframe) — right for a single still / random access.
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

// ── Sequential streaming decoder (the fast export path) ───────────────────────

/// One persistent ffmpeg pipe for a single `src`, resampled to the composition
/// fps and emitting raw PPM frames in order. Frame `i` is source time `i/fps`.
struct FrameStream {
    src: String,
    fps: f32,
    child: Option<Child>,
    reader: Option<BufReader<ChildStdout>>,
    /// Index of the next frame the pipe will emit.
    next_idx: i64,
    /// The most-recently-emitted frame — served for repeats and EOF clamping.
    last: Option<(i64, ImageData)>,
}

impl FrameStream {
    fn new(src: &str, fps: f32) -> Self {
        FrameStream {
            src: src.to_string(),
            fps: if fps > 0.0 { fps } else { 30.0 },
            child: None,
            reader: None,
            next_idx: 0,
            last: None,
        }
    }

    fn ensure_started(&mut self) -> Result<(), VideoError> {
        if self.reader.is_some() {
            return Ok(());
        }
        let mut child = Command::new("ffmpeg")
            .args([
                "-v",
                "error",
                "-i",
                &self.src,
                "-an",
                "-vf",
                &format!("fps={}", self.fps),
                "-f",
                "image2pipe",
                "-vcodec",
                "ppm",
                "-",
            ])
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| VideoError::Spawn(e.to_string()))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| VideoError::Spawn("ffmpeg produced no stdout pipe".into()))?;
        self.reader = Some(BufReader::new(stdout));
        self.child = Some(child);
        Ok(())
    }

    /// The frame at `time` seconds. Reads forward through the pipe to the target
    /// index (serving repeats from cache, clamping at EOF); a backward request
    /// falls back to a one-off `decode_frame` seek so the stream isn't disturbed.
    fn frame_at(&mut self, time: f32) -> Result<ImageData, VideoError> {
        let idx = (time.max(0.0) * self.fps).round() as i64;
        match &self.last {
            Some((li, data)) if *li == idx => return Ok(data.clone()),
            Some((li, _)) if idx < *li => return decode_frame(&self.src, idx as f32 / self.fps),
            None if idx < self.next_idx => return decode_frame(&self.src, idx as f32 / self.fps),
            _ => {}
        }
        self.ensure_started()?;
        loop {
            let reader = self.reader.as_mut().unwrap();
            match read_ppm_frame(reader)? {
                Some(frame) => {
                    let cur = self.next_idx;
                    self.next_idx += 1;
                    self.last = Some((cur, frame));
                    if cur >= idx {
                        return Ok(self.last.as_ref().unwrap().1.clone());
                    }
                }
                // EOF before the target: the clip is shorter than asked — clamp
                // to its last frame (don't error past the end).
                None => {
                    return self.last.as_ref().map(|(_, d)| d.clone()).ok_or_else(|| {
                        VideoError::Ffmpeg {
                            src: self.src.clone(),
                            time,
                            stderr: "ffmpeg emitted no frames".into(),
                        }
                    });
                }
            }
        }
    }
}

impl Drop for FrameStream {
    fn drop(&mut self) {
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

/// Reads one binary PPM (`P6`) frame from `r`, or `None` at a clean end-of-stream.
fn read_ppm_frame<R: BufRead>(r: &mut R) -> Result<Option<ImageData>, VideoError> {
    let mut magic = [0u8; 2];
    match r.read_exact(&mut magic) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(VideoError::Decode(e.to_string())),
    }
    if &magic != b"P6" {
        return Err(VideoError::Decode(format!(
            "expected PPM 'P6', got {magic:?}"
        )));
    }
    let width = read_ppm_uint(r)? as usize;
    let height = read_ppm_uint(r)? as usize;
    let maxval = read_ppm_uint(r)?;
    if maxval != 255 {
        return Err(VideoError::Decode(format!(
            "unsupported PPM maxval {maxval}"
        )));
    }
    if width == 0 || height == 0 {
        return Err(VideoError::Decode("zero-sized PPM frame".into()));
    }
    let mut rgb = vec![0u8; width * height * 3];
    r.read_exact(&mut rgb)
        .map_err(|e| VideoError::Decode(e.to_string()))?;
    let mut rgba = Vec::with_capacity(width * height * 4);
    for px in rgb.chunks_exact(3) {
        rgba.extend_from_slice(&[px[0], px[1], px[2], 255]);
    }
    Ok(Some(ImageData {
        width: width as u32,
        height: height as u32,
        rgba: Arc::new(rgba),
    }))
}

/// Read a PPM header uint: skip leading ASCII whitespace, read digits, consume
/// the single terminating whitespace byte (so the next read starts at the next
/// token / the pixel block).
fn read_ppm_uint<R: BufRead>(r: &mut R) -> Result<u32, VideoError> {
    let mut byte = [0u8; 1];
    let mut started = false;
    let mut value: u32 = 0;
    loop {
        match r.read_exact(&mut byte) {
            Ok(()) => {}
            Err(e) => return Err(VideoError::Decode(format!("truncated PPM header: {e}"))),
        }
        let b = byte[0];
        if b.is_ascii_whitespace() {
            if started {
                return Ok(value); // consumed the terminating whitespace
            }
            continue; // leading whitespace
        }
        if b.is_ascii_digit() {
            started = true;
            value = value * 10 + (b - b'0') as u32;
        } else {
            return Err(VideoError::Decode(format!("bad byte {b} in PPM header")));
        }
    }
}

/// Resolves `Video` nodes across a sequence of frames by holding one persistent,
/// sequential ffmpeg pipe per `src`. Construct once, then [`VideoDecoder::resolve_scene`]
/// each frame's scene in order — the fast path for `onda export`.
#[derive(Default)]
pub struct VideoDecoder {
    streams: HashMap<String, FrameStream>,
}

impl VideoDecoder {
    pub fn new() -> Self {
        VideoDecoder::default()
    }

    /// Fill every `Video` node's `data` with its frame (at the scene's
    /// composition fps), returning a new scene.
    pub fn resolve_scene(&mut self, scene: &Scene) -> Result<Scene, VideoError> {
        let fps = scene.composition.fps;
        Ok(Scene {
            composition: scene.composition,
            root: self.resolve_node(&scene.root, fps)?,
        })
    }

    fn resolve_node(&mut self, node: &Node, fps: f32) -> Result<Node, VideoError> {
        let mut children = Vec::with_capacity(node.children.len());
        for child in &node.children {
            children.push(self.resolve_node(child, fps)?);
        }
        if let NodeKind::Video(video) = &node.kind {
            if video.data.is_none() && !video.src.is_empty() {
                let stream = self
                    .streams
                    .entry(video.src.clone())
                    .or_insert_with(|| FrameStream::new(&video.src, fps));
                let data = stream.frame_at(video.time)?;
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
}

/// Decode every `Video` node's frame for a SINGLE scene via a one-off seek (the
/// `onda render` still path). For a multi-frame export prefer [`VideoDecoder`],
/// which streams sequentially instead of seeking per node. Frames are cached
/// within this call by `(src, frame-index)` at the composition fps.
pub fn load_video_frames(scene: &Scene) -> Result<Scene, VideoError> {
    let fps = if scene.composition.fps > 0.0 {
        scene.composition.fps
    } else {
        30.0
    };
    let mut cache: HashMap<(String, i64), ImageData> = HashMap::new();
    Ok(Scene {
        composition: scene.composition,
        root: load_node(&scene.root, fps, &mut cache)?,
    })
}

fn load_node(
    node: &Node,
    fps: f32,
    cache: &mut HashMap<(String, i64), ImageData>,
) -> Result<Node, VideoError> {
    let mut children = Vec::with_capacity(node.children.len());
    for child in &node.children {
        children.push(load_node(child, fps, cache)?);
    }

    if let NodeKind::Video(video) = &node.kind {
        if video.data.is_none() && !video.src.is_empty() {
            let key = (video.src.clone(), (video.time * fps).round() as i64);
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

    /// A 2×1 RGBA PNG (one red, one semi-transparent blue pixel).
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
    fn parses_a_binary_ppm_frame() {
        // P6, 2×1, maxval 255, then 2 RGB pixels (red, green).
        let mut ppm = b"P6\n2 1\n255\n".to_vec();
        ppm.extend_from_slice(&[255, 0, 0, 0, 255, 0]);
        let mut cur = std::io::Cursor::new(ppm);
        let frame = read_ppm_frame(&mut cur).expect("read").expect("a frame");
        assert_eq!((frame.width, frame.height), (2, 1));
        assert_eq!(&frame.rgba[..], &[255, 0, 0, 255, 0, 255, 0, 255]); // RGB→RGBA, opaque
                                                                        // A second read on the exhausted stream is a clean end (None).
        assert!(read_ppm_frame(&mut cur).expect("eof").is_none());
    }

    #[test]
    fn a_node_without_video_is_unchanged() {
        let scene = Scene::new(onda_scene::Composition::new(8, 8, 30.0, 1))
            .with_root(Node::group().with_child(Node::image("a.png")));
        let out = load_video_frames(&scene).expect("no-op");
        assert_eq!(out.root.children.len(), 1);
        let mut decoder = VideoDecoder::new();
        assert_eq!(
            decoder
                .resolve_scene(&scene)
                .expect("no-op")
                .root
                .children
                .len(),
            1
        );
    }
}
