//! Render a shape scene on the GPU and write a PNG.
//!   cargo run -p onda-gpu --example shapes -- out.png

use onda_core::{Color, Size, Transform, Vec2};
use onda_gpu::GpuRenderer;
use onda_scene::{Composition, Node, Scene, Shape};

fn at(x: f32, y: f32) -> Transform {
    Transform {
        translate: Vec2::new(x, y),
        scale: Vec2::splat(1.0),
    }
}

fn main() {
    let Some(renderer) = GpuRenderer::new() else {
        eprintln!("no GPU adapter available");
        return;
    };

    let scene = Scene::new(Composition::new(800, 400, 30.0, 1)).with_root(
        Node::group().with_children([
            Node::shape(
                Shape::rect(Size::new(800.0, 400.0)).with_fill(Color::rgb(0.05, 0.06, 0.1)),
            ),
            // Three overlapping translucent circles — shows AA + src-over compositing.
            Node::shape(
                Shape::ellipse(Size::new(240.0, 240.0))
                    .with_fill(Color::new(0.91, 0.24, 0.34, 0.72)),
            )
            .with_transform(at(170.0, 50.0)),
            Node::shape(
                Shape::ellipse(Size::new(240.0, 240.0)).with_fill(Color::new(0.2, 0.6, 0.95, 0.72)),
            )
            .with_transform(at(300.0, 50.0)),
            Node::shape(
                Shape::ellipse(Size::new(240.0, 240.0)).with_fill(Color::new(0.3, 0.9, 0.55, 0.72)),
            )
            .with_transform(at(235.0, 150.0)),
            // An accent bar.
            Node::shape(
                Shape::rect(Size::new(640.0, 12.0)).with_fill(Color::rgb(0.16, 0.45, 0.95)),
            )
            .with_transform(at(80.0, 350.0)),
        ]),
    );

    let frame = renderer.render(&scene);

    let out = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "gpu-shapes.png".to_string());
    let file = std::io::BufWriter::new(std::fs::File::create(&out).unwrap());
    let mut encoder = png::Encoder::new(file, frame.width, frame.height);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    encoder
        .write_header()
        .unwrap()
        .write_image_data(&frame.pixels)
        .unwrap();
    println!("wrote {}x{} GPU render to {out}", frame.width, frame.height);
}
