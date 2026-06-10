//! `onda` — the command-line adapter for the engine.
//!
//! Per the charter, the scene graph is the universal language and the renderer
//! is the platform; this tool is just an adapter that turns a scene-graph JSON
//! document into a rendered image. Any producer of that JSON (a React
//! reconciler, an AI system, a hand-authored file) renders the same way.
//!
//! Usage:
//!   onda render <scene.json> <out.png> [--backend auto|vello|cpu] [--system-fonts]
//!   onda export <movie.json> <out.gif|out.mp4> [--backend ...] [--system-fonts]

use std::cell::RefCell;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use anyhow::{bail, Context, Result};
use kurbo::{Affine, Rect};
use onda_animation::{AnimatedScene, AudioTrack};
use onda_core::{Color, Size, Transform, Vec2};
use onda_renderer::{encode_gif, Framebuffer, Renderer};
use onda_scene::{
    Composition, Image, ImageData, ImageFit, Node, NodeKind, Scene, Shape, ShapeGeometry, Text,
};
use onda_typography::{FontContext, StyledRun};
use onda_vello::VelloRenderer;

/// Set by `--progress`: when true, the Vello render emits a `[onda-progress]{…}`
/// JSON line per frame on stdout (parsed by the @onda/node bridge for onProgress).
static EMIT_PROGRESS: AtomicBool = AtomicBool::new(false);

const USAGE: &str = "\
onda — render a scene-graph document to an image or video

USAGE:
    onda render <scene.json> <out.png>             Render one still
    onda export <movie.json> <out.gif|.mp4>        Render a scene + timeline
    onda export-frames <frames.json> <out.gif|.mp4>  Render pre-evaluated frames
    onda lint <frames.json> [out.json]             Geometry lint (text overflow,
                                                   off-canvas, tiny/huge text)
    onda render-frame <frames.json> <out.png>      Render ONE frame full-res
                                                   (--frame N); --crop a region
    onda contact-sheet <frames.json> <out.png>     Tile N frames + overlay the
                                                   lint's numbered problem boxes

    <scene.json>   a scene graph              (onda-scene JSON)
    <movie.json>   a scene graph + timeline   ({ \"scene\": ..., \"timeline\": ... })
    <frames.json>  an array of scene graphs   (e.g. @onda/react's renderFrames)

    .gif output is pure-Rust and always available; .mp4 needs ffmpeg on PATH.

OPTIONS:
    --backend <auto|vello|cpu>
                      Rendering backend. 'vello' is the GPU-native vector
                      renderer (anti-aliased fills/strokes, paths, gradients,
                      clips, rotation, crisp text). 'cpu' is the pure-Rust
                      rasterizer (tiny-skia: anti-aliased fills/strokes/
                      gradients/paths; no rotation or clip — those are Vello-
                      only). 'auto' (default) uses Vello when a GPU is
                      available, else falls back to CPU.
    --encoder <auto|videotoolbox|nvenc|qsv|libx264>
                      H.264 encoder for .mp4 output. 'auto' (default) uses a
                      hardware encoder if one works on this machine, else
                      libx264 — the portable, deterministic baseline.
    --progress        Emit a `[onda-progress]{...}` JSON line per rendered frame
                      on stdout (for tools driving the CLI, e.g. @onda/node).
    --system-fonts    Use the host's installed fonts instead of the bundled
                      default font (CPU backend only; output then depends on
                      the machine).
    --font <path>     Load a .ttf/.otf font, then select it by family name on a
                      <Text> run (like Remotion's loadFont). Repeat for several.
                      Works with both backends and alongside the bundled fonts.
    --frame <N>       For `render-frame`: which frame of the array (default 0).
    --crop <x,y,w,h>  For `render-frame`: write only this region (e.g. a lint
                      `box`), so a flagged area is read at full res, not upscaled.
    --pad <px>        For `render-frame`: grow --crop by this many px per side.
    --cells <N>       For `contact-sheet`: how many frames to tile (default 8).
    --cols <C>        For `contact-sheet`: grid columns (default 4).
    --cell-width <W>  For `contact-sheet`: thumbnail width in px (default 360).
    -h, --help        Print this help
    -V, --version     Print version
";

/// Which fonts the renderer should use.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FontMode {
    /// Bundled default font — deterministic, host-independent (the default).
    Bundled,
    /// The host's installed fonts.
    System,
}

/// The backend the user asked for. Resolved to an actual backend at render time
/// (`Auto` checks for a GPU).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum BackendChoice {
    /// Vello if a GPU is present, else CPU (the default).
    Auto,
    /// Force the Vello GPU backend; error if no GPU.
    Vello,
    /// Force the CPU reference rasterizer.
    Cpu,
}

/// The H.264 encoder the user asked for. `Auto` probes for a working hardware
/// encoder and falls back to libx264 (always available in the bundled ffmpeg).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum EncoderChoice {
    Auto,
    Videotoolbox,
    Nvenc,
    Qsv,
    Libx264,
}

/// A concrete encoder, resolved from an [`EncoderChoice`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Encoder {
    Videotoolbox,
    Nvenc,
    Qsv,
    Libx264,
}

impl Encoder {
    fn name(self) -> &'static str {
        match self {
            Encoder::Videotoolbox => "h264_videotoolbox",
            Encoder::Nvenc => "h264_nvenc",
            Encoder::Qsv => "h264_qsv",
            Encoder::Libx264 => "libx264",
        }
    }

    /// ffmpeg `-c:v` flags for an offline, quality-targeted export. Each maps to
    /// a CRF-like constant-quality mode (~visually lossless for motion graphics).
    fn video_args(self) -> Vec<&'static str> {
        match self {
            Encoder::Libx264 => {
                vec![
                    "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
                ]
            }
            // `-allow_sw 1` lets VideoToolbox use its software path on Macs with
            // no H.264 hardware block, so it always produces a file.
            Encoder::Videotoolbox => vec![
                "-c:v",
                "h264_videotoolbox",
                // VideoToolbox's quality scale is coarse + compresses high-entropy
                // content (film grain, bloom) hard; 55 starved premium exports
                // (~1.8 Mbps at 1080p). 68 gives grain/glow the bits to survive.
                "-q:v",
                "68",
                "-allow_sw",
                "1",
                "-pix_fmt",
                "yuv420p",
            ],
            Encoder::Nvenc => vec![
                "-c:v",
                "h264_nvenc",
                "-preset",
                "p7",
                "-rc",
                "vbr",
                "-cq",
                "19",
                "-b:v",
                "0",
                "-pix_fmt",
                "yuv420p",
            ],
            Encoder::Qsv => vec![
                "-c:v",
                "h264_qsv",
                "-preset",
                "veryslow",
                "-global_quality",
                "21",
                "-pix_fmt",
                "nv12",
            ],
        }
    }
}

/// Resolve a user choice to a concrete encoder (probing for hardware on `Auto`).
fn resolve_encoder(choice: EncoderChoice) -> Encoder {
    match choice {
        EncoderChoice::Auto => select_encoder(),
        EncoderChoice::Videotoolbox => Encoder::Videotoolbox,
        EncoderChoice::Nvenc => Encoder::Nvenc,
        EncoderChoice::Qsv => Encoder::Qsv,
        EncoderChoice::Libx264 => Encoder::Libx264,
    }
}

/// The best available encoder: a platform hardware encoder that passes a
/// one-frame trial, else libx264. Cached — the probe runs at most once.
fn select_encoder() -> Encoder {
    static CACHED: std::sync::OnceLock<Encoder> = std::sync::OnceLock::new();
    *CACHED.get_or_init(|| {
        let candidates: &[Encoder] = if cfg!(target_os = "macos") {
            &[Encoder::Videotoolbox]
        } else {
            &[Encoder::Nvenc, Encoder::Qsv]
        };
        candidates
            .iter()
            .copied()
            .find(|&enc| probe_encoder(enc))
            .unwrap_or(Encoder::Libx264)
    })
}

/// `ffmpeg -encoders` lists *compiled-in*, not *usable*, encoders — so actually
/// try a one-frame encode with the real flags. Exit 0 ⇒ the encoder works here.
fn probe_encoder(enc: Encoder) -> bool {
    let mut cmd = std::process::Command::new("ffmpeg");
    cmd.args([
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=c=black:s=64x64:r=1",
        "-frames:v",
        "1",
    ]);
    cmd.args(enc.video_args());
    cmd.args(["-f", "null", "-"]);
    cmd.stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    matches!(cmd.status(), Ok(s) if s.success())
}

fn main() {
    if let Err(err) = run(std::env::args().skip(1).collect()) {
        eprintln!("error: {err:#}");
        std::process::exit(1);
    }
}

fn run(args: Vec<String>) -> Result<()> {
    let Some(command) = args.first() else {
        print!("{USAGE}");
        return Ok(());
    };

    match command.as_str() {
        "-h" | "--help" | "help" => {
            print!("{USAGE}");
            Ok(())
        }
        "-V" | "--version" => {
            println!("onda {}", env!("CARGO_PKG_VERSION"));
            Ok(())
        }
        "render" => render_command(&args[1..]),
        "render-frame" => render_frame_command(&args[1..]),
        "contact-sheet" => contact_sheet_command(&args[1..]),
        "export" => export_command(&args[1..]),
        "export-frames" => export_frames_command(&args[1..]),
        "lint" => lint_command(&args[1..]),
        other => bail!("unknown command '{other}'\n\n{USAGE}"),
    }
}

/// The parsed CLI options shared by every command: the two positional paths, the
/// font mode + any `--font` files to load, and the backend choice.
struct Options {
    input: String,
    output: String,
    font: FontMode,
    backend: BackendChoice,
    /// The H.264 encoder for mp4 output (`auto` probes for hardware).
    encoder: EncoderChoice,
    /// Emit per-frame `[onda-progress]` JSON lines (for the Node bridge).
    progress: bool,
    /// Paths from `--font`, loaded and selectable by family on a `Text` run.
    fonts: Vec<PathBuf>,
    /// Motion-blur sub-frames per output frame (`export-frames` only): the input
    /// carries `K×` scenes and each group of `K` rendered frames is averaged into
    /// one output frame (temporal supersampling — a 180° shutter when the producer
    /// spread the sub-frames across half the frame). 1 = off (the default).
    motion_blur: u32,
}

/// Parse the shared `[--backend ...] [--system-fonts] [--font <path>]...` +
/// two positionals shape.
fn parse_io(args: &[String], verb: &str) -> Result<Options> {
    let mut positionals: Vec<&str> = Vec::new();
    let mut font = FontMode::Bundled;
    let mut backend = BackendChoice::Auto;
    let mut encoder = EncoderChoice::Auto;
    let mut progress = false;
    let mut fonts: Vec<PathBuf> = Vec::new();
    let mut motion_blur: u32 = 1;
    let mut iter = args.iter();
    while let Some(arg) = iter.next() {
        match arg.as_str() {
            "--system-fonts" => font = FontMode::System,
            "--progress" => progress = true,
            "--motion-blur" => {
                let value = iter
                    .next()
                    .with_context(|| format!("--motion-blur needs a value\n\n{USAGE}"))?;
                motion_blur = value
                    .parse::<u32>()
                    .ok()
                    .filter(|k| *k >= 1)
                    .with_context(|| {
                        format!("--motion-blur needs a positive integer\n\n{USAGE}")
                    })?;
            }
            "--encoder" => {
                let value = iter
                    .next()
                    .with_context(|| format!("--encoder needs a value\n\n{USAGE}"))?;
                encoder = match value.as_str() {
                    "auto" => EncoderChoice::Auto,
                    "videotoolbox" => EncoderChoice::Videotoolbox,
                    "nvenc" => EncoderChoice::Nvenc,
                    "qsv" => EncoderChoice::Qsv,
                    "libx264" => EncoderChoice::Libx264,
                    other => bail!(
                        "unknown encoder '{other}' — use auto, videotoolbox, nvenc, qsv, or libx264\n\n{USAGE}"
                    ),
                };
            }
            "--font" => {
                let value = iter
                    .next()
                    .with_context(|| format!("--font needs a file path\n\n{USAGE}"))?;
                fonts.push(PathBuf::from(value));
            }
            "--backend" => {
                let value = iter
                    .next()
                    .with_context(|| format!("--backend needs a value\n\n{USAGE}"))?;
                backend = match value.as_str() {
                    "auto" => BackendChoice::Auto,
                    "vello" | "gpu" => BackendChoice::Vello,
                    "cpu" => BackendChoice::Cpu,
                    other => {
                        bail!("unknown backend '{other}' — use auto, vello, or cpu\n\n{USAGE}")
                    }
                };
            }
            flag if flag.starts_with('-') => bail!("unknown option '{flag}'\n\n{USAGE}"),
            value => positionals.push(value),
        }
    }
    let [input, output] = positionals.as_slice() else {
        bail!("{verb} needs exactly an input and an output path\n\n{USAGE}");
    };
    Ok(Options {
        input: input.to_string(),
        output: output.to_string(),
        font,
        backend,
        encoder,
        progress,
        fonts,
        motion_blur,
    })
}

