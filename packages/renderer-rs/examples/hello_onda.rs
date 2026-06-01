//! The Milestone-1 beginner example, made visible.
//!
//! Builds a small scene — a dark backdrop, a translucent accent disc, an accent
//! underline, and the words "Hello ONDA" — renders it on the CPU with the
//! bundled default font, and writes a PNG. Deterministic: the same code produces
//! the same image on any machine.
//!
//! Run with:
//!   cargo run -p onda-renderer --example hello_onda --features png [-- out.png]

use onda_core::{Color, Size, Transform, Vec2};
use onda_renderer::Renderer;
use onda_scene::{Composition, Node, NodeKind, Scene, Shape, Text};

fn at(x: f32, y: f32) -> Transform {
    Transform {
        translate: Vec2::new(x, y),
        scale: Vec2::splat(1.0),
    }
}

fn main() {
    let composition = Composition::new(1200, 360, 30.0, 1);

    let backdrop =
        Node::shape(Shape::rect(Size::new(1200.0, 360.0)).with_fill(Color::rgb(0.04, 0.05, 0.09)));

    // A soft brand-colored disc behind the text (translucent, so compositing shows).
    let disc = Node::shape(
        Shape::ellipse(Size::new(420.0, 420.0)).with_fill(Color::new(0.16, 0.45, 0.95, 0.22)),
    )
    .with_transform(at(120.0, -40.0));

    // An accent underline bar.
    let underline = Node::shape(
        Shape::rounded_rect(Size::new(520.0, 10.0), 5.0).with_fill(Color::rgb(0.16, 0.45, 0.95)),
    )
    .with_transform(at(96.0, 250.0));

    // The hero title: white Open Sans at 96px.
    let title = Node::new(NodeKind::Text(
        Text::new("Hello ONDA")
            .with_font_size(96.0)
            .with_color(Color::WHITE),
    ))
    .with_transform(at(96.0, 110.0));

    let scene = Scene::new(composition)
        .with_root(Node::group().with_children([backdrop, disc, underline, title]));

    let framebuffer = Renderer::with_default_font().render(&scene);

    let out = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "hello-onda.png".to_string());
    framebuffer.write_png(&out).expect("failed to write PNG");
    let abs = std::fs::canonicalize(&out).unwrap_or_else(|_| out.clone().into());
    println!(
        "wrote {}x{} image to {}",
        framebuffer.width(),
        framebuffer.height(),
        abs.display()
    );
}
