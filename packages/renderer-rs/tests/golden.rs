//! Golden-frame determinism harness.
//!
//! Renders a matrix of scene fixtures on the CPU reference backend (the
//! deterministic, GPU-free path, with the bundled font) and diffs each against a
//! committed golden PNG. This locks the engine's scene-graph → pixels contract:
//! any change to the rasterizer, gradients, strokes, paths, text, transforms, or
//! compositing shows up as a frame diff and fails CI — the kind of silent drift
//! that otherwise only surfaces by eyeballing a render.
//!
//! The match is tolerant of sub-perceptual differences (≤0.5% of pixels may
//! differ by >1/255 per channel) so the goldens stay portable across CPU
//! architectures (float rounding) while still catching any real rendering
//! change, which moves far more than that. The strict byte-identical-across-runs
//! guarantee is covered separately by the unit test in `lib.rs`.
//!
//! Regenerate goldens after an intentional change:
//!   ONDA_UPDATE_GOLDEN=1 cargo test -p onda-renderer --features png --test golden
#![cfg(feature = "png")]

use std::path::PathBuf;

use onda_core::{Color, Size, Transform, Vec2};
use onda_renderer::Renderer;
use onda_scene::{Composition, Effect, Gradient, GradientStop, Node, NodeKind, Scene, Shape, Text};

fn text_node(content: &str, size: f32, color: Color) -> Node {
    Node::new(NodeKind::Text(
        Text::new(content).with_font_size(size).with_color(color),
    ))
}

const W: u32 = 240;
const H: u32 = 150;

fn scene(root: Node) -> Scene {
    Scene::new(Composition::new(W, H, 30.0, 1)).with_root(root)
}

fn translate(x: f32, y: f32) -> Transform {
    Transform {
        translate: Vec2::new(x, y),
        ..Transform::IDENTITY
    }
}

/// The fixture matrix — one scene per engine capability. Add a case here, run
/// with `ONDA_UPDATE_GOLDEN=1` to mint its golden, and it's covered forever.
fn fixtures() -> Vec<(&'static str, Scene)> {
    let rose = Color::from_rgba8(0xD9, 0x6B, 0x82, 0xFF);
    let ink = Color::from_rgba8(0x1A, 0x1A, 0x1E, 0xFF);

    vec![
        // Solid fills: a rect and an ellipse.
        (
            "solid_shapes",
            scene(
                Node::group().with_children([
                    Node::shape(Shape::rect(Size::new(110.0, 110.0)).with_fill(ink))
                        .with_transform(translate(15.0, 20.0)),
                    Node::shape(Shape::ellipse(Size::new(90.0, 90.0)).with_fill(rose))
                        .with_transform(translate(135.0, 30.0)),
                ]),
            ),
        ),
        // Linear gradient (diagonal, two stops).
        (
            "linear_gradient",
            scene(Node::shape(
                Shape::rect(Size::new(W as f32, H as f32)).with_gradient(Gradient::Linear {
                    start: Vec2::new(0.0, 0.0),
                    end: Vec2::new(W as f32, H as f32),
                    stops: vec![
                        GradientStop::new(0.0, Color::from_rgba8(0x08, 0x08, 0x0A, 0xFF)),
                        GradientStop::new(1.0, rose),
                    ],
                }),
            )),
        ),
        // Radial gradient centered in the canvas.
        (
            "radial_gradient",
            scene(Node::shape(
                Shape::rect(Size::new(W as f32, H as f32)).with_gradient(Gradient::Radial {
                    center: Vec2::new(W as f32 / 2.0, H as f32 / 2.0),
                    radius: 110.0,
                    stops: vec![
                        GradientStop::new(0.0, rose),
                        GradientStop::new(1.0, Color::from_rgba8(0x08, 0x08, 0x0A, 0xFF)),
                    ],
                }),
            )),
        ),
        // Rounded rect with a stroke (fill + stroke + AA + corner radius).
        (
            "rounded_stroke",
            scene(
                Node::shape(
                    Shape::rounded_rect(Size::new(190.0, 100.0), 24.0)
                        .with_fill(ink)
                        .with_stroke(rose, 6.0),
                )
                .with_transform(translate(25.0, 25.0)),
            ),
        ),
        // Arbitrary SVG path (a filled triangle) — tests the kurbo path parse.
        (
            "path_triangle",
            scene(Node::shape(
                Shape::path("M20 130 L120 20 L220 130 Z").with_fill(rose),
            )),
        ),
        // Text (bundled font → deterministic glyph coverage).
        (
            "text",
            scene(Node::group().with_child(
                text_node("Onda 42", 56.0, Color::WHITE).with_transform(translate(12.0, 45.0)),
            )),
        ),
        // Overlapping semi-transparent rects (straight-alpha src-over).
        (
            "opacity_layers",
            scene(
                Node::group().with_children([
                    Node::shape(Shape::rect(Size::new(120.0, 120.0)).with_fill(rose))
                        .with_opacity(0.6)
                        .with_transform(translate(20.0, 15.0)),
                    Node::shape(
                        Shape::rect(Size::new(120.0, 120.0))
                            .with_fill(Color::from_rgba8(0x4A, 0x90, 0xD9, 0xFF)),
                    )
                    .with_opacity(0.6)
                    .with_transform(translate(90.0, 15.0)),
                ]),
            ),
        ),
        // Nested transforms (parent translate ∘ child scale).
        (
            "nested_transform",
            scene(
                Node::group()
                    .with_transform(translate(40.0, 30.0))
                    .with_child(
                        Node::shape(Shape::rect(Size::new(20.0, 20.0)).with_fill(rose))
                            .with_transform(Transform {
                                scale: Vec2::splat(4.0),
                                ..Transform::IDENTITY
                            }),
                    ),
            ),
        ),
        // A small composition: text over a gradient card with a stroked frame.
        (
            "card",
            scene(
                Node::group().with_children([
                    Node::shape(Shape::rect(Size::new(W as f32, H as f32)).with_gradient(
                        Gradient::Linear {
                            start: Vec2::new(0.0, 0.0),
                            end: Vec2::new(0.0, H as f32),
                            stops: vec![
                                GradientStop::new(0.0, Color::from_rgba8(0x14, 0x10, 0x18, 0xFF)),
                                GradientStop::new(1.0, Color::from_rgba8(0x08, 0x08, 0x0A, 0xFF)),
                            ],
                        },
                    )),
                    Node::shape(
                        Shape::rounded_rect(Size::new(200.0, 70.0), 12.0)
                            .with_fill(Color::from_rgba8(0x1A, 0x1A, 0x1E, 0xFF))
                            .with_stroke(rose, 2.0),
                    )
                    .with_transform(translate(20.0, 40.0)),
                    text_node("ONDA", 40.0, Color::WHITE).with_transform(translate(40.0, 58.0)),
                ]),
            ),
        ),
        // RTT Phase 1: a blurred text node (soft glyphs over transparency).
        (
            "blur_text",
            scene(
                Node::group().with_child(
                    text_node("Onda", 56.0, Color::WHITE)
                        .with_transform(translate(20.0, 45.0))
                        .with_effect(Effect::Blur { sigma: 6.0 }),
                ),
            ),
        ),
        // RTT Phase 1: a blurred filled shape (soft-edged rounded rect).
        (
            "blur_shape",
            scene(
                Node::group().with_child(
                    Node::shape(Shape::rect(Size::new(120.0, 90.0)).with_fill(rose))
                        .with_transform(translate(40.0, 30.0))
                        .with_effect(Effect::Blur { sigma: 5.0 }),
                ),
            ),
        ),
        // RTT Phase 1: blur on a group with several children — the whole subtree is
        // captured, blurred, and composited as one (effect-on-group semantics).
        (
            "blur_nested",
            scene(
                Node::group().with_child(
                    Node::group()
                        .with_transform(translate(30.0, 20.0))
                        .with_effect(Effect::Blur { sigma: 4.0 })
                        .with_children([
                            Node::shape(Shape::ellipse(Size::new(70.0, 70.0)).with_fill(rose)),
                            Node::shape(Shape::rect(Size::new(60.0, 60.0)).with_fill(ink))
                                .with_transform(translate(60.0, 30.0)),
                            text_node("hi", 36.0, Color::WHITE)
                                .with_transform(translate(20.0, 80.0)),
                        ]),
                ),
            ),
        ),
    ]
}