/// Read the `--font` files into raw bytes (so the renderer can load them).
fn load_font_bytes(paths: &[PathBuf]) -> Result<Vec<Vec<u8>>> {
    paths
        .iter()
        .map(|p| std::fs::read(p).with_context(|| format!("reading font '{}'", p.display())))
        .collect()
}

fn render_command(args: &[String]) -> Result<()> {
    let Options {
        input,
        output,
        font,
        backend,
        encoder: _,
        progress: _,
        fonts,
        motion_blur: _,
    } = parse_io(args, "render")?;
    let fonts = load_font_bytes(&fonts)?;
    let (width, height, used) =
        render_scene_file(Path::new(&input), Path::new(&output), font, backend, &fonts)?;
    println!("rendered {input} -> {output} ({width}x{height}, {used} backend)");
    Ok(())
}

/// `onda render-frame <frames.json> <out.png> [--frame N] [--crop x,y,w,h] [--pad P]`
/// — render ONE frame of a pre-evaluated array at full resolution (the agent-vision
/// Layer 2 zoom). With `--crop` it writes only that sub-rectangle (a lint `box`),
/// optionally `--pad`-ded, so the agent inspects a flagged region at native res
/// instead of upscaling the whole frame. Same pre-passes + backends as `render`.
fn render_frame_command(args: &[String]) -> Result<()> {
    let mut input: Option<&str> = None;
    let mut output: Option<&str> = None;
    let mut frame: usize = 0;
    let mut crop: Option<[u32; 4]> = None;
    let mut pad: u32 = 0;
    let mut font = FontMode::Bundled;
    let mut backend = BackendChoice::Auto;
    let mut font_paths: Vec<PathBuf> = Vec::new();
    let mut iter = args.iter();
    while let Some(arg) = iter.next() {
        match arg.as_str() {
            "--system-fonts" => font = FontMode::System,
            "--frame" => {
                let v = iter
                    .next()
                    .with_context(|| format!("--frame needs an index\n\n{USAGE}"))?;
                frame = v
                    .trim()
                    .parse()
                    .with_context(|| format!("--frame '{v}' is not a frame index"))?;
            }
            "--crop" => {
                let v = iter
                    .next()
                    .with_context(|| format!("--crop needs x,y,w,h\n\n{USAGE}"))?;
                let nums: Vec<u32> = v.split(',').filter_map(|s| s.trim().parse().ok()).collect();
                let [x, y, w, h] = nums.as_slice() else {
                    bail!(
                        "--crop wants four comma-separated numbers x,y,w,h (got '{v}')\n\n{USAGE}"
                    );
                };
                crop = Some([*x, *y, *w, *h]);
            }
            "--pad" => {
                let v = iter
                    .next()
                    .with_context(|| format!("--pad needs a pixel count\n\n{USAGE}"))?;
                pad = v
                    .trim()
                    .parse()
                    .with_context(|| format!("--pad '{v}' is not a number"))?;
            }
            "--backend" => {
                let v = iter
                    .next()
                    .with_context(|| format!("--backend needs a value\n\n{USAGE}"))?;
                backend = match v.as_str() {
                    "auto" => BackendChoice::Auto,
                    "vello" | "gpu" => BackendChoice::Vello,
                    "cpu" => BackendChoice::Cpu,
                    other => {
                        bail!("unknown backend '{other}' — use auto, vello, or cpu\n\n{USAGE}")
                    }
                };
            }
            "--font" => {
                let v = iter
                    .next()
                    .with_context(|| format!("--font needs a path\n\n{USAGE}"))?;
                font_paths.push(PathBuf::from(v));
            }
            other if other.starts_with("--") => bail!("unknown flag '{other}'\n\n{USAGE}"),
            other if input.is_none() => input = Some(other),
            other if output.is_none() => output = Some(other),
            other => bail!("unexpected argument '{other}'\n\n{USAGE}"),
        }
    }
    let input =
        input.with_context(|| format!("render-frame needs a frames.json input\n\n{USAGE}"))?;
    let output =
        output.with_context(|| format!("render-frame needs an output .png path\n\n{USAGE}"))?;
    let json =
        std::fs::read_to_string(input).with_context(|| format!("reading frames file '{input}'"))?;
    let scenes: Vec<Scene> =
        serde_json::from_str(&json).context("frames JSON is not an array of scene graphs")?;
    let total = scenes.len();
    let scene = scenes
        .get(frame)
        .with_context(|| format!("frame {frame} is out of range (0..{total})"))?;

    // Same pre-passes as `onda render`, so the zoomed frame is faithful.
    let base_dir = Path::new(input).parent().unwrap_or_else(|| Path::new(""));
    let scene = onda_svg::expand_svg(scene, base_dir).context("expanding <svg> nodes")?;
    #[cfg(feature = "video")]
    let scene = onda_video::load_video_frames(&scene).context("decoding video frames")?;
    let scene = onda_image::load_images(&scene, base_dir).context("loading images")?;

    let extra_fonts = load_font_bytes(&font_paths)?;
    let (mut frames, used) =
        render_scenes(std::slice::from_ref(&scene), backend, font, &extra_fonts)
            .with_context(|| format!("rendering frame {frame}"))?;
    let mut fb = frames.remove(0);
    let (fw, fh) = (fb.width(), fb.height());

    let crop_desc = if let Some([x, y, w, h]) = crop {
        // Grow by `pad`, clamp to the frame; a region fully outside is an error.
        let x0 = x.saturating_sub(pad);
        let y0 = y.saturating_sub(pad);
        let x1 = x.saturating_add(w).saturating_add(pad).min(fw);
        let y1 = y.saturating_add(h).saturating_add(pad).min(fh);
        if x0 >= x1 || y0 >= y1 {
            bail!("--crop {x},{y},{w},{h} is entirely outside the {fw}x{fh} frame");
        }
        fb = fb.crop(x0, y0, x1 - x0, y1 - y0);
        format!(", crop [{x0},{y0},{},{}]", x1 - x0, y1 - y0)
    } else {
        String::new()
    };

    fb.write_png(output)
        .with_context(|| format!("writing PNG '{output}'"))?;
    println!(
        "rendered frame {frame} -> {output} ({}x{}, {used} backend{crop_desc})",
        fb.width(),
        fb.height()
    );
    Ok(())
}

// ---- contact sheet (agent-vision Layer 1) -------------------------------------

/// A translate-only transform (the sheet positions everything absolutely).
fn at(x: f32, y: f32) -> Transform {
    Transform {
        translate: Vec2::new(x, y),
        ..Transform::IDENTITY
    }
}

/// A text node at `(x, y)`.
fn sheet_text(content: impl Into<String>, x: f32, y: f32, size: f32, color: Color) -> Node {
    Node::new(NodeKind::Text(
        Text::new(content).with_font_size(size).with_color(color),
    ))
    .with_transform(at(x, y))
}

/// A solid-filled rect at `(x, y)`.
fn sheet_fill(x: f32, y: f32, w: f32, h: f32, color: Color) -> Node {
    Node::new(NodeKind::Shape(
        Shape::rect(Size::new(w, h)).with_fill(color),
    ))
    .with_transform(at(x, y))
}

/// A stroked (outline-only) rect at `(x, y)`.
fn sheet_stroke(x: f32, y: f32, w: f32, h: f32, color: Color, width: f32) -> Node {
    Node::new(NodeKind::Shape(
        Shape::rect(Size::new(w.max(1.0), h.max(1.0))).with_stroke(color, width),
    ))
    .with_transform(at(x, y))
}

/// An already-rendered frame embedded as an `Image` node, scaled into a `w×h`
/// cell — the engine does the downscale (we dogfood our own image path).
fn sheet_image(fb: &Framebuffer, x: f32, y: f32, w: f32, h: f32) -> Node {
    let data = ImageData {
        width: fb.width(),
        height: fb.height(),
        rgba: Arc::new(fb.as_bytes().to_vec()),
    };
    Node::new(NodeKind::Image(
        Image::new("mem://frame")
            .with_data(data)
            .with_box(w, h, ImageFit::Fill),
    ))
    .with_transform(at(x, y))
}

