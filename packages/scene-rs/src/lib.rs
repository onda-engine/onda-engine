//! The ONDA scene graph.
//!
//! Per the engine charter, the scene graph is the *universal language*: React,
//! JSON, visual editors, and AI systems all compile down to this one
//! representation, and the renderer consumes only this. So everything here is
//! plain data — `serde`-serializable, framework-agnostic, and free of any
//! reference to React, the DOM, a browser, or GPU types.
//!
//! A [`Scene`] pairs a [`Composition`] (resolution + timing, à la Remotion's
//! `<Composition>`) with a tree of [`Node`]s. v0 implements the primitives that
//! have a meaningful shape today — `Group`, `Text`, `Image`, `Shape`. Media and
//! camera nodes (`Video`, `Audio`, `Svg`, `Camera`) land alongside their
//! subsystems rather than as speculative stubs.

use onda_core::{Color, Size, Transform};
use serde::{Deserialize, Serialize};

/// Opaque, frontend-assigned identifier for a node. Optional: many nodes (e.g.
/// a wrapping group) don't need stable identity, but animation targeting and
/// reconciliation do.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct NodeId(pub u64);

/// Resolution and timing metadata for a render. Mirrors Remotion's
/// `<Composition>`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Composition {
    pub width: u32,
    pub height: u32,
    pub fps: f32,
    pub duration_in_frames: u32,
}

impl Composition {
    /// Construct a composition.
    pub fn new(width: u32, height: u32, fps: f32, duration_in_frames: u32) -> Self {
        Composition {
            width,
            height,
            fps,
            duration_in_frames,
        }
    }

    /// Duration in seconds (`duration_in_frames / fps`).
    pub fn duration_seconds(&self) -> f32 {
        if self.fps == 0.0 {
            0.0
        } else {
            self.duration_in_frames as f32 / self.fps
        }
    }

    /// Canvas size in pixels.
    pub fn size(&self) -> Size {
        Size::new(self.width as f32, self.height as f32)
    }
}

/// A node in the scene graph: shared properties plus a kind-specific payload and
/// an ordered list of children. Children inherit nothing implicitly except draw
/// order; transform/opacity composition is the renderer's job.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Node {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<NodeId>,
    #[serde(default)]
    pub transform: Transform,
    /// Opacity in `0.0..=1.0`.
    #[serde(default = "Node::default_opacity")]
    pub opacity: f32,
    pub kind: NodeKind,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub children: Vec<Node>,
}

/// The kind-specific payload of a [`Node`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum NodeKind {
    /// A pure container — no visual of its own, just transform + children.
    Group,
    Text(Text),
    Image(Image),
    Shape(Shape),
}

impl Node {
    fn default_opacity() -> f32 {
        1.0
    }

    /// Construct a node from its kind, with identity transform, full opacity,
    /// and no children.
    pub fn new(kind: NodeKind) -> Self {
        Node {
            id: None,
            transform: Transform::IDENTITY,
            opacity: 1.0,
            kind,
            children: Vec::new(),
        }
    }

    /// A container node.
    pub fn group() -> Self {
        Node::new(NodeKind::Group)
    }

    /// A text node with default styling.
    pub fn text(content: impl Into<String>) -> Self {
        Node::new(NodeKind::Text(Text::new(content)))
    }

    /// An image node referencing `src` (path or URL; loading lives elsewhere).
    pub fn image(src: impl Into<String>) -> Self {
        Node::new(NodeKind::Image(Image::new(src)))
    }

    /// A shape node.
    pub fn shape(shape: Shape) -> Self {
        Node::new(NodeKind::Shape(shape))
    }

    /// Builder: assign a stable id.
    pub fn with_id(mut self, id: u64) -> Self {
        self.id = Some(NodeId(id));
        self
    }

    /// Builder: set the transform.
    pub fn with_transform(mut self, transform: Transform) -> Self {
        self.transform = transform;
        self
    }

    /// Builder: set opacity, clamped to `0.0..=1.0`.
    pub fn with_opacity(mut self, opacity: f32) -> Self {
        self.opacity = opacity.clamp(0.0, 1.0);
        self
    }

    /// Builder: append a child.
    pub fn with_child(mut self, child: Node) -> Self {
        self.children.push(child);
        self
    }

    /// Builder: append several children.
    pub fn with_children(mut self, children: impl IntoIterator<Item = Node>) -> Self {
        self.children.extend(children);
        self
    }

    /// Total node count including `self`.
    pub fn count(&self) -> usize {
        1 + self.children.iter().map(Node::count).sum::<usize>()
    }

    /// Depth-first pre-order visit of `self` and all descendants.
    pub fn visit(&self, f: &mut impl FnMut(&Node)) {
        f(self);
        for child in &self.children {
            child.visit(f);
        }
    }
}

/// A run of text. Font selection, shaping, and layout belong to
/// `onda-typography`; this carries only what the author specified.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Text {
    pub content: String,
    #[serde(default = "Text::default_font_size")]
    pub font_size: f32,
    #[serde(default = "Text::default_color")]
    pub color: Color,
}

impl Text {
    fn default_font_size() -> f32 {
        48.0
    }

    fn default_color() -> Color {
        Color::WHITE
    }

    /// Construct text with default size (48px) and color (white).
    pub fn new(content: impl Into<String>) -> Self {
        Text {
            content: content.into(),
            font_size: Text::default_font_size(),
            color: Text::default_color(),
        }
    }

    /// Builder: set the font size in pixels.
    pub fn with_font_size(mut self, font_size: f32) -> Self {
        self.font_size = font_size;
        self
    }

    /// Builder: set the fill color.
    pub fn with_color(mut self, color: Color) -> Self {
        self.color = color;
        self
    }
}

