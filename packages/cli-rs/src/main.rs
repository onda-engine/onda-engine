//! `onda` — the command-line adapter for the engine.
//!
//! Per the charter, the scene graph is the universal language and the renderer
//! is the platform; this tool is just an adapter that turns a scene-graph JSON
//! document into a rendered image. Any producer of that JSON (a React
//! reconciler, an AI system, a hand-authored file) renders the same way.
//!
//! Usage:
//!   onda render <scene.json> <out.png> [--system-fonts]
//!   onda export <movie.json> <out.gif|out.mp4> [--system-fonts]

use std::path::Path;

use anyhow::{bail, Context, Result};
use onda_animation::AnimatedScene;
use onda_renderer::{encode_gif, Framebuffer, Renderer};
use onda_scene::Scene;

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
    --system-fonts    Use the host's installed fonts instead of the bundled
                      default font. Note: output then depends on the machine.
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

/// Parse the shared `[--system-fonts]` + two positionals shape.
fn parse_io(args: &[String], verb: &str) -> Result<(String, String, FontMode)> {
    let mut positionals: Vec<&str> = Vec::new();
    let mut font = FontMode::Bundled;
    for arg in args {
        match arg.as_str() {
            "--system-fonts" => font = FontMode::System,
            flag if flag.starts_with('-') => bail!("unknown option '{flag}'\n\n{USAGE}"),
            value => positionals.push(value),
        }
    }
    let [input, output] = positionals.as_slice() else {
        bail!("{verb} needs exactly an input and an output path\n\n{USAGE}");
    };
    Ok((input.to_string(), output.to_string(), font))
}

fn render_command(args: &[String]) -> Result<()> {
    let (input, output, font) = parse_io(args, "render")?;
    let (width, height) = render_scene_file(Path::new(&input), Path::new(&output), font)?;
    println!("rendered {input} -> {output} ({width}x{height})");
    Ok(())
}

fn export_command(args: &[String]) -> Result<()> {
    let (input, output, font) = parse_io(args, "export")?;
    let out = Path::new(&output);

    let json =
        std::fs::read_to_string(&input).with_context(|| format!("reading movie file '{input}'"))?;
    let (frames, fps) =
        render_movie_json(&json, font).with_context(|| format!("rendering movie '{input}'"))?;
    encode_movie(&frames, fps, out, &output, &input)
}

/// Encode pre-rendered, per-frame scenes (e.g. emitted by @onda/react's
/// `renderFrames`) to a video. Input is a JSON array of scene graphs.
fn export_frames_command(args: &[String]) -> Result<()> {
    let (input, output, font) = parse_io(args, "export-frames")?;
    let out = Path::new(&output);

    let json = std::fs::read_to_string(&input)
        .with_context(|| format!("reading frames file '{input}'"))?;
    let (frames, fps) =
        render_frames_json(&json, font).with_context(|| format!("rendering frames '{input}'"))?;
    encode_movie(&frames, fps, out, &output, &input)
}

/// Encode rendered frames to the format implied by `out`'s extension.
fn encode_movie(
    frames: &[Framebuffer],
    fps: f32,
    out: &Path,
    output: &str,
    input: &str,
) -> Result<()> {
    match out
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("gif") => write_gif(frames, fps, out)?,
        Some("mp4") => write_mp4(frames, fps, out)?,
        _ => bail!("unsupported output '{output}' — use a .gif or .mp4 extension"),
    }
    let (w, h) = (frames[0].width(), frames[0].height());
    println!(
        "exported {input} -> {output} ({} frames, {w}x{h} @ {fps} fps)",
        frames.len()
    );
    Ok(())
}

/// Render every frame of an animated document (in parallel). Returns the frames
/// and fps. Timeline evaluation is a pure function of the frame, so the frames
/// render across all cores.
fn render_movie_json(json: &str, font: FontMode) -> Result<(Vec<Framebuffer>, f32)> {
    let doc: AnimatedScene =
        serde_json::from_str(json).context("movie JSON is not a valid animated scene")?;
    let scenes: Vec<Scene> = (0..doc.frame_count()).map(|n| doc.frame(n)).collect();
    let frames = onda_renderer::render_frames_parallel(&scenes, move || renderer_for(font));
    Ok((frames, doc.fps()))
}

/// Render a pre-evaluated sequence of scene graphs (one per frame, in parallel).
fn render_frames_json(json: &str, font: FontMode) -> Result<(Vec<Framebuffer>, f32)> {
    let scenes: Vec<Scene> =
        serde_json::from_str(json).context("frames JSON is not an array of scene graphs")?;
    let Some(first) = scenes.first() else {
        bail!("frames JSON contains no scenes");
    };
    let fps = first.composition.fps;
    let frames = onda_renderer::render_frames_parallel(&scenes, move || renderer_for(font));
    Ok((frames, fps))
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
/// temp dir, then invokes the encoder).
fn write_mp4(frames: &[Framebuffer], fps: f32, out: &Path) -> Result<()> {
    let dir = std::env::temp_dir().join(format!("onda-export-{}", std::process::id()));
    std::fs::create_dir_all(&dir)
        .with_context(|| format!("creating temp dir '{}'", dir.display()))?;

    let result = (|| -> Result<()> {
        for (i, frame) in frames.iter().enumerate() {
            frame
                .write_png(dir.join(format!("frame_{i:05}.png")))
                .with_context(|| format!("writing frame {i}"))?;
        }
        let status = std::process::Command::new("ffmpeg")
            .args([
                "-y",
                "-loglevel",
                "error",
                "-framerate",
                &fps.to_string(),
                "-i",
            ])
            .arg(dir.join("frame_%05d.png"))
            // Even dimensions are required by yuv420p/libx264.
            .args([
                "-vf",
                "pad=ceil(iw/2)*2:ceil(ih/2)*2",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
            ])
            .arg(out)
            .status()
            .context(
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

/// Read a scene-graph JSON document, render it, and write the result as a PNG.
/// Returns the rendered dimensions.
fn render_scene_file(input: &Path, output: &Path, font: FontMode) -> Result<(u32, u32)> {
    let json = std::fs::read_to_string(input)
        .with_context(|| format!("reading scene file '{}'", input.display()))?;
    let framebuffer = render_scene_json(&json, font)
        .with_context(|| format!("rendering scene '{}'", input.display()))?;
    framebuffer
        .write_png(output)
        .with_context(|| format!("writing PNG '{}'", output.display()))?;
    Ok((framebuffer.width(), framebuffer.height()))
}

/// Parse a scene-graph JSON document and render it to a framebuffer.
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

        let (w, h) = render_scene_file(&input, &output, FontMode::Bundled).unwrap();
        assert_eq!((w, h), (40, 24));
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
}
