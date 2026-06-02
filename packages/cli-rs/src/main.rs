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

use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};
use onda_animation::{AnimatedScene, AudioTrack};
use onda_renderer::{encode_gif, Framebuffer, Renderer};
use onda_scene::Scene;
use onda_vello::VelloRenderer;

const USAGE: &str = "\
onda — render a scene-graph document to an image or video

USAGE:
    onda render <scene.json> <out.png>             Render one still
    onda export <movie.json> <out.gif|.mp4>        Render a scene + timeline
    onda export-frames <frames.json> <out.gif|.mp4>  Render pre-evaluated frames

    <scene.json>   a scene graph              (onda-scene JSON)
    <movie.json>   a scene graph + timeline   ({ \"scene\": ..., \"timeline\": ... })
    <frames.json>  an array of scene graphs   (e.g. @onda/react's renderFrames)

    .gif output is pure-Rust and always available; .mp4 needs ffmpeg on PATH.

OPTIONS:
    --backend <auto|vello|cpu>
                      Rendering backend. 'vello' is the GPU-native vector
                      renderer (anti-aliased fills/strokes, paths, gradients,
                      clips, crisp text). 'cpu' is the deterministic reference
                      rasterizer (bit-identical across machines; no AA, no
                      strokes/paths/gradients/clips). 'auto' (default) uses
                      Vello when a GPU is available, else falls back to CPU.
    --system-fonts    Use the host's installed fonts instead of the bundled
                      default font (CPU backend only; output then depends on
                      the machine).
    --font <path>     Load a .ttf/.otf font, then select it by family name on a
                      <Text> run (like Remotion's loadFont). Repeat for several.
                      Works with both backends and alongside the bundled fonts.
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
        "export" => export_command(&args[1..]),
        "export-frames" => export_frames_command(&args[1..]),
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
    /// Paths from `--font`, loaded and selectable by family on a `Text` run.
    fonts: Vec<PathBuf>,
}

/// Parse the shared `[--backend ...] [--system-fonts] [--font <path>]...` +
/// two positionals shape.
fn parse_io(args: &[String], verb: &str) -> Result<Options> {
    let mut positionals: Vec<&str> = Vec::new();
    let mut font = FontMode::Bundled;
    let mut backend = BackendChoice::Auto;
    let mut fonts: Vec<PathBuf> = Vec::new();
    let mut iter = args.iter();
    while let Some(arg) = iter.next() {
        match arg.as_str() {
            "--system-fonts" => font = FontMode::System,
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
        fonts,
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
        fonts,
    } = parse_io(args, "render")?;
    let fonts = load_font_bytes(&fonts)?;
    let (width, height, used) =
        render_scene_file(Path::new(&input), Path::new(&output), font, backend, &fonts)?;
    println!("rendered {input} -> {output} ({width}x{height}, {used} backend)");
    Ok(())
}

fn export_command(args: &[String]) -> Result<()> {
    let Options {
        input,
        output,
        font,
        backend,
        fonts,
    } = parse_io(args, "export")?;
    let fonts = load_font_bytes(&fonts)?;
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
    encode_movie(&frames, movie.fps, out, &output, &input, used, audio)
}

/// Encode pre-rendered, per-frame scenes (e.g. emitted by @onda/react's
/// `renderFrames`) to a video. Input is a JSON array of scene graphs.
fn export_frames_command(args: &[String]) -> Result<()> {
    let Options {
        input,
        output,
        font,
        backend,
        fonts,
    } = parse_io(args, "export-frames")?;
    let fonts = load_font_bytes(&fonts)?;
    let out = Path::new(&output);

    let json = std::fs::read_to_string(&input)
        .with_context(|| format!("reading frames file '{input}'"))?;
    let (scenes, fps) = frames_scenes(&json, base_dir_of(&input))
        .with_context(|| format!("reading frames '{input}'"))?;
    let (frames, used) = render_scenes(&scenes, backend, font, &fonts)
        .with_context(|| format!("rendering frames '{input}'"))?;
    // A pre-evaluated frame sequence carries no soundtrack.
    encode_movie(&frames, fps, out, &output, &input, used, AudioMux::none())
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
            if audio.tracks.is_empty() {
                write_mp4(frames, fps, out, None)?;
            } else {
                let wav = build_audio_wav(&audio, fps).context("building the audio track")?;
                let result = write_mp4(frames, fps, out, Some(&wav));
                if let Some(dir) = wav.parent() {
                    let _ = std::fs::remove_dir_all(dir);
                }
                result?;
                muxed_audio = true;
            }
        }
        _ => bail!("unsupported output '{output}' — use a .gif or .mp4 extension"),
    }
    let (w, h) = (frames[0].width(), frames[0].height());
    let sound = if muxed_audio {
        format!(", {} audio clip(s)", audio.tracks.len())
    } else {
        String::new()
    };
    println!(
        "exported {input} -> {output} ({} frames, {w}x{h} @ {fps} fps, {backend} backend{sound})",
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
    scenes
        .iter()
        .map(|scene| {
            let frame = renderer.render(scene);
            Framebuffer::from_rgba(frame.width, frame.height, frame.pixels)
        })
        .collect()
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
    for scene in &raw {
        let expanded = onda_svg::expand_svg(scene, base_dir).context("expanding <svg> nodes")?;
        scenes.push(onda_image::load_images(&expanded, base_dir).context("loading images")?);
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

/// Encode frames as an MP4 by shelling out to ffmpeg (writes PNG frames to a
/// temp dir, then invokes the encoder). If `audio_wav` is given, it's muxed in
/// as an AAC stream and the output is trimmed to the shorter of the two.
fn write_mp4(frames: &[Framebuffer], fps: f32, out: &Path, audio_wav: Option<&Path>) -> Result<()> {
    let dir = std::env::temp_dir().join(format!("onda-export-{}", std::process::id()));
    std::fs::create_dir_all(&dir)
        .with_context(|| format!("creating temp dir '{}'", dir.display()))?;

    let result = (|| -> Result<()> {
        for (i, frame) in frames.iter().enumerate() {
            frame
                .write_png(dir.join(format!("frame_{i:05}.png")))
                .with_context(|| format!("writing frame {i}"))?;
        }
        let mut cmd = std::process::Command::new("ffmpeg");
        cmd.args([
            "-y",
            "-loglevel",
            "error",
            "-framerate",
            &fps.to_string(),
            "-i",
        ])
        .arg(dir.join("frame_%05d.png"));
        if let Some(wav) = audio_wav {
            cmd.arg("-i").arg(wav);
        }
        // Even dimensions are required by yuv420p/libx264.
        cmd.args([
            "-vf",
            "pad=ceil(iw/2)*2:ceil(ih/2)*2",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
        ]);
        if audio_wav.is_some() {
            // Encode the audio and stop at the shorter stream (video length).
            cmd.args(["-c:a", "aac", "-b:a", "192k", "-shortest"]);
        }
        let status = cmd.arg(out).status().context(
            "failed to launch ffmpeg — is it installed and on PATH? (.gif needs no tools)",
        )?;
        if !status.success() {
            bail!("ffmpeg exited unsuccessfully ({status})");
        }
        Ok(())
    })();

    let _ = std::fs::remove_dir_all(&dir);
    result
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
        // The CPU backend skips paths, so the canvas stays transparent.
        assert_eq!(frames[0].pixel(8, 8), [0, 0, 0, 0]);
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
