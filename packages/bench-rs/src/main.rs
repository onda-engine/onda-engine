//! Render-throughput benchmark for the ONDA engine.
//!
//! Renders a representative 1080p motion-graphics frame repeatedly and reports
//! frames/sec for the CPU and GPU (Vello) backends. The CPU number is the
//! meaningful ONDA-vs-Remotion baseline (Remotion produces frames via Chromium
//! screenshots); the GPU number here is offscreen render + full CPU readback per
//! frame, so it is readback-bound — a real-time swapchain present would be far
//! faster.
//!
//!   cargo run --release -p onda-bench [-- frames]

use std::time::{Duration, Instant};

use onda_core::{Color, Size, Transform, Vec2};
use onda_renderer::Renderer;
use onda_scene::{Composition, Node, NodeKind, Scene, Shape, Text};
use onda_vello::VelloRenderer;

fn at(x: f32, y: f32) -> Transform {
    Transform {
        translate: Vec2::new(x, y),
        scale: Vec2::splat(1.0),
    }
}

/// A representative 1080p frame: backdrop, a few translucent discs, an accent
/// bar, a title and a subtitle.
fn scene() -> Scene {
    Scene::new(Composition::new(1920, 1080, 30.0, 1)).with_root(
        Node::group().with_children([
            Node::shape(
                Shape::rect(Size::new(1920.0, 1080.0)).with_fill(Color::rgb(0.04, 0.05, 0.09)),
            ),
            Node::shape(
                Shape::ellipse(Size::new(520.0, 520.0))
                    .with_fill(Color::new(0.16, 0.45, 0.95, 0.25)),
            )
            .with_transform(at(180.0, 120.0)),
            Node::shape(
                Shape::ellipse(Size::new(420.0, 420.0)).with_fill(Color::new(0.9, 0.3, 0.4, 0.22)),
            )
            .with_transform(at(1200.0, 420.0)),
            Node::shape(
                Shape::rect(Size::new(900.0, 12.0)).with_fill(Color::rgb(0.16, 0.45, 0.95)),
            )
            .with_transform(at(160.0, 640.0)),
            Node::new(NodeKind::Text(
                Text::new("ONDA Benchmark")
                    .with_font_size(140.0)
                    .with_color(Color::WHITE),
            ))
            .with_transform(at(160.0, 430.0)),
            Node::new(NodeKind::Text(
                Text::new("GPU-native motion graphics, no browser")
                    .with_font_size(48.0)
                    .with_color(Color::rgb(0.7, 0.75, 0.85)),
            ))
            .with_transform(at(164.0, 690.0)),
        ]),
    )
}

fn report(label: &str, frames: usize, elapsed: Duration) {
    let secs = elapsed.as_secs_f64();
    let fps = frames as f64 / secs;
    let ms = secs * 1000.0 / frames as f64;
    println!("  {label:<30} {fps:8.1} fps   {ms:7.2} ms/frame   ({secs:.2}s for {frames} frames)");
}

fn main() {
    let frames: usize = std::env::args()
        .nth(1)
        .and_then(|a| a.parse().ok())
        .unwrap_or(120);
    let scene = scene();
    println!("ONDA render benchmark — 1920x1080, {frames} frames\n");

    // CPU backend, single-threaded.
    let mut cpu = Renderer::with_default_font();
    std::hint::black_box(cpu.render(&scene)); // warm (font load + glyph cache)
    let start = Instant::now();
    for _ in 0..frames {
        std::hint::black_box(cpu.render(&scene));
    }
    report("CPU (1 thread)", frames, start.elapsed());

    // CPU backend, all cores (rayon) — the offline-render path.
    let scenes: Vec<Scene> = (0..frames).map(|_| scene.clone()).collect();
    std::hint::black_box(onda_renderer::render_frames_parallel(
        &scenes,
        Renderer::with_default_font,
    ));
    let start = Instant::now();
    std::hint::black_box(onda_renderer::render_frames_parallel(
        &scenes,
        Renderer::with_default_font,
    ));
    report("CPU (all cores, rayon)", frames, start.elapsed());

    // GPU backend: Vello (offscreen + readback).
    match VelloRenderer::new() {
        Some(mut gpu) => {
            std::hint::black_box(gpu.render(&scene));
            let start = Instant::now();
            for _ in 0..frames {
                std::hint::black_box(gpu.render(&scene));
            }
            report("GPU — Vello (offscreen + readback)", frames, start.elapsed());
        }
        None => println!("  GPU: no adapter available"),
    }
}
