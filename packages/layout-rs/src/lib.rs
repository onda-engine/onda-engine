//! Resolve flex [`Layout`] containers into absolute child transforms.
//!
//! A pre-pass over the scene graph (like `onda-svg` / `onda-image`): for every
//! node carrying a [`Layout`], it measures the node's direct children and writes
//! each child's `transform.translate` to its computed slot, so the renderers
//! just draw — they never need to know about flexbox. The result is a plain
//! scene graph with everything positioned absolutely.
//!
//! A small CSS-flexbox subset: a main-axis direction (row/column), `justify`
//! (start/center/end/space-between/space-around), cross-axis `align`, `gap`, and
//! uniform `padding`. A container with explicit `width`/`height` distributes any
//! free space per `justify`; without them it shrink-wraps its content.
//!
//! Child sizes come from intrinsic geometry (shapes), decoded pixels (images),
//! a nested container's resolved box, or — for text, whose size depends on the
//! font — an injected `measure_text` callback (so this crate stays decoupled
//! from typography).

use onda_core::{Size, Vec2};
use onda_scene::{Align, Direction, Justify, Layout, Node, NodeKind, Scene, ShapeGeometry, Text};

/// Resolve every [`Layout`] in `scene`, returning a new scene whose laid-out
/// children carry absolute translations. `measure_text` returns the rendered
/// size of a text node (typically backed by the same font context the renderer
/// uses, so measurement matches drawing).
pub fn layout(scene: &Scene, measure_text: &dyn Fn(&Text) -> Size) -> Scene {
    Scene {
        composition: scene.composition,
        root: resolve(&scene.root, measure_text).0,
    }
}

/// Resolve a node bottom-up, returning the rewritten node and its layout size.
fn resolve(node: &Node, measure: &dyn Fn(&Text) -> Size) -> (Node, Size) {
    let mut children = Vec::with_capacity(node.children.len());
    let mut sizes = Vec::with_capacity(node.children.len());
    for child in &node.children {
        let (resolved, size) = resolve(child, measure);
        children.push(resolved);
        sizes.push(size);
    }

    let size = if let Some(layout) = &node.layout {
        arrange(layout, &mut children, &sizes)
    } else {
        intrinsic_size(node, &children, &sizes, measure)
    };

    (
        Node {
            children,
            ..node.clone()
        },
        size,
    )
}

/// Position `children` per the flex `layout`, returning the container's size.
fn arrange(layout: &Layout, children: &mut [Node], sizes: &[Size]) -> Size {
    let n = children.len();
    let row = layout.direction == Direction::Row;
    let main = |s: &Size| if row { s.width } else { s.height };
    let cross = |s: &Size| if row { s.height } else { s.width };

    let content_main: f32 =
        sizes.iter().map(main).sum::<f32>() + layout.gap * n.saturating_sub(1) as f32;
    let content_cross: f32 = sizes.iter().map(cross).fold(0.0, f32::max);

    let explicit_main = if row { layout.width } else { layout.height };
    let explicit_cross = if row { layout.height } else { layout.width };
    let pad = layout.padding;
    let outer_main = explicit_main.unwrap_or(content_main + 2.0 * pad);
    let outer_cross = explicit_cross.unwrap_or(content_cross + 2.0 * pad);
    let inner_cross = outer_cross - 2.0 * pad;
    let free = (outer_main - 2.0 * pad - content_main).max(0.0);

    // Main-axis distribution of free space (CSS justify-content).
    let (lead, extra_gap) = match layout.justify {
        Justify::Start => (0.0, 0.0),
        Justify::Center => (free / 2.0, 0.0),
        Justify::End => (free, 0.0),
        Justify::SpaceBetween if n > 1 => (0.0, free / (n - 1) as f32),
        Justify::SpaceBetween => (0.0, 0.0),
        Justify::SpaceAround if n > 0 => (free / (2.0 * n as f32), free / n as f32),
        Justify::SpaceAround => (0.0, 0.0),
    };

    let mut cursor = pad + lead;
    for (child, size) in children.iter_mut().zip(sizes) {
        let cross_pos = pad
            + match layout.align {
                Align::Start => 0.0,
                Align::Center => (inner_cross - cross(size)) / 2.0,
                Align::End => inner_cross - cross(size),
            };
        let (x, y) = if row {
            (cursor, cross_pos)
        } else {
            (cross_pos, cursor)
        };
        // Layout owns position inside a container; keep the child's scale/rotate.
        child.transform.translate = Vec2::new(x, y);
        cursor += main(size) + layout.gap + extra_gap;
    }

    if row {
        Size::new(outer_main, outer_cross)
    } else {
        Size::new(outer_cross, outer_main)
    }
}

