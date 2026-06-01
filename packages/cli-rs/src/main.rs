//! `onda` — the command-line adapter for the engine.
//!
//! Per the charter, the scene graph is the universal language and the renderer
//! is the platform; this tool is just an adapter that turns a scene-graph JSON
//! document into a rendered image. Any producer of that JSON (a React
//! reconciler, an AI system, a hand-authored file) renders the same way.
//!
//! Usage:
//!   onda render <scene.json> <out.png> [--system-fonts]

use std::path::Path;

use anyhow::{bail, Context, Result};
use onda_renderer::Renderer;
use onda_scene::Scene;

const USAGE: &str = "\
onda — render a scene-graph JSON document to a PNG

USAGE:
    onda render <scene.json> <out.png> [--system-fonts]

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
        other => bail!("unknown command '{other}'\n\n{USAGE}"),
    }
}

fn render_command(args: &[String]) -> Result<()> {
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
        bail!("render needs exactly an input and an output path\n\n{USAGE}");
    };

    let (width, height) = render_scene_file(Path::new(input), Path::new(output), font)?;
    println!("rendered {input} -> {output} ({width}x{height})");
    Ok(())
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
}
