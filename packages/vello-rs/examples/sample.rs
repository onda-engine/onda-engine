//! Render the Vello sample scene to a PNG.
//!   cargo run -p onda-vello --example sample -- out.png

fn main() {
    let Some(frame) = onda_vello::render_sample(800, 400) else {
        eprintln!("no GPU adapter available");
        return;
    };
    let out = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "vello-sample.png".to_string());
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
