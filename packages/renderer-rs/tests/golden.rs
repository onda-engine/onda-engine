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
use onda_scene::{
    Composition, Effect, Gradient, GradientStop, Matte, MatteMode, Node, NodeKind, Scene, Shape,
    Text,
};

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
        // RTT Phase 3: bloom/glow — bright accent text on a dark card blooms a soft
        // halo (bright-pass → large-σ blur → additive composite over the sharp text).
        (
            "bloom_text",
            scene(
                Node::group().with_children([
                    // Dark backdrop so the additive glow reads as light.
                    Node::shape(
                        Shape::rect(Size::new(W as f32, H as f32))
                            .with_fill(Color::from_rgba8(0x08, 0x08, 0x0A, 0xFF)),
                    ),
                    // A bright accent that blooms.
                    text_node("ONDA", 56.0, rose)
                        .with_transform(translate(20.0, 45.0))
                        .with_effect(Effect::Bloom {
                            threshold: 0.25,
                            intensity: 1.6,
                            sigma: 8.0,
                        }),
                ]),
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
        // RTT Phase 1 regression: a blurred shape on a node with a LARGE translate.
        // Locks the fix for the effect node's own transform being applied exactly
        // once (at composite-back); a double-apply would mis-place / clip this.
        (
            "blur_translated",
            scene(
                Node::group().with_child(
                    Node::shape(Shape::rect(Size::new(70.0, 45.0)).with_fill(rose))
                        .with_transform(translate(130.0, 55.0))
                        .with_effect(Effect::Blur { sigma: 5.0 }),
                ),
            ),
        ),
        // RTT color grade — the "land AI media" wedge: a multi-hue swatch grid
        // graded warm + contrasty + slightly desaturated, exactly as a
        // cinematographer would unify mismatched clips. A single per-pixel remap on
        // the captured group (no blur). Locks the deterministic grade math.
        (
            "grade_image",
            scene(
                Node::group()
                    .with_effect(Effect::ColorGrade {
                        exposure: 0.15,
                        contrast: 1.25,
                        saturation: 0.85,
                        temperature: 0.5,
                        tint: -0.1,
                    })
                    .with_children([
                        // A row of saturated primaries + neutrals — the grade's
                        // effect on each hue is visible side by side.
                        Node::shape(
                            Shape::rect(Size::new(60.0, 70.0))
                                .with_fill(Color::from_rgba8(0xE0, 0x30, 0x30, 0xFF)),
                        )
                        .with_transform(translate(10.0, 10.0)),
                        Node::shape(
                            Shape::rect(Size::new(60.0, 70.0))
                                .with_fill(Color::from_rgba8(0x30, 0xC0, 0x40, 0xFF)),
                        )
                        .with_transform(translate(70.0, 10.0)),
                        Node::shape(
                            Shape::rect(Size::new(60.0, 70.0))
                                .with_fill(Color::from_rgba8(0x30, 0x50, 0xE0, 0xFF)),
                        )
                        .with_transform(translate(130.0, 10.0)),
                        Node::shape(
                            Shape::rect(Size::new(60.0, 70.0))
                                .with_fill(Color::from_rgba8(0x80, 0x80, 0x80, 0xFF)),
                        )
                        .with_transform(translate(10.0, 80.0)),
                        Node::shape(
                            Shape::rect(Size::new(60.0, 70.0))
                                .with_fill(Color::from_rgba8(0xF0, 0xC0, 0x30, 0xFF)),
                        )
                        .with_transform(translate(70.0, 80.0)),
                        Node::shape(
                            Shape::rect(Size::new(60.0, 70.0))
                                .with_fill(Color::from_rgba8(0x20, 0xC8, 0xD0, 0xFF)),
                        )
                        .with_transform(translate(130.0, 80.0)),
                    ]),
            ),
        ),
        // RTT Phase 3: gooey / metaball morph — two overlapping filled circles on a
        // group with `Goo`. The blur spreads each circle's alpha; the alpha-threshold
        // sharpens it, so the gap between them fuses into a smooth solid neck (the
        // liquid "two drops coalescing" look). Same machinery as bloom (blur the
        // capture, then a per-pixel pass), locking the deterministic threshold math.
        (
            "goo_blobs",
            scene(
                Node::group()
                    .with_effect(Effect::Goo {
                        sigma: 7.0,
                        threshold: 0.5,
                    })
                    .with_children([
                        Node::shape(Shape::ellipse(Size::new(80.0, 80.0)).with_fill(rose))
                            .with_transform(translate(40.0, 35.0)),
                        // A ~14px gap to the first (edges at x=120 and x=134): the
                        // sigma-7 blur bridges it, so the threshold fuses a neck.
                        Node::shape(Shape::ellipse(Size::new(80.0, 80.0)).with_fill(rose))
                            .with_transform(translate(134.0, 35.0)),
                    ]),
            ),
        ),
        // RTT: frosted glass — a translucent panel carrying `BackdropBlur` over a
        // busy gradient-and-accents backdrop. Unlike the other effects (which
        // capture the node's OWN subtree), this samples the backdrop ALREADY drawn
        // behind the panel, blurs/grades/tints it, clips it to the rounded rect, and
        // composites it under the panel's own fill+stroke. The sharp accents outside
        // the panel vs. their softened selves inside it lock the backdrop-sample +
        // deterministic blur/grade math.
        (
            "frosted_glass",
            scene(
                Node::group().with_children([
                    // Busy backdrop: a gradient field plus two bright accents, so the
                    // blur (and brightness/saturation) are visibly different under glass.
                    Node::shape(Shape::rect(Size::new(W as f32, H as f32)).with_gradient(
                        Gradient::Linear {
                            start: Vec2::new(0.0, 0.0),
                            end: Vec2::new(W as f32, H as f32),
                            stops: vec![
                                GradientStop::new(0.0, Color::from_rgba8(0x24, 0x12, 0x4a, 0xFF)),
                                GradientStop::new(1.0, Color::from_rgba8(0x0c, 0x32, 0x3e, 0xFF)),
                            ],
                        },
                    )),
                    Node::shape(
                        Shape::ellipse(Size::new(70.0, 70.0))
                            .with_fill(Color::from_rgba8(0xFF, 0x4D, 0x8D, 0xFF)),
                    )
                    .with_transform(translate(20.0, 20.0)),
                    Node::shape(
                        Shape::ellipse(Size::new(60.0, 60.0))
                            .with_fill(Color::from_rgba8(0x3D, 0xD6, 0xFF, 0xFF)),
                    )
                    .with_transform(translate(150.0, 60.0)),
                    // The glass panel: backdrop blur frosts what's behind it; the panel's
                    // own low-alpha white fill + hairline stroke draw on top as the sheen.
                    Node::shape(
                        Shape::rounded_rect(Size::new(150.0, 96.0), 18.0)
                            .with_fill(Color::new(1.0, 1.0, 1.0, 0.12))
                            .with_stroke(Color::new(1.0, 1.0, 1.0, 0.5), 1.5),
                    )
                    .with_transform(translate(60.0, 30.0))
                    .with_effect(Effect::BackdropBlur {
                        sigma: 6.0,
                        tint: Color::new(1.0, 1.0, 1.0, 0.10),
                        brightness: 1.05,
                        saturation: 1.10,
                    }),
                ]),
            ),
        ),
        // MATTE: media-through-type. A diagonal gradient is revealed ONLY where
        // the white "ONDA" matte text inks (an alpha matte) — the signature
        // reveal-media-through-shape. The content node (the gradient rect) carries
        // `matte`; the matte source is the headline. Content RGB survives; only its
        // alpha is gated by the matte's coverage, integer-combined → byte-stable.
        (
            "matte_text",
            scene(
                Node::group().with_children([
                    Node::shape(
                        Shape::rect(Size::new(W as f32, H as f32))
                            .with_fill(Color::from_rgba8(0x0A, 0x0A, 0x0C, 0xFF)),
                    ),
                    Node::shape(Shape::rect(Size::new(W as f32, H as f32)).with_gradient(
                        Gradient::Linear {
                            start: Vec2::new(0.0, 0.0),
                            end: Vec2::new(W as f32, H as f32),
                            stops: vec![
                                GradientStop::new(0.0, Color::from_rgba8(0xFF, 0x4D, 0x8D, 0xFF)),
                                GradientStop::new(1.0, Color::from_rgba8(0x3D, 0xD6, 0xFF, 0xFF)),
                            ],
                        },
                    ))
                    .with_matte(
                        text_node("ONDA", 64.0, Color::WHITE).with_transform(translate(6.0, 100.0)),
                    ),
                ]),
            ),
        ),
        // MATTE (luminance): the same gradient content revealed through a white→black
        // horizontal gradient in LUMINANCE mode — a soft luma wipe (bright reveals,
        // dark hides). Locks the integer Rec.601 luma path.
        (
            "matte_luma",
            scene(
                Node::group().with_children([
                    Node::shape(
                        Shape::rect(Size::new(W as f32, H as f32))
                            .with_fill(Color::from_rgba8(0x0A, 0x0A, 0x0C, 0xFF)),
                    ),
                    Node::shape(Shape::rect(Size::new(W as f32, H as f32)).with_gradient(
                        Gradient::Linear {
                            start: Vec2::new(0.0, 0.0),
                            end: Vec2::new(W as f32, 0.0),
                            stops: vec![
                                GradientStop::new(0.0, Color::from_rgba8(0xFF, 0x4D, 0x8D, 0xFF)),
                                GradientStop::new(1.0, Color::from_rgba8(0x3D, 0xD6, 0xFF, 0xFF)),
                            ],
                        },
                    ))
                    .with_matte_mode(
                        Node::shape(Shape::rect(Size::new(W as f32, H as f32)).with_gradient(
                            Gradient::Linear {
                                start: Vec2::new(0.0, 0.0),
                                end: Vec2::new(W as f32, 0.0),
                                stops: vec![
                                    GradientStop::new(0.0, Color::WHITE),
                                    GradientStop::new(
                                        1.0,
                                        Color::from_rgba8(0x00, 0x00, 0x00, 0xFF),
                                    ),
                                ],
                            },
                        )),
                        MatteMode::Luminance,
                    ),
                ]),
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
