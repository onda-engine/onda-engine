//! Regression test for the "clipped/blended group occludes its later siblings"
//! bug.
//!
//! vello 0.3's fine rasterizer keeps `BLEND_STACK_SPLIT = 4` blend-stack levels
//! per tile in registers and spills deeper levels to a FIXED scratch buffer of
//! 4096 tile-levels for the whole frame. `onda-vello` used to push every blend
//! layer with an effectively infinite rect (`±1e7`), so each non-`Clip` layer
//! covered EVERY tile — at 5+ nested blend layers a full-HD frame (~8160 tiles)
//! overflowed the spill budget, vello set `bump.failed` in its coarse stage and
//! SILENTLY corrupted the frame: affected tiles rendered black and everything
//! composited after them (later siblings included) vanished. No error surfaced.
//!
//! The fix bounds each blend layer to its subtree's measured paint and, on the
//! native path, flattens a subtree to a texture instead of nesting non-`Clip`
//! layers past `MAX_BLEND_NEST` — so the encoder never relies on the spill path.
//!
//! Needs a GPU; the test SKIPS (passes trivially) when no adapter exists, so it
//! stays green on headless CI while guarding every dev machine and export box.

use onda_core::{Color, Size, Transform, Vec2};
use onda_scene::{BlendMode, Composition, Node, Scene, Shape, ShapeGeometry};
use onda_vello::VelloRenderer;

fn rect(w: f32, h: f32, color: Color) -> Node {
    Node::shape(Shape {
        geometry: ShapeGeometry::Rect {
            size: Size::new(w, h),
            corner_radius: 0.0,
        },
        fill: Some(color),
        gradient: None,
        stroke: None,
        shadow: None,
    })
}

#[test]
fn deep_blend_nest_keeps_later_siblings() {
    let Some(mut renderer) = VelloRenderer::new() else {
        eprintln!("no GPU adapter — skipping deep_blend_nest_keeps_later_siblings");
        return;
    };

    // Full HD so the frame has far more tiles than vello 0.3's 4096-tile-level
    // spill budget — the size class where the old encoding corrupted the frame.
    let (w, h) = (1920u32, 1080u32);
    let bg = rect(
        w as f32,
        h as f32,
        Color {
            r: 0.03,
            g: 0.03,
            b: 0.04,
            a: 1.0,
        },
    );

    // Six nested full-canvas clip + screen-blend groups around a full-canvas red
    // rect: 6 non-`Clip` blend layers deep, every one canvas-covering — the
    // minimal shape of the KenBurns/overlay stacking that used to black out the
    // frame and eat everything drawn after it.
    let red = Color {
        r: 0.85,
        g: 0.15,
        b: 0.15,
        a: 1.0,
    };
    let mut nest = rect(w as f32, h as f32, red);
    for _ in 0..6 {
        nest = Node::group()
            .with_clip(ShapeGeometry::Rect {
                size: Size::new(w as f32, h as f32),
                corner_radius: 0.0,
            })
            .with_blend(BlendMode::Screen)
            .with_child(nest);
    }

    // The LATER SIBLING — drawn after the nest pops all its layers. This is the
    // content the bug used to occlude.
    let magenta = Color {
        r: 1.0,
        g: 0.0,
        b: 0.9,
        a: 1.0,
    };
    let marker = rect(100.0, 100.0, magenta).with_transform(Transform {
        translate: Vec2::new(1700.0, 900.0),
        ..Transform::IDENTITY
    });

    let scene = Scene::new(Composition::new(w, h, 30.0, 1))
        .with_root(Node::group().with_children([bg, nest, marker]));
    let frame = renderer.render(&scene);
    assert_eq!((frame.width, frame.height), (w, h));

    let px = |x: u32, y: u32| {
        let o = ((y * w + x) * 4) as usize;
        (frame.pixels[o], frame.pixels[o + 1], frame.pixels[o + 2])
    };

    // The nest itself must render (screen-stacked red — bright, never black).
    let (nr, ng, nb) = px(200, 200);
    assert!(
        nr > 150,
        "deep blend nest rendered black/corrupt at (200,200): {:?}",
        (nr, ng, nb)
    );

    // And the later sibling must survive the nest.
    let (mr, mg, mb) = px(1750, 950);
    assert!(
        mr > 200 && mb > 150 && mg < 120,
        "later sibling occluded by the blend nest at (1750,950): {:?}",
        (mr, mg, mb)
    );
}