/// `onda contact-sheet <frames.json> <out.png> [--cells N] [--cols C] [--cell-width W]`
/// — agent-vision Layer 1: tile N sampled frames into ONE labeled image and overlay
/// the Layer-0 lint's problem boxes as numbered Set-of-Mark chips. The gestalt view
/// (hierarchy, pacing, color) the structural lint can't judge. The sheet is itself a
/// composition of Image+Text+Shape nodes, rendered by the engine.
fn contact_sheet_command(args: &[String]) -> Result<()> {
    let mut input: Option<&str> = None;
    let mut output: Option<&str> = None;
    let mut cells: usize = 8;
    let mut cols: usize = 4;
    let mut cell_width: f32 = 360.0;
    let mut font = FontMode::Bundled;
    let mut backend = BackendChoice::Auto;
    let mut font_paths: Vec<PathBuf> = Vec::new();
    let mut iter = args.iter();
    while let Some(arg) = iter.next() {
        match arg.as_str() {
            "--system-fonts" => font = FontMode::System,
            "--cells" => {
                let v = iter
                    .next()
                    .with_context(|| format!("--cells needs a value\n\n{USAGE}"))?;
                cells = v
                    .trim()
                    .parse::<usize>()
                    .with_context(|| format!("--cells '{v}' is not a number"))?
                    .max(1);
            }
            "--cols" => {
                let v = iter
                    .next()
                    .with_context(|| format!("--cols needs a value\n\n{USAGE}"))?;
                cols = v
                    .trim()
                    .parse::<usize>()
                    .with_context(|| format!("--cols '{v}' is not a number"))?
                    .max(1);
            }
            "--cell-width" => {
                let v = iter
                    .next()
                    .with_context(|| format!("--cell-width needs a value\n\n{USAGE}"))?;
                cell_width = v
                    .trim()
                    .parse::<f32>()
                    .with_context(|| format!("--cell-width '{v}' is not a number"))?
                    .max(32.0);
            }
            "--backend" => {
                let v = iter
                    .next()
                    .with_context(|| format!("--backend needs a value\n\n{USAGE}"))?;
                backend = match v.as_str() {
                    "auto" => BackendChoice::Auto,
                    "vello" | "gpu" => BackendChoice::Vello,
                    "cpu" => BackendChoice::Cpu,
                    other => {
                        bail!("unknown backend '{other}' — use auto, vello, or cpu\n\n{USAGE}")
                    }
                };
            }
            "--font" => {
                let v = iter
                    .next()
                    .with_context(|| format!("--font needs a path\n\n{USAGE}"))?;
                font_paths.push(PathBuf::from(v));
            }
            other if other.starts_with("--") => bail!("unknown flag '{other}'\n\n{USAGE}"),
            other if input.is_none() => input = Some(other),
            other if output.is_none() => output = Some(other),
            other => bail!("unexpected argument '{other}'\n\n{USAGE}"),
        }
    }
    let input =
        input.with_context(|| format!("contact-sheet needs a frames.json input\n\n{USAGE}"))?;
    let output =
        output.with_context(|| format!("contact-sheet needs an output .png path\n\n{USAGE}"))?;
    let json =
        std::fs::read_to_string(input).with_context(|| format!("reading frames file '{input}'"))?;
    let scenes: Vec<Scene> =
        serde_json::from_str(&json).context("frames JSON is not an array of scene graphs")?;
    if scenes.is_empty() {
        bail!("no frames to tile");
    }

    let extra_fonts = load_font_bytes(&font_paths)?;
    let samples = even_samples(scenes.len(), cells);
    let cols = cols.min(samples.len()).max(1);
    let rows = samples.len().div_ceil(cols);

    // Layer 0 on the same sampled frames, so a mark's `frame` lands in a tile.
    let fonts = RefCell::new(measure_font_context(font, &extra_fonts));
    let diags = lint_scenes(&scenes, &samples, &fonts);

    // All tiles share the composition's aspect, so Fill scales without distortion.
    let comp = &scenes[0].composition;
    let (comp_w, comp_h) = (comp.width as f32, comp.height as f32);
    let cell_w = cell_width;
    let cell_h = (cell_w * comp_h / comp_w).round();
    let scale = cell_w / comp_w;

    let (margin, gutter, label_h) = (24.0_f32, 16.0_f32, 26.0_f32);
    let block_h = label_h + cell_h;
    let sheet_w = margin * 2.0 + cols as f32 * cell_w + (cols as f32 - 1.0) * gutter;
    let sheet_h = margin * 2.0 + rows as f32 * block_h + (rows as f32 - 1.0) * gutter;
    let cell_origin = |c: usize| -> (f32, f32) {
        let (col, row) = (c % cols, c / cols);
        (
            margin + col as f32 * (cell_w + gutter),
            margin + row as f32 * (block_h + gutter),
        )
    };

    // Render the sampled frames (pre-passed like `onda render`) in one batch.
    let base_dir = Path::new(input).parent().unwrap_or_else(|| Path::new(""));
    let prepped: Vec<Scene> = samples
        .iter()
        .map(|&s| {
            let scene = onda_svg::expand_svg(&scenes[s], base_dir).context("expanding <svg>")?;
            #[cfg(feature = "video")]
            let scene = onda_video::load_video_frames(&scene).context("decoding video")?;
            onda_image::load_images(&scene, base_dir).context("loading images")
        })
        .collect::<Result<_>>()?;
    let (fbs, used) = render_scenes(&prepped, backend, font, &extra_fonts)
        .context("rendering frames for the contact sheet")?;

    // Build the sheet as a scene graph: background, then per cell a label + the
    // scaled frame + a hairline border.
    let mut children = vec![sheet_fill(
        0.0,
        0.0,
        sheet_w,
        sheet_h,
        Color::rgb(0.078, 0.094, 0.122),
    )];
    let mut frame_cell = std::collections::HashMap::new();
    for (c, &s) in samples.iter().enumerate() {
        frame_cell.insert(s, c);
        let (cx, cy) = cell_origin(c);
        children.push(sheet_text(
            format!("frame {s}"),
            cx,
            cy + 4.0,
            15.0,
            Color::rgb(0.78, 0.83, 0.9),
        ));
        children.push(sheet_image(&fbs[c], cx, cy + label_h, cell_w, cell_h));
        children.push(sheet_stroke(
            cx,
            cy + label_h,
            cell_w,
            cell_h,
            Color::rgb(0.2, 0.24, 0.3),
            1.0,
        ));
    }

    // Overlay each diagnostic as a numbered Set-of-Mark chip on its tile.
    let mut legend: Vec<String> = Vec::new();
    for (i, d) in diags.iter().enumerate() {
        let mark = i + 1;
        let frame = d["frame"].as_u64().unwrap_or(0) as usize;
        let Some(&c) = frame_cell.get(&frame) else {
            continue;
        };
        let b = &d["box"];
        let (bx, by, bw, bh) = (
            b[0].as_f64().unwrap_or(0.0) as f32,
            b[1].as_f64().unwrap_or(0.0) as f32,
            b[2].as_f64().unwrap_or(0.0) as f32,
            b[3].as_f64().unwrap_or(0.0) as f32,
        );
        let (cx, cy) = cell_origin(c);
        let (ix, iy) = (cx, cy + label_h);
        // Clamp the mapped box to the tile so an off-canvas element still marks.
        let x = (ix + bx * scale).clamp(ix, ix + cell_w);
        let y = (iy + by * scale).clamp(iy, iy + cell_h);
        let w = (bw * scale).min(ix + cell_w - x).max(2.0);
        let h = (bh * scale).min(iy + cell_h - y).max(2.0);
        let color = if d["level"].as_str() == Some("info") {
            Color::rgb(0.36, 0.6, 1.0)
        } else {
            Color::rgb(1.0, 0.75, 0.2)
        };
        children.push(sheet_stroke(x, y, w, h, color, 2.0));
        let chip = 17.0;
        children.push(sheet_fill(x, y, chip, chip, color));
        children.push(sheet_text(
            mark.to_string(),
            x + 4.0,
            y + 1.0,
            12.0,
            Color::rgb(0.05, 0.06, 0.08),
        ));
        legend.push(format!(
            "  [{mark}] frame {frame} · {} — {}",
            d["issue"].as_str().unwrap_or("?"),
            d["message"].as_str().unwrap_or("")
        ));
    }

    let mut sheet = Scene::new(Composition::new(
        sheet_w as u32,
        sheet_h as u32,
        comp.fps,
        1,
    ));
    sheet.root = Node::new(NodeKind::Group).with_children(children);
    let (mut sheet_fb, _) =
        render_scenes(std::slice::from_ref(&sheet), backend, font, &extra_fonts)
            .context("rendering the contact sheet")?;
    sheet_fb
        .remove(0)
        .write_png(output)
        .with_context(|| format!("writing PNG '{output}'"))?;

    println!(
        "contact sheet -> {output} ({}x{}, {} frames, {} mark(s), {used} backend)",
        sheet_w as u32,
        sheet_h as u32,
        samples.len(),
        diags.len()
    );
    if !legend.is_empty() {
        println!("marks:");
        for l in &legend {
            println!("{l}");
        }
    }
    Ok(())
}

fn export_command(args: &[String]) -> Result<()> {
    let Options {
        input,
        output,
        font,
        backend,
        encoder,
        progress,
        fonts,
        motion_blur: _,
    } = parse_io(args, "export")?;
    let fonts = load_font_bytes(&fonts)?;
    EMIT_PROGRESS.store(progress, Ordering::Relaxed);
    let out = Path::new(&output);

    let json =
        std::fs::read_to_string(&input).with_context(|| format!("reading movie file '{input}'"))?;
    let movie = movie_scenes(&json, base_dir_of(&input))
        .with_context(|| format!("reading movie '{input}'"))?;
    let (frames, used) = render_scenes(&movie.scenes, backend, font, &fonts)
        .with_context(|| format!("rendering movie '{input}'"))?;
    let audio = AudioMux {
        tracks: &movie.audio,
        base_dir: base_dir_of(&input),
        duration_secs: movie.duration_secs,
    };
    encode_movie(
        &frames, movie.fps, out, &output, &input, used, encoder, audio,
    )
}

/// Encode pre-rendered, per-frame scenes (e.g. emitted by @onda/react's
/// `renderFrames`) to a video. Input is a JSON array of scene graphs.
fn export_frames_command(args: &[String]) -> Result<()> {
    let Options {
        input,
        output,
        font,
        backend,
        encoder,
        progress,
        fonts,
        motion_blur,
    } = parse_io(args, "export-frames")?;
    let fonts = load_font_bytes(&fonts)?;
    EMIT_PROGRESS.store(progress, Ordering::Relaxed);
    let out = Path::new(&output);

    let json = std::fs::read_to_string(&input)
        .with_context(|| format!("reading frames file '{input}'"))?;

    // mp4 streams (render+pipe in bounded-memory chunks — long videos that would
    // OOM if every frame were buffered). gif needs every frame, so it stays
    // buffered (gifs are short). Motion blur also needs every frame buffered (it
    // averages K consecutive sub-frames), so it skips the streaming path.
    let is_mp4 = out
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("mp4"));
    if is_mp4 && motion_blur <= 1 {
        return stream_frames_to_mp4(
            &json,
            &input,
            &output,
            out,
            base_dir_of(&input),
            backend,
            font,
            &fonts,
            encoder,
        );
    }

    let (scenes, fps) = frames_scenes(&json, base_dir_of(&input))
        .with_context(|| format!("reading frames '{input}'"))?;
    let (mut frames, used) = render_scenes(&scenes, backend, font, &fonts)
        .with_context(|| format!("rendering frames '{input}'"))?;

    // Motion blur (temporal supersampling): the producer emitted K sub-frames per
    // output frame, spread across the shutter; average each group of K into one
    // frame. Straight-alpha RGBA mean — exact for the opaque frames a full-bleed
    // composition produces (every pixel alpha 1), where premultiplied == straight.
    if motion_blur > 1 {
        let k = motion_blur as usize;
        if frames.is_empty() || frames.len() % k != 0 {
            bail!(
                "--motion-blur {k}: got {} rendered frame(s), not a positive multiple of {k} \
                 (the producer must emit exactly K sub-frames per output frame)",
                frames.len()
            );
        }
        frames = average_frame_groups(&frames, k);
    }

    // Mux any <Audio> nodes carried in the scene (the soundtrack). Under motion
    // blur the scene list is K× oversampled, so collect from the output-frame
    // scenes (every K-th) to avoid K-fold duplicate tracks.
    let audio_owned: Vec<Scene>;
    let audio_scenes: &[Scene] = if motion_blur > 1 {
        audio_owned = scenes
            .iter()
            .step_by(motion_blur as usize)
            .cloned()
            .collect();
        &audio_owned
    } else {
        &scenes
    };
    let audio_tracks = collect_audio_tracks(audio_scenes, fps);
    let base_dir = base_dir_of(&input);
    let duration_secs = frames.len() as f32 / fps.max(1.0);
    let audio = if audio_tracks.is_empty() {
        AudioMux::none()
    } else {
        AudioMux {
            tracks: &audio_tracks,
            base_dir,
            duration_secs,
        }
    };
    encode_movie(&frames, fps, out, &output, &input, used, encoder, audio)
}

/// Average each consecutive group of `k` framebuffers into one — temporal
/// supersampling for motion blur. All frames share dimensions; `k` divides the
/// count (the caller guarantees both). Accumulates each RGBA byte in a `u32` and
/// rounds the mean (straight-alpha; exact for the opaque output a full-bleed
/// composition produces).
fn average_frame_groups(frames: &[Framebuffer], k: usize) -> Vec<Framebuffer> {
    frames
        .chunks(k)
        .map(|group| {
            let (w, h) = (group[0].width(), group[0].height());
            let n = (w as usize) * (h as usize) * 4;
            let mut acc = vec![0u32; n];
            for fb in group {
                for (a, &b) in acc.iter_mut().zip(fb.as_bytes()) {
                    *a += b as u32;
                }
            }
            let k = k as u32;
            let half = k / 2;
            let pixels: Vec<u8> = acc.iter().map(|&s| ((s + half) / k) as u8).collect();
            Framebuffer::from_rgba(w, h, pixels)
        })
        .collect()
}

