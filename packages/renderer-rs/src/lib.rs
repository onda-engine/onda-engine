//! ONDA renderer — CPU reference rasterizer.
//!
//! This is the v0 backend: it walks a [`Scene`] and produces an in-memory RGBA8
//! [`Framebuffer`]. It is deliberately CPU-only and dependency-light so the
//! scene-graph → pixels *contract* (transform/opacity inheritance, src-over
//! compositing, coordinate conventions) can be pinned down and tested
//! deterministically without a GPU. The forthcoming wgpu backend must match this
//! reference output, which doubles as a correctness oracle for it.
//!
//! v0 scope: filled rectangles and ellipses with hard (non-antialiased) edges.
//! Deferred to their subsystems: text (needs `onda-typography`), images (needs
//! decoding), strokes, rounded-corner rasterization, and antialiasing.
//!
//! Coordinate convention: pixel space, origin top-left, +x right, +y down. A
//! shape's geometry is authored in its own local space with origin at top-left;
//! the node's (composed) transform places it on the canvas.

use onda_core::{Color, Transform, Vec2};
use onda_scene::{Node, NodeKind, Scene, Shape, ShapeGeometry};

/// An RGBA8 image: `width * height * 4` bytes, row-major, top-left origin.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Framebuffer {
    width: u32,
    height: u32,
    pixels: Vec<u8>,
}

impl Framebuffer {
    /// A fully transparent framebuffer.
    pub fn new(width: u32, height: u32) -> Self {
        Framebuffer {
            width,
            height,
            pixels: vec![0; (width as usize) * (height as usize) * 4],
        }
    }

    /// A framebuffer flood-filled with `color`.
    pub fn filled(width: u32, height: u32, color: Color) -> Self {
        let [r, g, b, a] = color.to_rgba8();
        let mut pixels = Vec::with_capacity((width as usize) * (height as usize) * 4);
        for _ in 0..(width as usize) * (height as usize) {
            pixels.extend_from_slice(&[r, g, b, a]);
        }
        Framebuffer {
            width,
            height,
            pixels,
        }
    }

    pub fn width(&self) -> u32 {
        self.width
    }

    pub fn height(&self) -> u32 {
        self.height
    }

    /// Raw RGBA8 bytes (row-major, top-left origin).
    pub fn as_bytes(&self) -> &[u8] {
        &self.pixels
    }

    /// The `[r, g, b, a]` at `(x, y)`. Panics if out of bounds.
    pub fn pixel(&self, x: u32, y: u32) -> [u8; 4] {
        let i = self.index(x, y);
        [
            self.pixels[i],
            self.pixels[i + 1],
            self.pixels[i + 2],
            self.pixels[i + 3],
        ]
    }

    fn index(&self, x: u32, y: u32) -> usize {
        assert!(
            x < self.width && y < self.height,
            "pixel ({x}, {y}) out of bounds"
        );
        ((y as usize) * (self.width as usize) + (x as usize)) * 4
    }

    /// Composite `src` over the existing pixel at `(x, y)` (straight-alpha
    /// src-over). No-op if out of bounds, so callers can rasterize freely.
    fn blend(&mut self, x: u32, y: u32, src: Color) {
        if x >= self.width || y >= self.height || src.a <= 0.0 {
            return;
        }
        let i = self.index(x, y);
        let dst = Color::from_rgba8(
            self.pixels[i],
            self.pixels[i + 1],
            self.pixels[i + 2],
            self.pixels[i + 3],
        );
        let out = over(src, dst).to_rgba8();
        self.pixels[i..i + 4].copy_from_slice(&out);
    }
}

/// Straight-alpha "source over destination" Porter-Duff compositing.
fn over(src: Color, dst: Color) -> Color {
    let out_a = src.a + dst.a * (1.0 - src.a);
    if out_a <= 0.0 {
        return Color::TRANSPARENT;
    }
    let blend = |s: f32, d: f32| (s * src.a + d * dst.a * (1.0 - src.a)) / out_a;
    Color::new(
        blend(src.r, dst.r),
        blend(src.g, dst.g),
        blend(src.b, dst.b),
        out_a,
    )
}

/// Render a scene to a fresh, transparent framebuffer sized to its composition.
pub fn render(scene: &Scene) -> Framebuffer {
    let mut fb = Framebuffer::new(scene.composition.width, scene.composition.height);
    render_node(&mut fb, &scene.root, Transform::IDENTITY, 1.0);
    fb
}

