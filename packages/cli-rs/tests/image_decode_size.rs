//! Decode-to-display-size regression test (the "blank tile" production bug).
//!
//! A 12 MP+ phone photo used to be decoded to RGBA at FULL source resolution;
//! big or many such images overran the GPU's shared texture atlas and were
//! silently dropped — "my image doesn't show" with zero diagnostics. The fix
//! lives in `onda-image` (downscale at decode to ≤2× the node's display box,
//! always capped at a 4096 longest edge); this test exercises the whole CLI
//! pipeline shape: a real PNG on disk → `load_images` → CPU render, asserting
//! the decoded buffer is capped AND the image still renders non-blank pixels
//! exactly where it sits.

use onda_core::{Color, Transform, Vec2};
use onda_renderer::Framebuffer;
use onda_scene::{Composition, Image, ImageFit, Node, NodeKind, Scene};

#[test]
fn a_12mp_photo_in_a_small_box_decodes_capped_and_renders_non_blank() {
    // Synthesize the "phone photo": 6000×4000 (24 MP) solid teal, written as a
    // real PNG through the renderer's own encoder (no extra dependencies).
    let teal = Color::from_rgba8(20, 160, 220, 255);
    let dir = std::env::temp_dir().join(format!("onda-cli-decode-size-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let photo = dir.join("photo.png");
    Framebuffer::filled(6000, 4000, teal)
        .write_png(&photo)
        .expect("write synthetic photo");

    // An 800×600 comp showing the photo in a 400×300 box at (100, 100).
    let image = Node::new(NodeKind::Image(Image::new("photo.png").with_box(
        400.0,
        300.0,
        ImageFit::Cover,
    )))
    .with_transform(Transform {
        translate: Vec2::new(100.0, 100.0),
        ..Transform::IDENTITY
    });
    let scene =
        Scene::new(Composition::new(800, 600, 30.0, 1)).with_root(Node::group().with_child(image));

    let loaded = onda_image::load_images(&scene, &dir).expect("decode pass");
    std::fs::remove_dir_all(&dir).ok();

    // 1. The decoded buffer is right-sized: the 400×300 box buckets to 512×512,
    //    cover scale = 512/4000 = 0.128, ×2 retina/zoom headroom → 1536×1024 —
    //    a fraction of the 24 MP source and far under the 4096 global cap.
    let NodeKind::Image(img) = &loaded.root.children[0].kind else {
        panic!("expected image node");
    };
    let data = img.data.as_ref().expect("pixels attached");
    assert_eq!(
        (data.width, data.height),
        (1536, 1024),
        "decode must be capped to the display bucket, not the 6000×4000 source"
    );

    // 2. The render succeeds and the image's pixels are non-blank where it sits.
    let frame = onda_renderer::render(&loaded);
    for (x, y) in [(110, 110), (300, 250), (490, 390)] {
        let [r, g, b, a] = frame.pixel(x, y);
        assert_eq!(
            a, 255,
            "image pixel at ({x}, {y}) must be opaque, not blank"
        );
        // The source is flat teal, so the resampled pixels stay teal (±2 for
        // filter/rounding wiggle).
        for (got, want) in [(r, 20i32), (g, 160), (b, 220)] {
            assert!(
                (i32::from(got) - want).unsigned_abs() <= 2,
                "pixel at ({x}, {y}) should be the photo's teal, got ({r}, {g}, {b})"
            );
        }
    }
    // Outside the box the canvas stays untouched (transparent) — the image is
    // clipped to its 400×300 box, not stretched or misplaced.
    assert_eq!(
        frame.pixel(700, 50)[3],
        0,
        "canvas outside the image stays blank"
    );
}