/// `onda lint` — the structural geometry lint (agent-vision Layer 0). The engine
/// MEASURES what a vision model can't reliably see — text overflowing the canvas,
/// elements off-canvas, illegibly tiny / huge text — over the LAID-OUT scene
/// (taffy resolved, text shaped), grounded to a box + a fix. Emits a JSON
/// `Diagnostic[]` an agent reads (cheap, deterministic) before it ever looks at a
/// pixel. Samples a handful of frames (default 8 evenly spaced, or `--at a,b,c`).
fn lint_command(args: &[String]) -> Result<()> {
    let mut input: Option<&str> = None;
    let mut output: Option<&str> = None;
    let mut at: Option<Vec<usize>> = None;
    let mut font = FontMode::Bundled;
    let mut font_paths: Vec<PathBuf> = Vec::new();
    let mut iter = args.iter();
    while let Some(arg) = iter.next() {
        match arg.as_str() {
            "--system-fonts" => font = FontMode::System,
            "--at" => {
                let v = iter.next().with_context(|| {
                    format!("--at needs frame indices, e.g. --at 0,30,60\n\n{USAGE}")
                })?;
                at = Some(
                    v.split(',')
                        .filter_map(|s| s.trim().parse::<usize>().ok())
                        .collect(),
                );
            }
            "--font" => {
                let p = iter
                    .next()
                    .with_context(|| format!("--font needs a path\n\n{USAGE}"))?;
                font_paths.push(PathBuf::from(p));
            }
            other if other.starts_with("--") => bail!("unknown flag '{other}'\n\n{USAGE}"),
            other if input.is_none() => input = Some(other),
            other if output.is_none() => output = Some(other),
            other => bail!("unexpected argument '{other}'\n\n{USAGE}"),
        }
    }
    let input = input.with_context(|| format!("lint needs a frames.json input\n\n{USAGE}"))?;
    let json =
        std::fs::read_to_string(input).with_context(|| format!("reading frames file '{input}'"))?;
    let scenes: Vec<Scene> =
        serde_json::from_str(&json).context("frames JSON is not an array of scene graphs")?;
    if scenes.is_empty() {
        bail!("no scenes to lint");
    }
    let extra_fonts = load_font_bytes(&font_paths)?;
    let samples = at.unwrap_or_else(|| even_samples(scenes.len(), 8));
    let fonts = RefCell::new(measure_font_context(font, &extra_fonts));
    let diags = lint_scenes(&scenes, &samples, &fonts);
    let out_json = serde_json::to_string_pretty(&diags).context("serializing diagnostics")?;
    match output {
        Some(path) => {
            std::fs::write(path, &out_json).with_context(|| format!("writing '{path}'"))?;
            eprintln!("lint: {} diagnostic(s) -> {path}", diags.len());
        }
        None => println!("{out_json}"),
    }
    Ok(())
}

/// `k` evenly-spaced frame indices across `len` (the midpoints of `k` slices).
fn even_samples(len: usize, k: usize) -> Vec<usize> {
    if len == 0 {
        return Vec::new();
    }
    let k = k.clamp(1, len);
    (0..k)
        .map(|i| (((i as f32 + 0.5) * len as f32 / k as f32) as usize).min(len - 1))
        .collect()
}

/// Geometry-lint the sampled scenes (laid out + text-shaped). Precision-tuned:
/// full-bleed backgrounds, rotated elements, and animation transients (a slide-in
/// off-canvas, a momentary scale spike) are NOT flagged — an issue survives only
/// if it PERSISTS across a majority of the sampled frames where its element
/// appears. Findings are gathered raw, then [`finalize_diags`] applies that filter.
fn lint_scenes(
    scenes: &[Scene],
    samples: &[usize],
    fonts: &RefCell<FontContext>,
) -> Vec<serde_json::Value> {
    let mut raws: Vec<Raw> = Vec::new();
    // How many sampled frames each element (by stable tree-path identity) appears
    // in — the denominator of the "is this issue persistent?" test.
    let mut visited: std::collections::HashMap<String, u32> = std::collections::HashMap::new();
    for &i in samples {
        let Some(scene) = scenes.get(i) else {
            continue;
        };
        // Resolve flex layout so element boxes are absolute (the whole point —
        // the renderer's positions, not the unlaid authoring tree).
        let laid = if scene_has_layout(scene) {
            let measure = |t: &Text| measure_text(&mut fonts.borrow_mut(), t);
            onda_layout::layout(scene, &measure)
        } else {
            scene.clone()
        };
        let (cw, ch) = (
            laid.composition.width as f32,
            laid.composition.height as f32,
        );
        lint_walk(
            &laid.root,
            Affine::IDENTITY,
            "0",
            cw,
            ch,
            i,
            fonts,
            &mut raws,
            &mut visited,
        );
    }
    finalize_diags(raws, &visited)
}

/// A raw, per-frame finding — before the persistence filter decides to keep it.
struct Raw {
    path: String,
    label: String,
    issue: &'static str,
    level: &'static str,
    bbox: [f32; 4],
    message: String,
    fix: &'static str,
    frame: usize,
    /// How bad this occurrence is (bigger = worse); picks the representative row.
    severity: f32,
}

/// The node's affine, matching the Vello backend EXACTLY (TRS about `origin`:
/// translate · originPivot · rotate[deg] · scale) so the lint's geometry is the
/// geometry that actually renders — including rotation + transform-origin, which
/// the CPU reference drops/folds.
fn to_affine(t: &Transform) -> Affine {
    let (ox, oy) = (t.origin.x as f64, t.origin.y as f64);
    Affine::translate((t.translate.x as f64, t.translate.y as f64))
        * Affine::translate((ox, oy))
        * Affine::rotate((t.rotate as f64).to_radians())
        * Affine::scale_non_uniform(t.scale.x as f64, t.scale.y as f64)
        * Affine::translate((-ox, -oy))
}

#[allow(clippy::too_many_arguments)]
fn lint_walk(
    node: &Node,
    parent: Affine,
    path: &str,
    cw: f32,
    ch: f32,
    frame: usize,
    fonts: &RefCell<FontContext>,
    raws: &mut Vec<Raw>,
    visited: &mut std::collections::HashMap<String, u32>,
) {
    // Compose down the tree the way the renderer does (parent · local), so a box
    // here is where the pixels land — rotation and nested transforms included.
    let affine = parent * to_affine(&node.transform);
    // Effective vertical scale = length of the y-basis vector (c,d) — captures
    // non-uniform scale and stays 1.0 under pure rotation (text keeps its size).
    let [_, _, c, d, _, _] = affine.as_coeffs();
    let vscale = (c * c + d * d).sqrt() as f32;
    match &node.kind {
        NodeKind::Text(text) => {
            let size = measure_text(&mut fonts.borrow_mut(), text);
            let bbox = affine.transform_rect_bbox(Rect::new(
                0.0,
                0.0,
                size.width as f64,
                size.height as f64,
            ));
            let label = text_label(text);
            mark_visited(visited, path, &label);
            let eff = text.font_size * vscale;
            if eff > 0.0 && eff < 12.0 {
                record(
                    raws,
                    frame,
                    path,
                    "TINY_TEXT",
                    "warning",
                    &label,
                    rect_xywh(bbox),
                    format!("text \"{label}\" renders at ~{eff:.0}px — likely illegible (< 12px)"),
                    "increase the font size",
                    12.0 - eff,
                );
            } else if eff > 200.0 {
                record(
                    raws,
                    frame,
                    path,
                    "HUGE_TEXT",
                    "info",
                    &label,
                    rect_xywh(bbox),
                    format!("text \"{label}\" renders at ~{eff:.0}px — very large (> 200px)"),
                    "reduce the font size if this is unintended",
                    eff,
                );
            }
            check_bounds(raws, frame, path, &label, true, bbox, cw, ch);
        }
        NodeKind::Shape(shape) => {
            if let Some((w0, h0)) = shape_size(&shape.geometry) {
                mark_visited(visited, path, "shape");
                let bbox = affine.transform_rect_bbox(Rect::new(0.0, 0.0, w0 as f64, h0 as f64));
                check_bounds(raws, frame, path, "shape", false, bbox, cw, ch);
            }
        }
        NodeKind::Image(im) => {
            if let (Some(w0), Some(h0)) = (im.width, im.height) {
                mark_visited(visited, path, "image");
                let bbox = affine.transform_rect_bbox(Rect::new(0.0, 0.0, w0 as f64, h0 as f64));
                check_bounds(raws, frame, path, "image", false, bbox, cw, ch);
            }
        }
        NodeKind::Video(v) => {
            if let (Some(w0), Some(h0)) = (v.width, v.height) {
                mark_visited(visited, path, "video");
                let bbox = affine.transform_rect_bbox(Rect::new(0.0, 0.0, w0 as f64, h0 as f64));
                check_bounds(raws, frame, path, "video", false, bbox, cw, ch);
            }
        }
        _ => {}
    }
    for (i, child) in node.children.iter().enumerate() {
        let child_path = format!("{path}/{i}");
        lint_walk(
            child,
            affine,
            &child_path,
            cw,
            ch,
            frame,
            fonts,
            raws,
            visited,
        );
    }
}

/// A kurbo `Rect` as the diagnostic's `[x, y, w, h]` (top-left + size).
fn rect_xywh(r: Rect) -> [f32; 4] {
    [
        r.x0 as f32,
        r.y0 as f32,
        r.width() as f32,
        r.height() as f32,
    ]
}

/// Count one sampled-frame appearance of an element (stable `path|label` identity).
fn mark_visited(visited: &mut std::collections::HashMap<String, u32>, path: &str, label: &str) {
    *visited.entry(format!("{path}|{label}")).or_insert(0) += 1;
}

/// Record an element whose rendered AABB extends meaningfully (> 8px) beyond the
/// canvas — unless it's a full-bleed background (its overhang is intentional). The
/// `bbox` is already the true post-transform AABB (rotation included), so this is
/// the box the renderer actually paints.
#[allow(clippy::too_many_arguments)]
fn check_bounds(
    raws: &mut Vec<Raw>,
    frame: usize,
    path: &str,
    label: &str,
    is_text: bool,
    bbox: Rect,
    cw: f32,
    ch: f32,
) {
    const TOL: f64 = 8.0;
    let (cw, ch) = (cw as f64, ch as f64);
    // A non-text element whose box CONTAINS the whole canvas is a full-bleed
    // background / cover fill, not a drifting element — its overhang is intentional.
    let covers = bbox.x0 <= TOL && bbox.y0 <= TOL && bbox.x1 >= cw - TOL && bbox.y1 >= ch - TOL;
    if !is_text && covers {
        return;
    }
    let (over_r, over_l, over_b, over_t) = (bbox.x1 - cw, -bbox.x0, bbox.y1 - ch, -bbox.y0);
    let max_over = over_r.max(over_l).max(over_b).max(over_t);
    if max_over <= TOL {
        return;
    }
    let (x, y, w, h) = (bbox.x0, bbox.y0, bbox.width(), bbox.height());
    // A text node spilling off the right/bottom (and not the left/top) reads as an
    // overflow (too wide / too big); anything else is a positioning problem.
    let overflow = is_text && over_l <= TOL && over_t <= TOL && (over_r > TOL || over_b > TOL);
    if overflow {
        record(
            raws,
            frame,
            path,
            "TEXT_OVERFLOW",
            "warning",
            label,
            rect_xywh(bbox),
            format!(
                "text \"{label}\" ({w:.0}px wide) extends {max_over:.0}px past the canvas edge"
            ),
            "reduce its font size or width, or move it inward",
            max_over as f32,
        );
    } else {
        record(
            raws,
            frame,
            path,
            "OFF_CANVAS",
            "warning",
            label,
            rect_xywh(bbox),
            format!("{label} (box {x:.0},{y:.0} {w:.0}×{h:.0}) is {max_over:.0}px off-canvas"),
            "reposition it within the composition bounds",
            max_over as f32,
        );
    }
}

/// Stash a raw per-frame finding for [`finalize_diags`] to weigh.
#[allow(clippy::too_many_arguments)]
fn record(
    raws: &mut Vec<Raw>,
    frame: usize,
    path: &str,
    issue: &'static str,
    level: &'static str,
    label: &str,
    bbox: [f32; 4],
    message: String,
    fix: &'static str,
    severity: f32,
) {
    raws.push(Raw {
        path: path.to_string(),
        label: label.to_string(),
        issue,
        level,
        bbox,
        message,
        fix,
        frame,
        severity,
    });
}