fn render_node(fb: &mut Framebuffer, node: &Node, parent: Transform, parent_opacity: f32) {
    let transform = parent.then(&node.transform);
    let opacity = parent_opacity * node.opacity;

    match &node.kind {
        NodeKind::Group => {}
        NodeKind::Shape(shape) => rasterize_shape(fb, shape, transform, opacity),
        // Text needs shaping/atlas from onda-typography; images need decoding.
        NodeKind::Text(_) | NodeKind::Image(_) => {}
    }

    for child in &node.children {
        render_node(fb, child, transform, opacity);
    }
}

fn rasterize_shape(fb: &mut Framebuffer, shape: &Shape, transform: Transform, opacity: f32) {
    let Some(fill) = shape.fill else {
        return; // stroke-only shapes deferred to v1
    };
    let fill = fill.with_alpha(fill.a * opacity);
    if fill.a <= 0.0 {
        return;
    }

    let size = match shape.geometry {
        ShapeGeometry::Rect { size, .. } => size,
        ShapeGeometry::Ellipse { size } => size,
    };

    // The shape's local AABB is [0,0]..[w,h]; transform maps it to an
    // axis-aligned canvas box (only translate + scale, so no rotation).
    let a = transform.apply(Vec2::ZERO);
    let b = transform.apply(Vec2::new(size.width, size.height));
    let (x0, x1) = (a.x.min(b.x), a.x.max(b.x));
    let (y0, y1) = (a.y.min(b.y), a.y.max(b.y));

    let px_min = x0.floor().max(0.0) as u32;
    let py_min = y0.floor().max(0.0) as u32;
    let px_max = (x1.ceil() as i64).clamp(0, fb.width() as i64) as u32;
    let py_max = (y1.ceil() as i64).clamp(0, fb.height() as i64) as u32;

    let center = Vec2::new((x0 + x1) * 0.5, (y0 + y1) * 0.5);
    let rx = (x1 - x0) * 0.5;
    let ry = (y1 - y0) * 0.5;

    for py in py_min..py_max {
        for px in px_min..px_max {
            let sample = Vec2::new(px as f32 + 0.5, py as f32 + 0.5);
            let inside = match shape.geometry {
                ShapeGeometry::Rect { .. } => {
                    sample.x >= x0 && sample.x < x1 && sample.y >= y0 && sample.y < y1
                }
                ShapeGeometry::Ellipse { .. } => {
                    if rx <= 0.0 || ry <= 0.0 {
                        false
                    } else {
                        let nx = (sample.x - center.x) / rx;
                        let ny = (sample.y - center.y) / ry;
                        nx * nx + ny * ny <= 1.0
                    }
                }
            };
            if inside {
                fb.blend(px, py, fill);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use onda_core::Size;
    use onda_scene::Composition;

    fn comp(w: u32, h: u32) -> Composition {
        Composition::new(w, h, 30.0, 1)
    }

    #[test]
    fn empty_scene_is_transparent_and_correctly_sized() {
        let fb = render(&Scene::new(comp(4, 3)));
        assert_eq!((fb.width(), fb.height()), (4, 3));
        assert!(fb.as_bytes().iter().all(|&b| b == 0));
    }

    #[test]
    fn full_canvas_rect_fills_every_pixel() {
        let red = Color::rgb(1.0, 0.0, 0.0);
        let scene = Scene::new(comp(8, 8)).with_root(
            Node::group().with_child(Node::shape(Shape::rect(Size::new(8.0, 8.0)).with_fill(red))),
        );
        let fb = render(&scene);
        for y in 0..8 {
            for x in 0..8 {
                assert_eq!(fb.pixel(x, y), [255, 0, 0, 255]);
            }
        }
    }

    #[test]
    fn rect_respects_translation() {
        let blue = Color::rgb(0.0, 0.0, 1.0);
        let shape = Node::shape(Shape::rect(Size::new(2.0, 2.0)).with_fill(blue)).with_transform(
            Transform {
                translate: Vec2::new(4.0, 4.0),
                scale: Vec2::splat(1.0),
            },
        );
        let fb = render(&Scene::new(comp(8, 8)).with_root(Node::group().with_child(shape)));
        assert_eq!(fb.pixel(5, 5), [0, 0, 255, 255]); // inside [4,6)x[4,6)
        assert_eq!(fb.pixel(0, 0), [0, 0, 0, 0]); // outside -> untouched
        assert_eq!(fb.pixel(6, 6), [0, 0, 0, 0]); // just past the far edge
    }

    #[test]
    fn scale_grows_the_shape() {
        // A 1x1 unit rect scaled 10x covers a 10x10 px block.
        let shape = Node::shape(Shape::rect(Size::new(1.0, 1.0)).with_fill(Color::WHITE))
            .with_transform(Transform {
                translate: Vec2::ZERO,
                scale: Vec2::splat(10.0),
            });
        let fb = render(&Scene::new(comp(16, 16)).with_root(Node::group().with_child(shape)));
        let covered = (0..16)
            .flat_map(|y| (0..16).map(move |x| (x, y)))
            .filter(|&(x, y)| fb.pixel(x, y) == [255, 255, 255, 255])
            .count();
        assert_eq!(covered, 100);
    }

    #[test]
    fn node_opacity_scales_alpha() {
        let shape =
            Node::shape(Shape::rect(Size::new(4.0, 4.0)).with_fill(Color::rgb(1.0, 0.0, 0.0)))
                .with_opacity(0.5);
        let fb = render(&Scene::new(comp(4, 4)).with_root(Node::group().with_child(shape)));
        let [r, g, b, a] = fb.pixel(0, 0);
        assert_eq!([r, g, b], [255, 0, 0]); // color preserved over transparent
        assert_eq!(a, 128); // round(0.5 * 255)
    }

    #[test]
    fn group_opacity_multiplies_into_children() {
        let shape = Node::shape(Shape::rect(Size::new(4.0, 4.0)).with_fill(Color::WHITE));
        let root = Node::group()
            .with_opacity(0.5)
            .with_child(shape.with_opacity(0.5));
        let fb = render(&Scene::new(comp(4, 4)).with_root(root));
        assert_eq!(fb.pixel(0, 0)[3], 64); // 0.5 * 0.5 = 0.25 -> round(63.75) = 64
    }

    #[test]
    fn opaque_layers_composite_with_src_over() {
        let red =
            Node::shape(Shape::rect(Size::new(4.0, 4.0)).with_fill(Color::rgb(1.0, 0.0, 0.0)));
        // Blue covers only the right half via translation.
        let blue =
            Node::shape(Shape::rect(Size::new(2.0, 4.0)).with_fill(Color::rgb(0.0, 0.0, 1.0)))
                .with_transform(Transform {
                    translate: Vec2::new(2.0, 0.0),
                    scale: Vec2::splat(1.0),
                });
        let fb =
            render(&Scene::new(comp(4, 4)).with_root(Node::group().with_children([red, blue])));
        assert_eq!(fb.pixel(0, 0), [255, 0, 0, 255]); // red half
        assert_eq!(fb.pixel(3, 0), [0, 0, 255, 255]); // blue painted last
    }

    #[test]
    fn ellipse_fills_center_not_corner() {
        let shape = Node::shape(Shape::ellipse(Size::new(8.0, 8.0)).with_fill(Color::WHITE));
        let fb = render(&Scene::new(comp(8, 8)).with_root(Node::group().with_child(shape)));
        assert_eq!(fb.pixel(4, 4), [255, 255, 255, 255]); // center filled
        assert_eq!(fb.pixel(0, 0), [0, 0, 0, 0]); // corner outside the ellipse
    }

    #[test]
    fn nested_transforms_compose() {
        // Parent translates by (3,0); child by (2,0); a 1x1 rect should land at x=5.
        let inner = Node::shape(Shape::rect(Size::new(1.0, 1.0)).with_fill(Color::WHITE))
            .with_transform(Transform {
                translate: Vec2::new(2.0, 0.0),
                scale: Vec2::splat(1.0),
            });
        let root = Node::group()
            .with_transform(Transform {
                translate: Vec2::new(3.0, 0.0),
                scale: Vec2::splat(1.0),
            })
            .with_child(inner);
        let fb = render(&Scene::new(comp(8, 2)).with_root(root));
        assert_eq!(fb.pixel(5, 0), [255, 255, 255, 255]);
        assert_eq!(fb.pixel(4, 0), [0, 0, 0, 0]);
    }
}