/// The layout size of a node that is *not* itself a flex container.
fn intrinsic_size(
    node: &Node,
    children: &[Node],
    child_sizes: &[Size],
    measure: &dyn Fn(&Text) -> Size,
) -> Size {
    match &node.kind {
        NodeKind::Shape(shape) => match &shape.geometry {
            ShapeGeometry::Rect { size, .. } => *size,
            ShapeGeometry::Ellipse { size } => *size,
            // Arbitrary path bounds aren't computed yet; give it explicit size
            // via a wrapping layout container if it must participate in layout.
            ShapeGeometry::Path { .. } => Size::ZERO,
        },
        NodeKind::Image(image) => image
            .data
            .as_ref()
            .map(|d| Size::new(d.width as f32, d.height as f32))
            .unwrap_or(Size::ZERO),
        NodeKind::Text(text) => measure(text),
        // A plain container's box is the extent of its (already-positioned)
        // children — the bounding box from the local origin.
        NodeKind::Group | NodeKind::Svg(_) => {
            children
                .iter()
                .zip(child_sizes)
                .fold(Size::ZERO, |acc, (child, size)| {
                    let t = child.transform.translate;
                    Size::new(
                        acc.width.max(t.x + size.width),
                        acc.height.max(t.y + size.height),
                    )
                })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use onda_scene::{Composition, Shape};

    fn rect(w: f32, h: f32) -> Node {
        Node::shape(Shape::rect(Size::new(w, h)))
    }

    fn translate(node: &Node) -> Vec2 {
        node.transform.translate
    }

    /// Text measures to a fixed box, so tests don't depend on a font.
    fn measure(_t: &Text) -> Size {
        Size::new(100.0, 20.0)
    }

    fn run(root: Node) -> Node {
        let scene = Scene {
            composition: Composition::new(200, 200, 30.0, 1),
            root,
        };
        layout(&scene, &measure).root
    }

    #[test]
    fn row_packs_children_left_to_right_with_gap() {
        let root = run(Node::group()
            .with_layout(Layout {
                direction: Direction::Row,
                gap: 10.0,
                ..Layout::default()
            })
            .with_child(rect(30.0, 40.0))
            .with_child(rect(50.0, 20.0)));
        assert_eq!(translate(&root.children[0]), Vec2::new(0.0, 0.0));
        assert_eq!(translate(&root.children[1]), Vec2::new(40.0, 0.0)); // 30 + gap 10
    }

    #[test]
    fn column_stacks_top_to_bottom() {
        let root = run(Node::group()
            .with_layout(Layout {
                direction: Direction::Column,
                gap: 5.0,
                ..Layout::default()
            })
            .with_child(rect(20.0, 30.0))
            .with_child(rect(20.0, 10.0)));
        assert_eq!(translate(&root.children[0]), Vec2::new(0.0, 0.0));
        assert_eq!(translate(&root.children[1]), Vec2::new(0.0, 35.0)); // 30 + gap 5
    }

    #[test]
    fn center_justify_and_align_in_a_fixed_box() {
        // 200x200 box, one 40x40 child, centered both axes -> (80, 80).
        let root = run(Node::group()
            .with_layout(Layout {
                direction: Direction::Row,
                justify: Justify::Center,
                align: Align::Center,
                width: Some(200.0),
                height: Some(200.0),
                ..Layout::default()
            })
            .with_child(rect(40.0, 40.0)));
        assert_eq!(translate(&root.children[0]), Vec2::new(80.0, 80.0));
    }

    #[test]
    fn space_between_pushes_to_the_ends() {
        // 200-wide row, two 40-wide children -> first at 0, second at 160.
        let root = run(Node::group()
            .with_layout(Layout {
                direction: Direction::Row,
                justify: Justify::SpaceBetween,
                width: Some(200.0),
                ..Layout::default()
            })
            .with_child(rect(40.0, 10.0))
            .with_child(rect(40.0, 10.0)));
        assert_eq!(translate(&root.children[0]).x, 0.0);
        assert_eq!(translate(&root.children[1]).x, 160.0);
    }

    #[test]
    fn padding_offsets_the_first_child() {
        let root = run(Node::group()
            .with_layout(Layout {
                direction: Direction::Row,
                padding: 16.0,
                ..Layout::default()
            })
            .with_child(rect(10.0, 10.0)));
        assert_eq!(translate(&root.children[0]), Vec2::new(16.0, 16.0));
    }

    #[test]
    fn text_is_measured_via_the_callback() {
        // A centered text (measured 100x20) in a 300x100 box -> (100, 40).
        let root = run(Node::group()
            .with_layout(Layout {
                direction: Direction::Row,
                justify: Justify::Center,
                align: Align::Center,
                width: Some(300.0),
                height: Some(100.0),
                ..Layout::default()
            })
            .with_child(Node::text("hi")));
        assert_eq!(translate(&root.children[0]), Vec2::new(100.0, 40.0));
    }
}