/// The persistence filter: keep an (issue, element) only if it was flagged in MORE
/// THAN HALF of the sampled frames where that element appears — so a transient
/// (slide-in off-canvas, a one-frame scale spike) drops out while a steady defect
/// stays. Each surviving group reports its worst (max-severity) occurrence once,
/// in deterministic (frame, issue, label) order.
fn finalize_diags(
    raws: Vec<Raw>,
    visited: &std::collections::HashMap<String, u32>,
) -> Vec<serde_json::Value> {
    use std::collections::{HashMap, HashSet};
    // group key -> (distinct frames flagged, index of the worst raw seen)
    let mut groups: HashMap<String, (HashSet<usize>, usize)> = HashMap::new();
    for (idx, r) in raws.iter().enumerate() {
        let key = format!("{}|{}|{}", r.issue, r.path, r.label);
        let g = groups.entry(key).or_insert_with(|| (HashSet::new(), idx));
        g.0.insert(r.frame);
        if r.severity > raws[g.1].severity {
            g.1 = idx;
        }
    }
    let mut kept: Vec<&Raw> = groups
        .values()
        .filter_map(|(frames, best)| {
            let r = &raws[*best];
            let denom = *visited
                .get(&format!("{}|{}", r.path, r.label))
                .unwrap_or(&1);
            (frames.len() as f32 > 0.5 * denom as f32).then_some(r)
        })
        .collect();
    kept.sort_by(|a, b| {
        a.frame
            .cmp(&b.frame)
            .then_with(|| a.issue.cmp(b.issue))
            .then_with(|| a.label.cmp(&b.label))
    });
    kept.into_iter()
        .map(|r| {
            serde_json::json!({
                "level": r.level,
                "issue": r.issue,
                "frame": r.frame,
                "label": r.label,
                "box": r.bbox,
                "message": r.message,
                "fix": r.fix,
            })
        })
        .collect()
}

/// The width/height of a shape with a finite box (rect/ellipse); `None` for paths.
fn shape_size(geometry: &ShapeGeometry) -> Option<(f32, f32)> {
    match geometry {
        ShapeGeometry::Rect { size, .. } | ShapeGeometry::Ellipse { size } => {
            Some((size.width, size.height))
        }
        ShapeGeometry::Path { .. } | ShapeGeometry::Boolean { .. } => None,
    }
}

/// A short display label for a text node (its content, or concatenated runs).
fn text_label(text: &Text) -> String {
    let s = if text.content.is_empty() {
        text.runs
            .iter()
            .map(|r| r.text.as_str())
            .collect::<String>()
    } else {
        text.content.clone()
    };
    if s.chars().count() > 32 {
        format!("{}…", s.chars().take(31).collect::<String>())
    } else {
        s
    }
}

/// Collect the soundtrack from a pre-evaluated frame sequence: every
/// `NodeKind::Audio` node in the first frame (audio nodes are static across
/// frames). Skips non-file srcs (http/data URIs) — the native mux decodes from
/// disk, so URL audio is a follow-up. `start_at` (source trim) isn't applied yet.
fn collect_audio_tracks(scenes: &[Scene], fps: f32) -> Vec<AudioTrack> {
    let mut tracks = Vec::new();
    let Some(first) = scenes.first() else {
        return tracks;
    };
    fn walk(node: &Node, fps: f32, out: &mut Vec<AudioTrack>) {
        if let NodeKind::Audio(a) = &node.kind {
            let is_file = !(a.src.starts_with("http://")
                || a.src.starts_with("https://")
                || a.src.starts_with("data:"));
            if a.src.is_empty() {
            } else if is_file {
                out.push(AudioTrack {
                    src: a.src.clone(),
                    start_frame: (a.start * fps).round().max(0.0) as u32,
                    volume: a.volume,
                });
            } else {
                eprintln!(
                    "note: skipping non-file audio in export mux (URL/data not yet muxed): {}",
                    a.src
                );
            }
        }
        for child in &node.children {
            walk(child, fps, out);
        }
    }
    walk(&first.root, fps, &mut tracks);
    tracks
}

/// The soundtrack to mux into a video: the clips, where their `src`s resolve,
/// and the target duration. Empty `tracks` means a silent render.
struct AudioMux<'a> {
    tracks: &'a [AudioTrack],
    base_dir: &'a Path,
    duration_secs: f32,
}

impl AudioMux<'_> {
    /// No soundtrack (silent).
    fn none() -> Self {
        AudioMux {
            tracks: &[],
            base_dir: Path::new(""),
            duration_secs: 0.0,
        }
    }
}

/// Encode rendered frames to the format implied by `out`'s extension, muxing the
/// `audio` soundtrack into MP4 output.
fn encode_movie(
    frames: &[Framebuffer],
    fps: f32,
    out: &Path,
    output: &str,
    input: &str,
    backend: &str,
    encoder: EncoderChoice,
    audio: AudioMux,
) -> Result<()> {
    if frames.is_empty() {
        bail!("nothing to encode — no frames rendered");
    }
    let ext = out
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase);
    let mut muxed_audio = false;
    let mut video_encoder: Option<Encoder> = None;
    match ext.as_deref() {
        Some("gif") => {
            if !audio.tracks.is_empty() {
                eprintln!(
                    "note: GIF has no audio stream; ignoring {} audio clip(s)",
                    audio.tracks.len()
                );
            }
            write_gif(frames, fps, out)?;
        }
        Some("mp4") => {
            let used = if audio.tracks.is_empty() {
                write_mp4(frames, fps, out, None, encoder)?
            } else {
                let wav = build_audio_wav(&audio, fps).context("building the audio track")?;
                let result = write_mp4(frames, fps, out, Some(&wav), encoder);
                if let Some(dir) = wav.parent() {
                    let _ = std::fs::remove_dir_all(dir);
                }
                let used = result?;
                muxed_audio = true;
                used
            };
            video_encoder = Some(used);
        }
        _ => bail!("unsupported output '{output}' — use a .gif or .mp4 extension"),
    }
    let (w, h) = (frames[0].width(), frames[0].height());
    let codec = video_encoder
        .map(|e| format!(", {} encoder", e.name()))
        .unwrap_or_default();
    let sound = if muxed_audio {
        format!(", {} audio clip(s)", audio.tracks.len())
    } else {
        String::new()
    };
    println!(
        "exported {input} -> {output} ({} frames, {w}x{h} @ {fps} fps, {backend} backend{codec}{sound})",
        frames.len()
    );
    Ok(())
}

/// Decode and mix `audio`'s clips into a temp 48 kHz stereo WAV (for muxing).
/// Returns the WAV path; its parent temp dir is the caller's to clean up.
fn build_audio_wav(audio: &AudioMux, fps: f32) -> Result<std::path::PathBuf> {
    const RATE: u32 = 48_000;
    let fps = fps.max(1.0);
    let decoded = audio
        .tracks
        .iter()
        .map(|t| {
            onda_audio::decode(audio.base_dir.join(&t.src))
                .with_context(|| format!("decoding audio '{}'", t.src))
        })
        .collect::<Result<Vec<_>>>()?;
    let mix_tracks: Vec<onda_audio::MixTrack> = decoded
        .iter()
        .zip(audio.tracks)
        .map(|(buf, t)| onda_audio::MixTrack::new(buf, t.start_frame as f32 / fps, t.volume))
        .collect();
    let mixed = onda_audio::mix(&mix_tracks, audio.duration_secs, RATE);

    let dir = std::env::temp_dir().join(format!("onda-audio-{}", std::process::id()));
    std::fs::create_dir_all(&dir)
        .with_context(|| format!("creating temp dir '{}'", dir.display()))?;
    let wav = dir.join("soundtrack.wav");
    onda_audio::write_wav(&mixed, &wav).context("writing the mixed audio WAV")?;
    Ok(wav)
}

/// Render a sequence of scenes through the chosen backend, returning the frames
/// and a label for the backend actually used (for `Auto`'s fallback).
fn render_scenes(
    scenes: &[Scene],
    backend: BackendChoice,
    font: FontMode,
    extra_fonts: &[Vec<u8>],
) -> Result<(Vec<Framebuffer>, &'static str)> {
    // Resolve flex layout to absolute child transforms before rendering. Text is
    // measured with a font context matching the render, so it lands where drawn.
    // Skipped entirely (no clone) when no scene uses a layout.
    let laid_out: Vec<Scene>;
    let scenes = if scenes.iter().any(scene_has_layout) {
        let fonts = RefCell::new(measure_font_context(font, extra_fonts));
        let measure = |text: &Text| measure_text(&mut fonts.borrow_mut(), text);
        laid_out = scenes
            .iter()
            .map(|s| onda_layout::layout(s, &measure))
            .collect();
        &laid_out
    } else {
        scenes
    };

    match backend {
        BackendChoice::Cpu => Ok((render_scenes_cpu(scenes, font, extra_fonts), "cpu")),
        BackendChoice::Vello => {
            let mut renderer = VelloRenderer::new()
                .context("no GPU adapter available for the Vello backend (try --backend cpu)")?;
            load_into_vello(&mut renderer, extra_fonts);
            Ok((render_scenes_vello(scenes, &mut renderer), "vello"))
        }
        BackendChoice::Auto => match VelloRenderer::new() {
            Some(mut renderer) => {
                load_into_vello(&mut renderer, extra_fonts);
                Ok((render_scenes_vello(scenes, &mut renderer), "vello"))
            }
            None => {
                eprintln!("note: no GPU adapter found; falling back to the CPU backend");
                Ok((render_scenes_cpu(scenes, font, extra_fonts), "cpu"))
            }
        },
    }
}

/// CPU backend: render across all cores (timeline eval is pure per frame). Each
/// worker gets its own renderer with the `--font` files loaded (cosmic-text font
/// state isn't shareable across threads).
fn render_scenes_cpu(
    scenes: &[Scene],
    font: FontMode,
    extra_fonts: &[Vec<u8>],
) -> Vec<Framebuffer> {
    onda_renderer::render_frames_parallel(scenes, move || {
        let mut renderer = renderer_for(font);
        for data in extra_fonts {
            renderer.load_font(data.clone());
        }
        renderer
    })
}

/// Load the `--font` files into a Vello renderer (so its faces are selectable).
fn load_into_vello(renderer: &mut VelloRenderer, extra_fonts: &[Vec<u8>]) {
    for data in extra_fonts {
        renderer.load_font(data.clone());
    }
}

/// Vello backend: render each scene on the GPU (offscreen + readback) and bridge
/// each frame into a `Framebuffer` so the existing encoders apply unchanged.
fn render_scenes_vello(scenes: &[Scene], renderer: &mut VelloRenderer) -> Vec<Framebuffer> {
    let total = scenes.len();
    let progress = EMIT_PROGRESS.load(Ordering::Relaxed);
    scenes
        .iter()
        .enumerate()
        .map(|(i, scene)| {
            let frame = renderer.render(scene);
            if progress {
                // One JSON line per frame for the Node bridge's onProgress.
                println!("[onda-progress]{{\"frame\":{},\"total\":{}}}", i + 1, total);
            }
            Framebuffer::from_rgba(frame.width, frame.height, frame.pixels)
        })
        .collect()
}

/// Whether any node in the scene carries a flex layout (so we can skip the
/// layout pass — and its clone — when nothing needs it).
fn scene_has_layout(scene: &Scene) -> bool {
    fn walk(node: &onda_scene::Node) -> bool {
        node.layout.is_some() || node.children.iter().any(walk)
    }
    walk(&scene.root)
}

/// A font context for measuring text during layout — same fonts as the render
/// (bundled/system + any `--font` files) so measurement matches drawing.
fn measure_font_context(font: FontMode, extra_fonts: &[Vec<u8>]) -> FontContext {
    let mut fonts = match font {
        FontMode::Bundled => FontContext::with_default_font(),
        FontMode::System => FontContext::with_system_fonts(),
    };
    for data in extra_fonts {
        fonts.load_font(data.clone());
    }
    fonts
}

/// Measure a text node's rendered size for layout. Shapes glyph runs and reads
/// the pen extent; the final advance + line height are approximated (good enough
/// to center/justify; exact per-glyph metrics can refine this later).
fn measure_text(fonts: &mut FontContext, text: &Text) -> Size {
    let runs = text.resolved_runs();
    let styled: Vec<StyledRun> = runs
        .iter()
        .map(|r| StyledRun {
            text: &r.text,
            font_size: r.font_size,
            color: [0.0, 0.0, 0.0, 1.0],
            family: r.font_family.as_deref(),
            weight: r.weight,
            italic: r.italic,
            letter_spacing: text.letter_spacing,
        })
        .collect();
    let layout = fonts.layout_rich(&styled);
    if layout.glyphs.is_empty() {
        return Size::ZERO;
    }
    let max_x = layout.glyphs.iter().map(|g| g.x).fold(0.0_f32, f32::max);
    let em = runs.iter().map(|r| r.font_size).fold(0.0_f32, f32::max);
    Size::new(max_x + em * 0.55, em * 1.25)
}

