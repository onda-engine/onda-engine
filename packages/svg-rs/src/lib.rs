//! Import SVG documents into the ONDA scene graph.
//!
//! Parses an SVG with `usvg` (which resolves CSS, units, `use`/defs, and
//! transforms) and flattens it into a tree of [`Shape::path`] nodes. Because
//! ONDA's [`Transform`](onda_core::Transform) is translate+scale only (no
//! rotation/skew), each path's *absolute* transform is baked directly into its
//! geometry — so the emitted nodes carry identity transforms and the path data
//! lives in the document's coordinate space.
//!
//! v1 scope: filled/stroked vector paths with solid colors, which covers the
//! vast majority of icons and logos. Gradients, patterns, embedded images, and
//! `<text>` are skipped for now (gradient/pattern paint maps to no fill).

use onda_core::{Color, Size};
use onda_scene::{Node, Shape};

/// An error importing an SVG document.
#[derive(Debug)]
pub enum SvgError {
    /// The SVG could not be parsed.
    Parse(usvg::Error),
}

impl std::fmt::Display for SvgError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SvgError::Parse(e) => write!(f, "failed to parse SVG: {e}"),
        }
    }
}

impl std::error::Error for SvgError {}

impl From<usvg::Error> for SvgError {
    fn from(e: usvg::Error) -> Self {
        SvgError::Parse(e)
    }
}

/// The result of importing an SVG: a root [`Node`] (a group of flattened path
/// nodes) plus the document's intrinsic size.
pub struct ImportedSvg {
    pub root: Node,
    pub size: Size,
}

/// Parse an SVG document and flatten it into an ONDA [`Node`] tree.
pub fn import_svg(svg: &str) -> Result<ImportedSvg, SvgError> {
    let options = usvg::Options::default();
    let tree = usvg::Tree::from_str(svg, &options)?;
    let mut children = Vec::new();
    collect(tree.root(), &mut children);
    let size = tree.size();
    Ok(ImportedSvg {
        root: Node::group().with_children(children),
        size: Size::new(size.width(), size.height()),
    })
}

/// Recursively flatten a usvg group's children into ONDA shape nodes.
fn collect(group: &usvg::Group, out: &mut Vec<Node>) {
    for node in group.children() {
        match node {
            usvg::Node::Group(child) => collect(child, out),
            usvg::Node::Path(path) => {
                if let Some(node) = path_to_node(path) {
                    out.push(node);
                }
            }
            // Embedded raster images and text are skipped in v1.
            usvg::Node::Image(_) | usvg::Node::Text(_) => {}
        }
    }
}

/// Convert a usvg path to an ONDA shape node, baking its absolute transform into
/// the geometry. Returns `None` for paths with no visible paint.
fn path_to_node(path: &usvg::Path) -> Option<Node> {
    let data = path.data().clone().transform(path.abs_transform())?;
    let svg_data = path_to_svg_string(&data);
    if svg_data.is_empty() {
        return None;
    }

    let mut shape = Shape::path(svg_data);
    if let Some(fill) = path.fill() {
        if let Some(color) = paint_color(fill.paint(), fill.opacity().get()) {
            shape = shape.with_fill(color);
        }
    }
    if let Some(stroke) = path.stroke() {
        if let Some(color) = paint_color(stroke.paint(), stroke.opacity().get()) {
            shape = shape.with_stroke(color, stroke.width().get());
        }
    }

    // Nothing to draw (e.g. a gradient-only fill we don't yet support).
    if shape.fill.is_none() && shape.stroke.is_none() {
        return None;
    }
    Some(Node::shape(shape))
}

/// A solid color from a usvg paint, premultiplied by `opacity`. `None` for
/// gradients/patterns (unsupported in v1).
fn paint_color(paint: &usvg::Paint, opacity: f32) -> Option<Color> {
    match paint {
        usvg::Paint::Color(c) => {
            let a = (opacity.clamp(0.0, 1.0) * 255.0).round() as u8;
            Some(Color::from_rgba8(c.red, c.green, c.blue, a))
        }
        _ => None,
    }
}

/// Serialize a tiny-skia path back to an SVG path-data string.
fn path_to_svg_string(path: &usvg::tiny_skia_path::Path) -> String {
    use usvg::tiny_skia_path::PathSegment;
    let mut out = String::new();
    for segment in path.segments() {
        match segment {
            PathSegment::MoveTo(p) => out.push_str(&format!("M{} {} ", p.x, p.y)),
            PathSegment::LineTo(p) => out.push_str(&format!("L{} {} ", p.x, p.y)),
            PathSegment::QuadTo(c, p) => {
                out.push_str(&format!("Q{} {} {} {} ", c.x, c.y, p.x, p.y))
            }
            PathSegment::CubicTo(c1, c2, p) => out.push_str(&format!(
                "C{} {} {} {} {} {} ",
                c1.x, c1.y, c2.x, c2.y, p.x, p.y
            )),
            PathSegment::Close => out.push_str("Z "),
        }
    }
    out.truncate(out.trim_end().len());
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use onda_scene::{NodeKind, ShapeGeometry};

    const RECT_SVG: &str = r##"<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80">
        <rect x="10" y="20" width="40" height="30" fill="#ff0000"/>
    </svg>"##;

    #[test]
    fn imports_a_rect_as_a_path() {
        let imported = import_svg(RECT_SVG).expect("parse");
        assert_eq!(imported.size, Size::new(100.0, 80.0));
        // One shape node, a path, with a red fill.
        assert_eq!(imported.root.children.len(), 1);
        match &imported.root.children[0].kind {
            NodeKind::Shape(shape) => {
                assert!(matches!(shape.geometry, ShapeGeometry::Path { .. }));
                assert_eq!(shape.fill, Some(Color::from_rgba8(255, 0, 0, 255)));
            }
            other => panic!("expected a shape node, got {other:?}"),
        }
    }

    #[test]
    fn rejects_invalid_svg() {
        assert!(import_svg("not an svg").is_err());
    }
}
