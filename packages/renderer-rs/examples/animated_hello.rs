//! Animation made visible: a fade-and-slide-in of "Hello ONDA".
//!
//! Builds a base scene, attaches a timeline (opacity 0→1 and a downward slide
//! into place over the first half-second), evaluates it at a chosen frame, and
//! renders that frame to a PNG. Render a sequence of frames and you have motion.
//!
//! Run with:
//!   cargo run -p onda-renderer --example animated_hello --features png -- [frame] [out.png]

use onda_animation::{AnimatedProperty, Animation, Easing, Keyframe, Timeline, Track};
use onda_core::{Color, Size, Transform, Vec2};
use onda_renderer::Renderer;
use onda_scene::{Composition, Node, NodeId, NodeKind, Scene, Shape, Text};

const TITLE_ID: u64 = 1;

fn at(x: f32, y: f32) -> Transform {
    Transform {
        translate: Vec2::new(x, y),
        scale: Vec2::splat(1.0),
        ..Transform::IDENTITY
    }
}

fn base_scene() -> Scene {
    let backdrop =
        Node::shape(Shape::rect(Size::new(1200.0, 360.0)).with_fill(Color::rgb(0.04, 0.05, 0.09)));
    let underline = Node::shape(
        Shape::rounded_rect(Size::new(520.0, 10.0), 5.0).with_fill(Color::rgb(0.16, 0.45, 0.95)),
    )
    .with_transform(at(96.0, 250.0));

    // The title carries an id so the timeline can target it. Its authored
    // transform/opacity are the resting state; the timeline overrides them.
    let title = Node::new(NodeKind::Text(
        Text::new("Hello ONDA")
            .with_font_size(96.0)
            .with_color(Color::WHITE),
    ))
    .with_id(TITLE_ID)
    .with_transform(at(96.0, 110.0));

    Scene::new(Composition::new(1200, 360, 30.0, 30))
        .with_root(Node::group().with_children([backdrop, underline, title]))
}

fn intro_timeline() -> Timeline {
    Timeline::new()
        .with(Animation::new(
            NodeId(TITLE_ID),
            AnimatedProperty::Opacity {
                track: Track::new(vec![
                    Keyframe::new(0.0, 0.0),
                    Keyframe::eased(0.5, 1.0, Easing::EaseOutCubic),
                ]),
            },
        ))
        .with(Animation::new(
            NodeId(TITLE_ID),
            AnimatedProperty::Translate {
                track: Track::new(vec![
                    Keyframe::new(0.0, Vec2::new(96.0, 150.0)),
                    Keyframe::eased(0.5, Vec2::new(96.0, 110.0), Easing::EaseOutCubic),
                ]),
            },
        ))
}

fn main() {
    let mut args = std::env::args().skip(1);
    let frame: f32 = args.next().and_then(|s| s.parse().ok()).unwrap_or(15.0);
    let out = args
        .next()
        .unwrap_or_else(|| "animated-hello.png".to_string());

    let scene = intro_timeline().evaluate_frame(&base_scene(), frame);
    let framebuffer = Renderer::with_default_font().render(&scene);
    framebuffer.write_png(&out).expect("failed to write PNG");

    let abs = std::fs::canonicalize(&out).unwrap_or_else(|_| out.clone().into());
    println!("rendered frame {frame} to {}", abs.display());
}