/// The per-frame scenes of an animated document plus its soundtrack.
struct Movie {
    scenes: Vec<Scene>,
    fps: f32,
    audio: Vec<AudioTrack>,
    duration_secs: f32,
}

/// Build a [`Movie`] from an animated document. Any `<svg>` nodes are expanded
/// once on the template (before timeline eval), resolving file `src`s relative
/// to `base_dir`.
fn movie_scenes(json: &str, base_dir: &Path) -> Result<Movie> {
    let mut doc: AnimatedScene =
        serde_json::from_str(json).context("movie JSON is not a valid animated scene")?;
    doc.scene = onda_svg::expand_svg(&doc.scene, base_dir).context("expanding <svg> nodes")?;
    // Decode images once on the template; frame clones then share the pixels.
    doc.scene = onda_image::load_images(&doc.scene, base_dir).context("loading images")?;
    let scenes: Vec<Scene> = (0..doc.frame_count()).map(|n| doc.frame(n)).collect();
    Ok(Movie {
        scenes,
        fps: doc.fps(),
        duration_secs: doc.duration_secs(),
        audio: doc.audio,
    })
}

/// Parse a pre-evaluated sequence of scene graphs (one per frame), expanding any
/// `<svg>` nodes (file `src`s relative to `base_dir`).
fn frames_scenes(json: &str, base_dir: &Path) -> Result<(Vec<Scene>, f32)> {
    let raw: Vec<Scene> =
        serde_json::from_str(json).context("frames JSON is not an array of scene graphs")?;
    let Some(first) = raw.first() else {
        bail!("frames JSON contains no scenes");
    };
    let fps = first.composition.fps;
    let mut scenes = Vec::with_capacity(raw.len());
    // One persistent, sequential video decoder across all frames: each `src`
    // streams from a single ffmpeg pipe (frame-accurate, ~no per-frame spawn)
    // since export walks frames in increasing time. Native-only, opt-in feature.
    #[cfg(feature = "video")]
    let mut video = onda_video::VideoDecoder::new();
    // One decode cache across all frames: a `src` referenced every frame (e.g. a
    // background plate) is decoded ONCE, not per frame (procedural grain + data URIs
    // are excluded — they differ per frame). Big win for image-heavy compositions.
    let mut img_cache = std::collections::HashMap::new();
    for scene in &raw {
        let expanded = onda_svg::expand_svg(scene, base_dir).context("expanding <svg> nodes")?;
        #[cfg(feature = "video")]
        let expanded = video
            .resolve_scene(&expanded)
            .context("decoding video frames")?;
        scenes.push(
            onda_image::load_images_cached(&expanded, base_dir, &mut img_cache)
                .context("loading images")?,
        );
    }
    Ok((scenes, fps))
}

/// The directory an input path lives in (where relative SVG `src`s resolve);
/// the empty path (= CWD) when there's no parent.
fn base_dir_of(input: &str) -> &Path {
    Path::new(input).parent().unwrap_or(Path::new(""))
}

/// CPU-rendered frames of an animated document. The deterministic reference path
/// (and the render-test oracle); the command layer routes through `render_scenes`.
#[cfg(test)]
fn render_movie_json(json: &str, font: FontMode) -> Result<(Vec<Framebuffer>, f32)> {
    let movie = movie_scenes(json, Path::new(""))?;
    Ok((render_scenes_cpu(&movie.scenes, font, &[]), movie.fps))
}

/// CPU-rendered frames of a pre-evaluated scene sequence (the test oracle).
#[cfg(test)]
fn render_frames_json(json: &str, font: FontMode) -> Result<(Vec<Framebuffer>, f32)> {
    let (scenes, fps) = frames_scenes(json, Path::new(""))?;
    Ok((render_scenes_cpu(&scenes, font, &[]), fps))
}

fn renderer_for(font: FontMode) -> Renderer {
    match font {
        FontMode::Bundled => Renderer::with_default_font(),
        FontMode::System => Renderer::with_system_fonts(),
    }
}

/// Encode frames as an animated GIF (pure Rust).
fn write_gif(frames: &[Framebuffer], fps: f32, out: &Path) -> Result<()> {
    let file = std::io::BufWriter::new(
        std::fs::File::create(out).with_context(|| format!("creating '{}'", out.display()))?,
    );
    encode_gif(frames, fps, file).with_context(|| format!("encoding GIF '{}'", out.display()))
}

/// Encode frames as an MP4 via ffmpeg with `choice` (resolving `Auto` to a probed
/// hardware encoder, else libx264). If a hardware encoder fails the actual run, it
/// falls back to libx264 once. Returns the encoder actually used. `audio_wav`, if
/// given, is muxed as an AAC stream trimmed to the shorter of the two.
fn write_mp4(
    frames: &[Framebuffer],
    fps: f32,
    out: &Path,
    audio_wav: Option<&Path>,
    choice: EncoderChoice,
) -> Result<Encoder> {
    let enc = resolve_encoder(choice);
    match pipe_encode(frames, fps, out, audio_wav, enc) {
        Ok(()) => Ok(enc),
        Err(err) if enc != Encoder::Libx264 => {
            eprintln!(
                "note: {} encode failed ({err:#}); falling back to libx264",
                enc.name()
            );
            pipe_encode(frames, fps, out, audio_wav, Encoder::Libx264)?;
            Ok(Encoder::Libx264)
        }
        Err(err) => Err(err),
    }
}

/// Pipe raw RGBA8 frames straight to ffmpeg's stdin (no per-frame PNG encode or
/// disk round-trip) and encode with `enc`. `Framebuffer::as_bytes` is
/// straight-alpha RGBA8, row-major — matching `-pixel_format rgba`. yuv420p has
/// no alpha, so transparent regions composite over black.
/// Build the ffmpeg command that reads raw RGBA8 frames on stdin and encodes an
/// mp4 with `enc` (muxing `audio_wav` if present). Shared by the buffered
/// ([`pipe_encode`]) and streaming ([`stream_encode_mp4`]) paths so they encode
/// identically. Stdin is piped; the caller writes frames + waits.
fn ffmpeg_mp4_cmd(
    w: u32,
    h: u32,
    fps: f32,
    out: &Path,
    audio_wav: Option<&Path>,
    enc: Encoder,
) -> std::process::Command {
    let mut cmd = std::process::Command::new("ffmpeg");
    cmd.args([
        "-y",
        "-loglevel",
        "error",
        "-f",
        "rawvideo",
        "-pixel_format",
        "rgba",
        "-video_size",
        &format!("{w}x{h}"),
        "-framerate",
        &fps.to_string(),
        "-i",
        "-",
    ]);
    if let Some(wav) = audio_wav {
        cmd.arg("-i").arg(wav);
    }
    // Even dimensions are required by yuv420p / 4:2:0 subsampling.
    cmd.args(["-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2"]);
    cmd.args(enc.video_args());
    // Tag bt709 limited-range so players read the colors consistently.
    cmd.args([
        "-color_range",
        "tv",
        "-colorspace",
        "bt709",
        "-color_primaries",
        "bt709",
        "-color_trc",
        "bt709",
    ]);
    if audio_wav.is_some() {
        // Encode the audio and stop at the shorter stream (video length).
        cmd.args(["-c:a", "aac", "-b:a", "192k", "-shortest"]);
    }
    cmd.arg(out).stdin(std::process::Stdio::piped());
    cmd
}

fn pipe_encode(
    frames: &[Framebuffer],
    fps: f32,
    out: &Path,
    audio_wav: Option<&Path>,
    enc: Encoder,
) -> Result<()> {
    use std::io::Write;
    let (w, h) = (frames[0].width(), frames[0].height());
    let mut child = ffmpeg_mp4_cmd(w, h, fps, out, audio_wav, enc)
        .spawn()
        .context("failed to launch ffmpeg — is it installed and on PATH? (.gif needs no tools)")?;
    {
        let mut stdin = child.stdin.take().context("ffmpeg stdin was unavailable")?;
        for (i, frame) in frames.iter().enumerate() {
            stdin
                .write_all(frame.as_bytes())
                .with_context(|| format!("piping frame {i} to ffmpeg"))?;
        }
        // `stdin` drops here → EOF, so ffmpeg finalizes the output.
    }
    let status = child.wait().context("waiting for ffmpeg")?;
    if !status.success() {
        bail!("ffmpeg exited unsuccessfully ({status})");
    }
    Ok(())
}

/// Render `raw_scenes` in chunks, calling `write` with each frame in order — the
/// memory-bounded counterpart of `frames_scenes` + `render_scenes`. Each chunk is
/// pre-passed (svg → video → layout → images) and rendered, then freed before the
/// next, so peak RAM is ~one chunk of frames regardless of the video's length
/// (vs. buffering every frame). Returns the backend actually used.
fn render_stream(
    raw_scenes: &[Scene],
    base_dir: &Path,
    backend: BackendChoice,
    font: FontMode,
    extra_fonts: &[Vec<u8>],
    mut write: impl FnMut(&Framebuffer) -> Result<()>,
) -> Result<&'static str> {
    let comp = raw_scenes[0].composition;
    // Adaptive chunk: target ~1 GiB of raw frames in flight, whatever the
    // resolution (1080p ≈ 128 frames, 4K ≈ 32), so memory stays flat + bounded.
    let frame_bytes = (comp.width as usize) * (comp.height as usize) * 4;
    let chunk = (1_073_741_824usize / frame_bytes.max(1)).clamp(8, 512);

    let measure_fonts = RefCell::new(measure_font_context(font, extra_fonts));
    #[cfg(feature = "video")]
    let mut video = onda_video::VideoDecoder::new();

    // Pre-pass one chunk's scenes (sequential: shared font ctx + streaming video
    // decoder). The chunk then renders in parallel (CPU) / sequentially (Vello).
    // `mut` is only needed when the video decoder is captured (the `video` feature).
    #[cfg_attr(not(feature = "video"), allow(unused_mut))]
    let mut prepare = |slice: &[Scene]| -> Result<Vec<Scene>> {
        slice
            .iter()
            .map(|raw| {
                let s = onda_svg::expand_svg(raw, base_dir).context("expanding <svg> nodes")?;
                #[cfg(feature = "video")]
                let s = video.resolve_scene(&s).context("decoding video frames")?;
                let s = if scene_has_layout(&s) {
                    let measure = |t: &Text| measure_text(&mut measure_fonts.borrow_mut(), t);
                    onda_layout::layout(&s, &measure)
                } else {
                    s
                };
                onda_image::load_images(&s, base_dir).context("loading images")
            })
            .collect()
    };

    // Resolve the backend once, then render + pipe chunk by chunk.
    let vello = match backend {
        BackendChoice::Cpu => None,
        BackendChoice::Vello => Some(
            VelloRenderer::new()
                .context("no GPU adapter available for the Vello backend (try --backend cpu)")?,
        ),
        BackendChoice::Auto => VelloRenderer::new(),
    };
    if let Some(mut renderer) = vello {
        load_into_vello(&mut renderer, extra_fonts);
        for slice in raw_scenes.chunks(chunk) {
            for scene in &prepare(slice)? {
                let frame = renderer.render(scene);
                write(&Framebuffer::from_rgba(
                    frame.width,
                    frame.height,
                    frame.pixels,
                ))?;
            }
        }
        Ok("vello")
    } else {
        if matches!(backend, BackendChoice::Auto) {
            eprintln!("note: no GPU adapter found; falling back to the CPU backend");
        }
        for slice in raw_scenes.chunks(chunk) {
            let frames = render_scenes_cpu(&prepare(slice)?, font, extra_fonts);
            for fb in &frames {
                write(fb)?;
            }
        }
        Ok("cpu")
    }
}

