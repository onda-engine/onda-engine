//! Flatten a scene into ordered GPU draw ops (shapes + text), preserving
//! painter's order so shapes and text composite correctly.

use bytemuck::{Pod, Zeroable};
use onda_core::{Transform, Vec2};
use onda_scene::{Node, NodeKind, Scene, ShapeGeometry};
use onda_typography::FontContext;

/// Per-instance data for the shape pipeline (`rect_min`, `rect_size`, `color`,
/// `kind`: 0 = rect, 1 = ellipse).
#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
pub struct ShapeInstance {
    pub rect_min: [f32; 2],
    pub rect_size: [f32; 2],
    pub color: [f32; 4],
    pub kind: u32,
}

/// Per-instance data for the text pipeline.
#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
pub struct TextInstance {
    pub rect_min: [f32; 2],
    pub rect_size: [f32; 2],
    pub color: [f32; 4],
}

/// A text block to draw: its coverage mask (R8) plus placement/color.
pub struct TextDraw {
    pub coverage: Vec<u8>,
    pub width: u32,
    pub height: u32,
    pub instance: TextInstance,
}

/// A draw op, referencing an entry in `shapes` or `texts` by index.
pub enum Op {
    Shape(u32),
    Text(u32),
}

/// The flattened scene, ready to turn into GPU draws.
pub struct Collected {
    pub shapes: Vec<ShapeInstance>,
    pub texts: Vec<TextDraw>,
    pub ops: Vec<Op>,
}

/// Walk the scene, rasterizing text via `fonts`, into ordered draw ops.
pub fn collect(scene: &Scene, fonts: &mut FontContext) -> Collected {
    let mut out = Collected {
        shapes: Vec::new(),
        texts: Vec::new(),
        ops: Vec::new(),
    };
    walk(&scene.root, Transform::IDENTITY, 1.0, fonts, &mut out);
    out
}

fn walk(
    node: &Node,
    parent: Transform,
    parent_opacity: f32,
    fonts: &mut FontContext,
    out: &mut Collected,
) {
    let transform = parent.then(&node.transform);
    let opacity = parent_opacity * node.opacity;

    match &node.kind {
        NodeKind::Shape(shape) => {
            if let Some(fill) = shape.fill {
                let (size, kind) = match shape.geometry {
                    ShapeGeometry::Rect { size, .. } => (size, 0u32),
                    ShapeGeometry::Ellipse { size } => (size, 1u32),
                };
                let a = transform.apply(Vec2::ZERO);
                let b = transform.apply(Vec2::new(size.width, size.height));
                let index = out.shapes.len() as u32;
                out.shapes.push(ShapeInstance {
                    rect_min: [a.x.min(b.x), a.y.min(b.y)],
                    rect_size: [(a.x - b.x).abs(), (a.y - b.y).abs()],
                    color: [fill.r, fill.g, fill.b, fill.a * opacity],
                    kind,
                });
                out.ops.push(Op::Shape(index));
            }
        }
        NodeKind::Text(text) => {
            let base_alpha = text.color.a * opacity;
            if base_alpha > 0.0 {
                if let Some(raster) = fonts.rasterize(&text.content, text.font_size) {
                    // v1 honors translation; scaled/rotated text is deferred (as on CPU).
                    let ox = transform.translate.x.round() as i32;
                    let oy = transform.translate.y.round() as i32;
                    let index = out.texts.len() as u32;
                    out.texts.push(TextDraw {
                        instance: TextInstance {
                            rect_min: [
                                (ox + raster.offset_x) as f32,
                                (oy + raster.offset_y) as f32,
                            ],
                            rect_size: [raster.width as f32, raster.height as f32],
                            color: [text.color.r, text.color.g, text.color.b, base_alpha],
                        },
                        coverage: raster.coverage,
                        width: raster.width,
                        height: raster.height,
                    });
                    out.ops.push(Op::Text(index));
                }
            }
        }
        // Groups have no visual; images are not drawn on the GPU yet.
        NodeKind::Group | NodeKind::Image(_) => {}
    }

    for child in &node.children {
        walk(child, transform, opacity, fonts, out);
    }
}