/// A bitmap image referenced by `src`. Decoding/loading is the renderer's job.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Image {
    pub src: String,
}

impl Image {
    /// Construct from a path or URL.
    pub fn new(src: impl Into<String>) -> Self {
        Image { src: src.into() }
    }
}

/// A vector shape with optional fill and stroke.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Shape {
    pub geometry: ShapeGeometry,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fill: Option<Color>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stroke: Option<Stroke>,
}

/// The geometric form of a [`Shape`]. Paths, booleans, and morphing arrive with
/// `onda-vector`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(tag = "shape", rename_all = "snake_case")]
pub enum ShapeGeometry {
    Rect {
        size: Size,
        #[serde(default)]
        corner_radius: f32,
    },
    Ellipse {
        size: Size,
    },
}

/// A shape's outline.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Stroke {
    pub color: Color,
    pub width: f32,
}

impl Shape {
    /// A rectangle (square corners).
    pub fn rect(size: Size) -> Self {
        Shape {
            geometry: ShapeGeometry::Rect {
                size,
                corner_radius: 0.0,
            },
            fill: None,
            stroke: None,
        }
    }

    /// A rounded rectangle.
    pub fn rounded_rect(size: Size, corner_radius: f32) -> Self {
        Shape {
            geometry: ShapeGeometry::Rect {
                size,
                corner_radius,
            },
            fill: None,
            stroke: None,
        }
    }

    /// An ellipse inscribed in `size`.
    pub fn ellipse(size: Size) -> Self {
        Shape {
            geometry: ShapeGeometry::Ellipse { size },
            fill: None,
            stroke: None,
        }
    }

    /// Builder: set the fill color.
    pub fn with_fill(mut self, color: Color) -> Self {
        self.fill = Some(color);
        self
    }

    /// Builder: set the stroke.
    pub fn with_stroke(mut self, color: Color, width: f32) -> Self {
        self.stroke = Some(Stroke { color, width });
        self
    }
}

/// A renderable scene: a [`Composition`] plus a tree of [`Node`]s rooted at a
/// group.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Scene {
    pub composition: Composition,
    pub root: Node,
}

impl Scene {
    /// A scene with the given composition and an empty group root.
    pub fn new(composition: Composition) -> Self {
        Scene {
            composition,
            root: Node::group(),
        }
    }

    /// Builder: replace the root node.
    pub fn with_root(mut self, root: Node) -> Self {
        self.root = root;
        self
    }

    /// Total node count in the scene (root included).
    pub fn node_count(&self) -> usize {
        self.root.count()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use onda_core::Vec2;

    fn hd() -> Composition {
        Composition::new(1920, 1080, 30.0, 90)
    }

    #[test]
    fn composition_duration_and_size() {
        let c = hd();
        assert_eq!(c.duration_seconds(), 3.0);
        assert_eq!(c.size(), Size::new(1920.0, 1080.0));
    }

    #[test]
    fn duration_with_zero_fps_is_zero() {
        let c = Composition::new(100, 100, 0.0, 30);
        assert_eq!(c.duration_seconds(), 0.0);
    }

    #[test]
    fn builds_hello_onda_scene() {
        // The Milestone 1 target: <Text>Hello ONDA</Text>.
        let scene = Scene::new(hd()).with_root(Node::group().with_child(
            Node::text("Hello ONDA").with_transform(Transform {
                translate: Vec2::new(960.0, 540.0),
                ..Default::default()
            }),
        ));
        assert_eq!(scene.node_count(), 2);
    }

    #[test]
    fn opacity_is_clamped() {
        assert_eq!(Node::group().with_opacity(2.0).opacity, 1.0);
        assert_eq!(Node::group().with_opacity(-1.0).opacity, 0.0);
    }

    #[test]
    fn visit_is_pre_order() {
        let scene = Scene::new(hd()).with_root(
            Node::group()
                .with_id(1)
                .with_children([Node::group().with_id(2), Node::group().with_id(3)]),
        );
        let mut ids = Vec::new();
        scene.root.visit(&mut |n| {
            if let Some(NodeId(id)) = n.id {
                ids.push(id);
            }
        });
        assert_eq!(ids, vec![1, 2, 3]);
    }

    #[test]
    fn scene_round_trips_through_json() {
        let scene = Scene::new(hd()).with_root(
            Node::group().with_children([
                Node::text("Hello ONDA").with_opacity(0.5),
                Node::shape(
                    Shape::rounded_rect(Size::new(200.0, 100.0), 8.0)
                        .with_fill(Color::rgb(0.1, 0.2, 0.9)),
                ),
                Node::image("assets/logo.png"),
            ]),
        );
        let json = serde_json::to_string(&scene).unwrap();
        let back: Scene = serde_json::from_str(&json).unwrap();
        assert_eq!(scene, back);
    }

    #[test]
    fn deserializes_hand_written_json() {
        // The charter's "JSON becomes scene graph" path: a frontend can hand a
        // raw document to the engine. Omitted fields fall back to defaults.
        let json = r#"{
            "composition": { "width": 1280, "height": 720, "fps": 60.0, "duration_in_frames": 120 },
            "root": {
                "kind": { "type": "group" },
                "children": [
                    { "kind": { "type": "text", "content": "Hi" } }
                ]
            }
        }"#;
        let scene: Scene = serde_json::from_str(json).unwrap();
        assert_eq!(scene.node_count(), 2);
        assert_eq!(scene.root.opacity, 1.0); // defaulted
        match &scene.root.children[0].kind {
            NodeKind::Text(t) => {
                assert_eq!(t.content, "Hi");
                assert_eq!(t.font_size, 48.0); // defaulted
                assert_eq!(t.color, Color::WHITE); // defaulted
            }
            other => panic!("expected text node, got {other:?}"),
        }
    }
}