/// Stream `raw_scenes` straight into an mp4: spawn ffmpeg, render+pipe each chunk
/// (bounded memory), encode with the resolved encoder. On a hardware-encoder
/// failure, re-render once with libx264 (rare — the encoder is probed up front).
/// Returns the backend + encoder used.
fn stream_encode_mp4(
    raw_scenes: &[Scene],
    fps: f32,
    out: &Path,
    base_dir: &Path,
    backend: BackendChoice,
    font: FontMode,
    extra_fonts: &[Vec<u8>],
    encoder: EncoderChoice,
    audio_wav: Option<&Path>,
) -> Result<(&'static str, Encoder)> {
    let comp = raw_scenes[0].composition;
    let attempt = |enc: Encoder| -> Result<&'static str> {
        use std::io::Write;
        let mut child = ffmpeg_mp4_cmd(comp.width, comp.height, fps, out, audio_wav, enc)
            .spawn()
            .context("failed to launch ffmpeg — is it installed and on PATH?")?;
        let mut stdin = child.stdin.take().context("ffmpeg stdin was unavailable")?;
        let render = render_stream(raw_scenes, base_dir, backend, font, extra_fonts, |fb| {
            stdin
                .write_all(fb.as_bytes())
                .context("piping frame to ffmpeg")
        });
        drop(stdin); // EOF so ffmpeg finalizes (and unblocks if the render errored)
        let status = child.wait().context("waiting for ffmpeg")?;
        let used = render?; // a render error is the root cause — surface it first
        if !status.success() {
            bail!("ffmpeg exited unsuccessfully ({status})");
        }
        Ok(used)
    };

    let enc = resolve_encoder(encoder);
    match attempt(enc) {
        Ok(used) => Ok((used, enc)),
        Err(err) if enc != Encoder::Libx264 => {
            eprintln!(
                "note: {} encode failed ({err:#}); re-rendering with libx264",
                enc.name()
            );
            Ok((attempt(Encoder::Libx264)?, Encoder::Libx264))
        }
        Err(err) => Err(err),
    }
}

/// The streaming `export-frames` → mp4 path: parse the frames, mux any audio, and
/// stream-render to a bounded-memory mp4 (works for long videos that buffering
/// every frame would OOM on).
fn stream_frames_to_mp4(
    json: &str,
    input: &str,
    output: &str,
    out: &Path,
    base_dir: &Path,
    backend: BackendChoice,
    font: FontMode,
    fonts: &[Vec<u8>],
    encoder: EncoderChoice,
) -> Result<()> {
    let raw: Vec<Scene> =
        serde_json::from_str(json).context("frames JSON is not an array of scene graphs")?;
    let Some(first) = raw.first() else {
        bail!("frames JSON contains no scenes");
    };
    let fps = first.composition.fps;
    let (w, h) = (first.composition.width, first.composition.height);
    let audio_tracks = collect_audio_tracks(&raw, fps);

    let wav = if audio_tracks.is_empty() {
        None
    } else {
        let mux = AudioMux {
            tracks: &audio_tracks,
            base_dir,
            duration_secs: raw.len() as f32 / fps.max(1.0),
        };
        Some(build_audio_wav(&mux, fps).context("building the audio track")?)
    };
    let result = stream_encode_mp4(
        &raw,
        fps,
        out,
        base_dir,
        backend,
        font,
        fonts,
        encoder,
        wav.as_deref(),
    );
    if let Some(w) = &wav {
        if let Some(dir) = w.parent() {
            let _ = std::fs::remove_dir_all(dir);
        }
    }
    let (used, enc) = result?;
    let sound = if audio_tracks.is_empty() {
        String::new()
    } else {
        format!(", {} audio clip(s)", audio_tracks.len())
    };
    println!(
        "exported {input} -> {output} ({} frames, {w}x{h} @ {fps} fps, {used} backend, {} encoder{sound}, streamed)",
        raw.len(),
        enc.name()
    );
    Ok(())
}

/// Read a scene-graph JSON document, render it through `backend`, and write the
/// result as a PNG. Returns the rendered dimensions and the backend used.
fn render_scene_file(
    input: &Path,
    output: &Path,
    font: FontMode,
    backend: BackendChoice,
    extra_fonts: &[Vec<u8>],
) -> Result<(u32, u32, &'static str)> {
    let json = std::fs::read_to_string(input)
        .with_context(|| format!("reading scene file '{}'", input.display()))?;
    let parsed: Scene =
        serde_json::from_str(&json).context("scene JSON is not a valid scene graph")?;
    let base_dir = input.parent().unwrap_or(Path::new(""));
    let scene = onda_svg::expand_svg(&parsed, base_dir).context("expanding <svg> nodes")?;
    // Decode video frames before images so `Video.data` is set and the image pass
    // skips it (a video container isn't an image). Native-only, opt-in feature.
    #[cfg(feature = "video")]
    let scene = onda_video::load_video_frames(&scene).context("decoding video frames")?;
    let scene = onda_image::load_images(&scene, base_dir).context("loading images")?;
    let (mut frames, used) =
        render_scenes(std::slice::from_ref(&scene), backend, font, extra_fonts)
            .with_context(|| format!("rendering scene '{}'", input.display()))?;
    let framebuffer = frames.remove(0);
    framebuffer
        .write_png(output)
        .with_context(|| format!("writing PNG '{}'", output.display()))?;
    Ok((framebuffer.width(), framebuffer.height(), used))
}

