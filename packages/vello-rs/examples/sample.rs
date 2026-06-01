//! Render an ONDA scene through the Vello backend to a PNG.
//!   cargo run -p onda-vello --example sample -- out.png

use onda_core::{Color, Size, Transform, Vec2};
use onda_scene::{Composition, Node, NodeKind, Scene, Shape, Text};
use onda_vello::VelloRenderer;

fn at(x: f32, y: f32) -> Transform {
    Transform {
        translate: Vec2::new(x, y),
        scale: Vec2::splat(1.0),
    }
}

fn main() {
    let Some(mut renderer) = VelloRenderer::new() else {
        eprintln!("no GPU adapter available");
        return;
    };

    let scene = Scene::new(Composition::new(1200, 360, 30.0, 1)).with_root(
        Node::group().with_children([
            Node::shape(
                Shape::rect(Size::new(1200.0, 360.0)).with_fill(Color::rgb(0.04, 0.05, 0.09)),
            ),
            // A genuinely rounded underline (onda-gpu drew this square).
            Node::shape(
                Shape::rounded_rect(Size::new(520.0, 10.0), 5.0)
                    .with_fill(Color::rgb(0.16, 0.45, 0.95)),
            )
            .with_transform(at(96.0, 250.0)),
            // A stroked ellipse outline — strokes are new with Vello.
            Node::shape(
                Shape::ellipse(Size::new(120.0, 120.0)).with_stroke(Color::rgb(0.9, 0.3, 0.4), 6.0),
            )
            .with_transform(at(980.0, 60.0)),
            // An arbitrary Bézier path (5-pointed star) — impossible without the
            // vector backend. Filled gold with a thin outline.
            Node::shape(
                Shape::path(
                    "M50 0 L61 35 L98 35 L68 57 L79 91 L50 70 L21 91 L32 57 L2 35 L39 35 Z",
                )
                .with_fill(Color::rgb(0.98, 0.78, 0.22))
                .with_stroke(Color::rgb(0.5, 0.35, 0.0), 2.0),
            )
            .with_transform(at(820.0, 70.0)),
            Node::new(NodeKind::Text(
                Text::new("Hello ONDA")
                    .with_font_size(96.0)
                    .with_color(Color::WHITE),
            ))
            .with_transform(at(96.0, 110.0)),
        ]),
    );

    let frame = renderer.render(&scene);

    let out = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "vello-hello.png".to_string());
    let file = std::io::BufWriter::new(std::fs::File::create(&out).unwrap());
    let mut encoder = png::Encoder::new(file, frame.width, frame.height);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    encoder
        .write_header()
        .unwrap()
        .write_image_data(&frame.pixels)
        .unwrap();
    println!(
        "wrote {}x{} Vello render to {out}",
        frame.width, frame.height
    );
}