fn golden_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/golden")
}

/// Decode a golden PNG to straight-alpha RGBA8 + its dimensions.
fn read_png(path: &std::path::Path) -> (u32, u32, Vec<u8>) {
    let decoder = png::Decoder::new(std::io::BufReader::new(std::fs::File::open(path).unwrap()));
    let mut reader = decoder.read_info().unwrap();
    let mut buf = vec![0u8; reader.output_buffer_size().unwrap()];
    let info = reader.next_frame(&mut buf).unwrap();
    buf.truncate(info.buffer_size());
    (info.width, info.height, buf)
}

/// Fraction of pixels whose max per-channel difference exceeds 1/255.
fn diff_fraction(a: &[u8], b: &[u8]) -> f64 {
    let mut differing = 0usize;
    for (pa, pb) in a.chunks_exact(4).zip(b.chunks_exact(4)) {
        let d = (0..4)
            .map(|i| (pa[i] as i16 - pb[i] as i16).unsigned_abs())
            .max()
            .unwrap_or(0);
        if d > 1 {
            differing += 1;
        }
    }
    differing as f64 / (a.len() / 4) as f64
}

#[test]
fn golden_frames_match() {
    let update = std::env::var_os("ONDA_UPDATE_GOLDEN").is_some();
    let dir = golden_dir();
    std::fs::create_dir_all(&dir).unwrap();

    let mut renderer = Renderer::with_default_font();
    let mut failures = Vec::new();

    for (name, scene) in fixtures() {
        let fb = renderer.render(&scene);
        let golden = dir.join(format!("{name}.png"));

        if update || !golden.exists() {
            fb.write_png(&golden).unwrap();
            continue;
        }

        let (gw, gh, gbytes) = read_png(&golden);
        if (gw, gh) != (fb.width(), fb.height()) {
            failures.push(format!(
                "{name}: size {}x{} != golden {gw}x{gh}",
                fb.width(),
                fb.height()
            ));
            continue;
        }
        let frac = diff_fraction(fb.as_bytes(), &gbytes);
        if frac > 0.005 {
            // Write the actual frame next to the golden for inspection.
            let actual = dir.join(format!("{name}.actual.png"));
            fb.write_png(&actual).unwrap();
            failures.push(format!(
                "{name}: {:.2}% of pixels differ (> 0.5%); wrote {}",
                frac * 100.0,
                actual.display()
            ));
        }
    }

    assert!(
        failures.is_empty(),
        "golden frame mismatches (set ONDA_UPDATE_GOLDEN=1 to regenerate after an intentional change):\n  {}",
        failures.join("\n  ")
    );
}
