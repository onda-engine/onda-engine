//! Import an SVG and render it through the ONDA Vello backend to a PNG.
//!   cargo run -p onda-svg --example render -- out.png

use onda_scene::{Composition, Scene};
use onda_svg::import_svg;
use onda_vello::VelloRenderer;

// A small multi-path icon: a dark rounded backdrop, a green disc, an orange
// "play" triangle, and a blue stroked ring — exercising fills and strokes.
const SVG: &str = r##"<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240">
  <rect x="0" y="0" width="240" height="240" rx="32" fill="#0a0d17"/>
  <circle cx="120" cy="120" r="78" fill="#28c08a"/>
  <polygon points="100,86 100,154 160,120" fill="#ffb020"/>
  <circle cx="120" cy="120" r="96" fill="none" stroke="#3a72f0" stroke-width="8"/>
</svg>"##;

fn main() {
    let imported = import_svg(SVG).expect("valid SVG");
    println!(
        "imported {} top-level node(s), size {}x{}",
        imported.root.children.len(),
        imported.size.width,
        imported.size.height
    );

    let Some(mut renderer) = VelloRenderer::new() else {
        eprintln!("no GPU adapter available");
        return;
    };

    let (w, h) = (
        imported.size.width.ceil() as u32,
        imported.size.height.ceil() as u32,
    );
    let scene = Scene::new(Composition::new(w, h, 30.0, 1)).with_root(imported.root);
    let frame = renderer.render(&scene);

    let out = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "svg-render.png".to_string());
    let file = std::io::BufWriter::new(std::fs::File::create(&out).unwrap());
    let mut encoder = png::Encoder::new(file, frame.width, frame.height);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    encoder
        .write_header()
        .unwrap()
        .write_image_data(&frame.pixels)
        .unwrap();
    println!("wrote {}x{} render to {out}", frame.width, frame.height);
}