/// Parse a scene-graph JSON document and render it on the CPU (the test oracle).
#[cfg(test)]
fn render_scene_json(json: &str, font: FontMode) -> Result<onda_renderer::Framebuffer> {
    let scene: Scene =
        serde_json::from_str(json).context("scene JSON is not a valid scene graph")?;
    let mut renderer = match font {
        FontMode::Bundled => Renderer::with_default_font(),
        FontMode::System => Renderer::with_system_fonts(),
    };
    Ok(renderer.render(&scene))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lint_flags_off_canvas_and_passes_clean() {
        // A 100×100 rect at x=-80 on a 200×200 canvas → 80px off-canvas left.
        let off = r#"{"composition":{"width":200,"height":200,"fps":30.0,"duration_in_frames":1},
          "root":{"kind":{"type":"group"},"children":[
            {"transform":{"translate":{"x":-80.0,"y":50.0}},
             "kind":{"type":"shape","geometry":{"shape":"rect","size":{"width":100.0,"height":100.0}},"fill":{"r":1.0,"g":1.0,"b":1.0}},
             "children":[]}]}}"#;
        let scene: Scene = serde_json::from_str(off).unwrap();
        let fonts = RefCell::new(measure_font_context(FontMode::Bundled, &[]));
        let diags = lint_scenes(&[scene], &[0], &fonts);
        assert!(
            diags.iter().any(|d| d["issue"] == "OFF_CANVAS"),
            "should flag off-canvas, got {diags:?}"
        );

        // An in-bounds rect → no diagnostics.
        let clean = r#"{"composition":{"width":200,"height":200,"fps":30.0,"duration_in_frames":1},
          "root":{"kind":{"type":"group"},"children":[
            {"transform":{"translate":{"x":40.0,"y":40.0}},
             "kind":{"type":"shape","geometry":{"shape":"rect","size":{"width":80.0,"height":80.0}},"fill":{"r":1.0,"g":1.0,"b":1.0}},
             "children":[]}]}}"#;
        let scene2: Scene = serde_json::from_str(clean).unwrap();
        let fonts2 = RefCell::new(measure_font_context(FontMode::Bundled, &[]));
        assert!(
            lint_scenes(&[scene2], &[0], &fonts2).is_empty(),
            "clean scene → no diagnostics"
        );
    }

    #[test]
    fn lint_precision_bleed_rotation_and_transients() {
        let fonts = || RefCell::new(measure_font_context(FontMode::Bundled, &[]));

        // 1. Full-bleed background (2000×1200 bleeding past a 1920×1080 canvas) →
        //    its box covers the canvas, so the overhang is intentional → no flag.
        let bleed = r#"{"composition":{"width":1920,"height":1080,"fps":30.0,"duration_in_frames":1},
          "root":{"kind":{"type":"group"},"children":[
            {"transform":{"translate":{"x":-40.0,"y":-60.0}},
             "kind":{"type":"shape","geometry":{"shape":"rect","size":{"width":2000.0,"height":1200.0}},"fill":{"r":0.1,"g":0.1,"b":0.1}},
             "children":[]}]}}"#;
        let s: Scene = serde_json::from_str(bleed).unwrap();
        assert!(
            lint_scenes(&[s], &[0], &fonts()).is_empty(),
            "full-bleed background must not be flagged off-canvas"
        );

        // 2a. Rotation is ACCOUNTED for (matches the Vello backend), not skipped: a
        //     200×100 rect rotated 90° has a 100×200 AABB swung off the origin, so
        //     it's flagged off-canvas AND its reported box has swapped dimensions.
        let rot90 = r#"{"composition":{"width":400,"height":400,"fps":30.0,"duration_in_frames":1},
          "root":{"kind":{"type":"group"},"children":[
            {"transform":{"translate":{"x":0.0,"y":0.0},"rotate":90.0},
             "kind":{"type":"shape","geometry":{"shape":"rect","size":{"width":200.0,"height":100.0}},"fill":{"r":1.0,"g":1.0,"b":1.0}},
             "children":[]}]}}"#;
        let s: Scene = serde_json::from_str(rot90).unwrap();
        let d = lint_scenes(&[s], &[0], &fonts());
        let off = d.iter().find(|x| x["issue"] == "OFF_CANVAS");
        let b = off
            .expect("rotated rect off the origin must be flagged")
            .get("box")
            .unwrap();
        let (w, h) = (b[2].as_f64().unwrap(), b[3].as_f64().unwrap());
        assert!(
            (w - 100.0).abs() < 1.0 && (h - 200.0).abs() < 1.0,
            "90°-rotated 200×100 rect should report a 100×200 AABB, got {w}×{h}"
        );

        // 2b. A rotated element that still FITS the canvas must not be flagged — a
        //     100×100 square at (150,150) rotated 45° stays within a 400×400 canvas.
        let rot_fits = r#"{"composition":{"width":400,"height":400,"fps":30.0,"duration_in_frames":1},
          "root":{"kind":{"type":"group"},"children":[
            {"transform":{"translate":{"x":150.0,"y":150.0},"rotate":45.0},
             "kind":{"type":"shape","geometry":{"shape":"rect","size":{"width":100.0,"height":100.0}},"fill":{"r":1.0,"g":1.0,"b":1.0}},
             "children":[]}]}}"#;
        let s: Scene = serde_json::from_str(rot_fits).unwrap();
        assert!(
            lint_scenes(&[s], &[0], &fonts()).is_empty(),
            "an in-bounds rotated element must not be flagged"
        );

        // 3 & 4. A title that slides in (off-canvas only on frame 0 of 8) is a
        //    transient → suppressed; one parked off-canvas every frame → flagged.
        let title_at = |x: f32| -> Scene {
            let j = format!(
                r#"{{"composition":{{"width":1920,"height":1080,"fps":30.0,"duration_in_frames":1}},
                  "root":{{"kind":{{"type":"group"}},"children":[
                    {{"transform":{{"translate":{{"x":{x},"y":500.0}}}},
                     "kind":{{"type":"text","content":"Headline","font_size":80.0}}}}]}}}}"#
            );
            serde_json::from_str(&j).unwrap()
        };
        let samples: Vec<usize> = (0..8).collect();

        let slide: Vec<Scene> = (0..8)
            .map(|f| title_at(if f == 0 { -700.0 } else { 820.0 }))
            .collect();
        let slide_diags = lint_scenes(&slide, &samples, &fonts());
        assert!(
            slide_diags.is_empty(),
            "a one-frame slide-in transient must be suppressed, got {slide_diags:?}"
        );

        let parked: Vec<Scene> = (0..8).map(|_| title_at(-700.0)).collect();
        let parked_diags = lint_scenes(&parked, &samples, &fonts());
        assert!(
            parked_diags.iter().any(|x| x["issue"] == "OFF_CANVAS"),
            "a persistently off-canvas title must be flagged, got {parked_diags:?}"
        );
    }

    #[test]
    fn render_frame_renders_a_cropped_frame_and_validates_range() {
        let dir = std::env::temp_dir();
        let input = dir.join("onda_rf_frames.json");
        let output = dir.join("onda_rf_out.png");
        // Two distinct frames (red, then green) so frame selection is observable.
        let frames = r#"[
          {"composition":{"width":40,"height":24,"fps":30.0,"duration_in_frames":1},
           "root":{"kind":{"type":"group"},"children":[
             {"kind":{"type":"shape","geometry":{"shape":"rect","size":{"width":40.0,"height":24.0}},"fill":{"r":1.0,"g":0.0,"b":0.0}}}]}},
          {"composition":{"width":40,"height":24,"fps":30.0,"duration_in_frames":1},
           "root":{"kind":{"type":"group"},"children":[
             {"kind":{"type":"shape","geometry":{"shape":"rect","size":{"width":40.0,"height":24.0}},"fill":{"r":0.0,"g":1.0,"b":0.0}}}]}}
        ]"#;
        std::fs::write(&input, frames).unwrap();
        let s = |x: &str| x.to_string();
        let (i, o) = (s(input.to_str().unwrap()), s(output.to_str().unwrap()));

        // Render frame 1, crop a 20×10 region, on the CPU backend (no GPU needed).
        render_frame_command(&[
            i.clone(),
            o.clone(),
            s("--frame"),
            s("1"),
            s("--crop"),
            s("5,5,20,10"),
            s("--backend"),
            s("cpu"),
        ])
        .expect("render-frame should succeed");
        assert!(output.exists());

        // An out-of-range frame fails with a clear message.
        let err = render_frame_command(&[i, o, s("--frame"), s("9"), s("--backend"), s("cpu")])
            .unwrap_err();
        assert!(format!("{err:#}").contains("out of range"));

        let _ = std::fs::remove_file(&input);
        let _ = std::fs::remove_file(&output);
    }

    #[test]
    fn contact_sheet_tiles_frames_and_overlays_marks() {
        let dir = std::env::temp_dir();
        let input = dir.join("onda_cs_frames.json");
        let output = dir.join("onda_cs_out.png");
        // Three frames; each carries a tiny-text node so the sheet has a mark.
        let frame = |bg: &str| {
            format!(
                r#"{{"composition":{{"width":160,"height":90,"fps":30.0,"duration_in_frames":1}},
                  "root":{{"kind":{{"type":"group"}},"children":[
                    {{"kind":{{"type":"shape","geometry":{{"shape":"rect","size":{{"width":160.0,"height":90.0}}}},"fill":{bg}}}}},
                    {{"transform":{{"translate":{{"x":10.0,"y":70.0}}}},"kind":{{"type":"text","content":"tiny","font_size":7.0}}}}]}}}}"#
            )
        };
        let frames = format!(
            "[{},{},{}]",
            frame(r#"{"r":0.2,"g":0.1,"b":0.1}"#),
            frame(r#"{"r":0.1,"g":0.2,"b":0.1}"#),
            frame(r#"{"r":0.1,"g":0.1,"b":0.2}"#),
        );
        std::fs::write(&input, frames).unwrap();
        let s = |x: &str| x.to_string();
        let (i, o) = (s(input.to_str().unwrap()), s(output.to_str().unwrap()));

        contact_sheet_command(&[
            i,
            o,
            s("--cells"),
            s("3"),
            s("--cols"),
            s("2"),
            s("--cell-width"),
            s("120"),
            s("--backend"),
            s("cpu"),
        ])
        .expect("contact-sheet should succeed");
        assert!(output.exists());
        // A non-trivial PNG was written (header + tiled content).
        assert!(std::fs::metadata(&output).unwrap().len() > 1000);

        let _ = std::fs::remove_file(&input);
        let _ = std::fs::remove_file(&output);
    }

    const SCENE: &str = r#"{
        "composition": { "width": 40, "height": 24, "fps": 30.0, "duration_in_frames": 1 },
        "root": {
            "kind": { "type": "group" },
            "children": [
                {
                    "kind": {
                        "type": "shape",
                        "geometry": { "shape": "rect", "size": { "width": 40.0, "height": 24.0 } },
                        "fill": { "r": 0.1, "g": 0.2, "b": 0.3 }
                    }
                },
                {
                    "transform": { "translate": { "x": 4.0, "y": 2.0 } },
                    "kind": { "type": "text", "content": "Hi", "font_size": 16.0 }
                }
            ]
        }
    }"#;

    #[test]
    fn renders_json_scene_to_framebuffer() {
        let fb = render_scene_json(SCENE, FontMode::Bundled).expect("scene should render");
        assert_eq!((fb.width(), fb.height()), (40, 24));
        // Backdrop fills every pixel, so nothing is transparent.
        assert!(fb.as_bytes().chunks_exact(4).all(|px| px[3] == 255));
    }

    #[test]
    fn render_is_deterministic_from_json() {
        let a = render_scene_json(SCENE, FontMode::Bundled).unwrap();
        let b = render_scene_json(SCENE, FontMode::Bundled).unwrap();
        assert_eq!(a.as_bytes(), b.as_bytes());
    }

    #[test]
    fn malformed_json_is_a_clear_error() {
        let err = render_scene_json("{ not valid", FontMode::Bundled).unwrap_err();
        assert!(format!("{err:#}").contains("scene graph"));
    }

    #[test]
    fn render_scene_file_round_trips() {
        let dir = std::env::temp_dir();
        let input = dir.join("onda_cli_test_scene.json");
        let output = dir.join("onda_cli_test_out.png");
        std::fs::write(&input, SCENE).unwrap();

        let (w, h, backend) =
            render_scene_file(&input, &output, FontMode::Bundled, BackendChoice::Cpu, &[]).unwrap();
        assert_eq!((w, h), (40, 24));
        assert_eq!(backend, "cpu");
        assert!(output.exists());

        let _ = std::fs::remove_file(&input);
        let _ = std::fs::remove_file(&output);
    }

    const MOVIE: &str = r#"{
        "scene": {
            "composition": { "width": 32, "height": 16, "fps": 10.0, "duration_in_frames": 3 },
            "root": {
                "kind": { "type": "group" },
                "children": [
                    { "id": 1, "kind": { "type": "text", "content": "Hi", "font_size": 12.0 } }
                ]
            }
        },
        "timeline": {
            "animations": [
                {
                    "target": 1,
                    "property": {
                        "kind": "opacity",
                        "track": { "keyframes": [
                            { "time": 0.0, "value": 0.0 },
                            { "time": 0.2, "value": 1.0 }
                        ] }
                    }
                }
            ]
        }
    }"#;

    #[test]
    fn renders_all_movie_frames() {
        let (frames, fps) = render_movie_json(MOVIE, FontMode::Bundled).unwrap();
        assert_eq!(frames.len(), 3); // duration_in_frames
        assert_eq!(fps, 10.0);
        assert_eq!((frames[0].width(), frames[0].height()), (32, 16));
    }

    #[test]
    fn renders_a_pre_evaluated_frame_sequence() {
        // Two distinct scenes (a "flipbook"), as @onda/react's renderFrames emits.
        let frames_json = r#"[
            {
                "composition": { "width": 8, "height": 8, "fps": 12.0, "duration_in_frames": 2 },
                "root": { "kind": { "type": "shape", "geometry": { "shape": "rect",
                    "size": { "width": 8.0, "height": 8.0 } }, "fill": { "r": 1.0, "g": 0.0, "b": 0.0 } } }
            },
            {
                "composition": { "width": 8, "height": 8, "fps": 12.0, "duration_in_frames": 2 },
                "root": { "kind": { "type": "shape", "geometry": { "shape": "rect",
                    "size": { "width": 8.0, "height": 8.0 } }, "fill": { "r": 0.0, "g": 0.0, "b": 1.0 } } }
            }
        ]"#;
        let (frames, fps) = render_frames_json(frames_json, FontMode::Bundled).unwrap();
        assert_eq!(frames.len(), 2);
        assert_eq!(fps, 12.0);
        assert_eq!(frames[0].pixel(0, 0), [255, 0, 0, 255]); // red frame
        assert_eq!(frames[1].pixel(0, 0), [0, 0, 255, 255]); // blue frame
    }

    #[test]
    fn empty_frame_sequence_errors() {
        assert!(render_frames_json("[]", FontMode::Bundled).is_err());
    }

    #[test]
    fn exports_a_real_gif() {
        let (frames, fps) = render_movie_json(MOVIE, FontMode::Bundled).unwrap();
        let out = std::env::temp_dir().join("onda_cli_test.gif");
        write_gif(&frames, fps, &out).unwrap();

        let bytes = std::fs::read(&out).unwrap();
        assert!(bytes.len() > 6);
        assert!(
            &bytes[..3] == b"GIF",
            "not a GIF: {:?}",
            &bytes[..6.min(bytes.len())]
        );
        let _ = std::fs::remove_file(&out);
    }

    // A scene whose only content is an arbitrary path — the CPU backend can't
    // rasterize it, so this also pins that the export path now reaches Vello.
    const PATH_SCENE: &str = r#"[{
        "composition": { "width": 16, "height": 16, "fps": 30.0, "duration_in_frames": 1 },
        "root": { "kind": { "type": "shape",
            "geometry": { "shape": "path", "data": "M0 0 L16 0 L16 16 L0 16 Z" },
            "fill": { "r": 0.0, "g": 1.0, "b": 0.0 } } }
    }]"#;

    #[test]
    fn cpu_backend_reports_itself_and_renders() {
        let (scenes, _) = frames_scenes(PATH_SCENE, Path::new("")).unwrap();
        let (frames, used) =
            render_scenes(&scenes, BackendChoice::Cpu, FontMode::Bundled, &[]).unwrap();
        assert_eq!(used, "cpu");
        assert_eq!(frames.len(), 1);
        // The CPU backend now rasterizes paths (tiny-skia) — opaque green, like Vello.
        assert_eq!(frames[0].pixel(8, 8), [0, 255, 0, 255]);
    }

    #[test]
    fn vello_backend_renders_a_path_in_export() {
        // Skip where there's no GPU (e.g. headless CI).
        if VelloRenderer::new().is_none() {
            eprintln!("no GPU adapter; skipping Vello export test");
            return;
        }
        let (scenes, _) = frames_scenes(PATH_SCENE, Path::new("")).unwrap();
        let (frames, used) =
            render_scenes(&scenes, BackendChoice::Vello, FontMode::Bundled, &[]).unwrap();
        assert_eq!(used, "vello");
        assert_eq!(frames.len(), 1);
        // Vello rasterizes the path → opaque green covers the canvas.
        assert_eq!(frames[0].pixel(8, 8), [0, 255, 0, 255]);
    }

    #[test]
    fn load_font_bytes_reads_files_and_errors_clearly() {
        let dir = std::env::temp_dir();
        let good = dir.join("onda_cli_font_good.ttf");
        // Any real font bytes will do; reuse the bundled default.
        std::fs::write(&good, onda_renderer::FontContext::default_font_bytes()).unwrap();

        let loaded = load_font_bytes(std::slice::from_ref(&good)).expect("reads the font file");
        assert_eq!(loaded.len(), 1);
        assert!(!loaded[0].is_empty());

        let missing = dir.join("onda_cli_font_does_not_exist.ttf");
        let err = load_font_bytes(&[missing]).unwrap_err();
        assert!(format!("{err:#}").contains("reading font"));

        let _ = std::fs::remove_file(&good);
    }

    #[test]
    fn build_audio_wav_decodes_mixes_and_resamples() {
        // Synthesize a 0.5s mono tone WAV, then build the muxable soundtrack
        // from a track referencing it (exercises decode → mix → write, no ffmpeg).
        let dir = std::env::temp_dir().join("onda_cli_audio_test");
        let _ = std::fs::create_dir_all(&dir);
        let samples = (0..24_000)
            .map(|i| (i as f32 / 48_000.0 * 440.0 * std::f32::consts::TAU).sin() * 0.5)
            .collect();
        let tone = onda_audio::AudioBuffer {
            sample_rate: 48_000,
            channels: 1,
            samples,
        };
        onda_audio::write_wav(&tone, dir.join("tone.wav")).unwrap();

        let tracks = [AudioTrack::new("tone.wav")];
        let mux = AudioMux {
            tracks: &tracks,
            base_dir: &dir,
            duration_secs: 1.0,
        };
        let wav = build_audio_wav(&mux, 30.0).expect("build audio wav");
        let mixed = onda_audio::decode(&wav).expect("decode mixed wav");
        assert_eq!(mixed.channels, 2); // mixed to stereo
        assert!((mixed.duration_secs() - 1.0).abs() < 0.05); // padded to target duration

        if let Some(parent) = wav.parent() {
            let _ = std::fs::remove_dir_all(parent);
        }
        let _ = std::fs::remove_dir_all(&dir);
    }
}
