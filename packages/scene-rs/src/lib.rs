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

use onda_core::{Color, Size, Transform, Vec2};
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
    /// Optional clip region: when set, this node and its subtree are clipped to
    /// this geometry (in the node's local space). Rendered by vector backends
    /// (Vello); the CPU backend ignores it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub clip: Option<ShapeGeometry>,
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
    /// A reference to an SVG document, expanded into vector nodes by a
    /// vector-capable layer (see the `onda-svg` crate). Renderers that haven't
    /// expanded it draw nothing.
    Svg(Svg),
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
            clip: None,
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

    /// An SVG node referencing `src` (a file path/URL), expanded to vector nodes
    /// by `onda-svg`. See [`Svg`] for inline markup.
    pub fn svg(src: impl Into<String>) -> Self {
        Node::new(NodeKind::Svg(Svg::from_src(src)))
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

    /// Builder: clip this node and its subtree to `geometry` (local space).
    pub fn with_clip(mut self, geometry: ShapeGeometry) -> Self {
        self.clip = Some(geometry);
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
    /// Font family name (must be loaded by the renderer). `None` = the default
    /// (Open Sans). Bundled out of the box: "Open Sans", "IBM Plex Sans".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font_family: Option<String>,
    /// CSS weight 1..=1000 (400 = normal, 700 = bold). `None` = normal.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub weight: Option<u16>,
    /// Italic/oblique. `None` = upright.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub italic: Option<bool>,
    /// Rich multi-style runs. When non-empty, these replace `content` — each run
    /// is laid out inline and may override color/size/family/weight/style.
    /// Empty = a single run from `content`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub runs: Vec<TextRun>,
}

/// One styled span of a [`Text`]. Unset fields inherit the [`Text`]'s defaults.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TextRun {
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<Color>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font_size: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font_family: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub weight: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub italic: Option<bool>,
}

impl TextRun {
    /// A run of `text` inheriting the node's style.
    pub fn new(text: impl Into<String>) -> Self {
        TextRun {
            text: text.into(),
            color: None,
            font_size: None,
            font_family: None,
            weight: None,
            italic: None,
        }
    }

    /// Builder: override the run's color.
    pub fn with_color(mut self, color: Color) -> Self {
        self.color = Some(color);
        self
    }

    /// Builder: override the run's font size.
    pub fn with_font_size(mut self, font_size: f32) -> Self {
        self.font_size = Some(font_size);
        self
    }

    /// Builder: override the run's font family.
    pub fn with_font_family(mut self, family: impl Into<String>) -> Self {
        self.font_family = Some(family.into());
        self
    }

    /// Builder: override the run's weight (e.g. 700 for bold).
    pub fn with_weight(mut self, weight: u16) -> Self {
        self.weight = Some(weight);
        self
    }

    /// Builder: make the run italic.
    pub fn italic(mut self) -> Self {
        self.italic = Some(true);
        self
    }
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
            font_family: None,
            weight: None,
            italic: None,
            runs: Vec::new(),
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

    /// Builder: set the font family (must be loaded by the renderer).
    pub fn with_font_family(mut self, family: impl Into<String>) -> Self {
        self.font_family = Some(family.into());
        self
    }

    /// Builder: set the weight (e.g. 700 for bold).
    pub fn with_weight(mut self, weight: u16) -> Self {
        self.weight = Some(weight);
        self
    }

    /// Builder: make the text italic.
    pub fn italic(mut self) -> Self {
        self.italic = Some(true);
        self
    }

    /// Builder: set rich multi-style runs (overriding `content` when rendered).
    pub fn with_runs(mut self, runs: impl IntoIterator<Item = TextRun>) -> Self {
        self.runs = runs.into_iter().collect();
        self
    }

    /// The effective runs: the explicit [`Text::runs`], or a single run derived
    /// from `content` when none are set. Each run resolves color/size/family/
    /// weight/style against the node defaults.
    pub fn resolved_runs(&self) -> Vec<ResolvedRun> {
        let weight = self.weight.unwrap_or(400);
        let italic = self.italic.unwrap_or(false);
        if self.runs.is_empty() {
            return vec![ResolvedRun {
                text: self.content.clone(),
                color: self.color,
                font_size: self.font_size,
                font_family: self.font_family.clone(),
                weight,
                italic,
            }];
        }
        self.runs
            .iter()
            .map(|r| ResolvedRun {
                text: r.text.clone(),
                color: r.color.unwrap_or(self.color),
                font_size: r.font_size.unwrap_or(self.font_size),
                font_family: r.font_family.clone().or_else(|| self.font_family.clone()),
                weight: r.weight.unwrap_or(weight),
                italic: r.italic.unwrap_or(italic),
            })
            .collect()
    }
}

/// A [`TextRun`] with its style resolved against the [`Text`] node's defaults —
/// what a renderer actually draws.
#[derive(Debug, Clone, PartialEq)]
pub struct ResolvedRun {
    pub text: String,
    pub color: Color,
    pub font_size: f32,
    pub font_family: Option<String>,
    pub weight: u16,
    pub italic: bool,
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

/// A reference to an SVG document, to be expanded into vector [`Node`]s by a
/// vector-capable layer (the `onda-svg` crate). Carries inline `markup` and/or a
/// file `src` (markup wins when both are set). Decoupled from the renderer per
/// the charter: this is plain data; `onda-svg` does the expansion.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Svg {
    /// A file path or URL to the SVG document.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub src: Option<String>,
    /// Inline SVG markup (self-contained; preferred when present).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub markup: Option<String>,
}

impl Svg {
    /// Reference an SVG by file path or URL.
    pub fn from_src(src: impl Into<String>) -> Self {
        Svg {
            src: Some(src.into()),
            markup: None,
        }
    }

    /// Embed inline SVG markup (self-contained — no external file needed).
    pub fn from_markup(markup: impl Into<String>) -> Self {
        Svg {
            src: None,
            markup: Some(markup.into()),
        }
    }
}

/// A vector shape with optional fill, gradient, and stroke.
// Intentionally not `Copy`: `ShapeGeometry`/`Gradient` carry heap-backed data
// (path strings, gradient stops), so `Copy` was never on the table.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Shape {
    pub geometry: ShapeGeometry,
    /// Solid fill color. Ignored when [`Shape::gradient`] is set.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fill: Option<Color>,
    /// Gradient fill. Takes precedence over [`Shape::fill`] when present.
    /// Rendered by vector backends (Vello); the CPU backend falls back to the
    /// first stop's color.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gradient: Option<Gradient>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stroke: Option<Stroke>,
}

/// One color stop of a [`Gradient`]: a color at a normalized position `0..=1`
/// along the gradient.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct GradientStop {
    pub offset: f32,
    pub color: Color,
}

impl GradientStop {
    pub fn new(offset: f32, color: Color) -> Self {
        GradientStop { offset, color }
    }
}

/// A gradient paint, defined in the shape's local coordinate space (the same
/// space as its geometry — e.g. `0..width`, `0..height`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "gradient", rename_all = "snake_case")]
pub enum Gradient {
    /// A linear gradient from `start` to `end`.
    Linear {
        start: Vec2,
        end: Vec2,
        stops: Vec<GradientStop>,
    },
    /// A radial gradient centered at `center` with the given `radius`.
    Radial {
        center: Vec2,
        radius: f32,
        stops: Vec<GradientStop>,
    },
}

/// The geometric form of a [`Shape`]. Booleans and morphing arrive later (which
/// is part of why this is not `Copy` — see [`Shape`]).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
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
    /// An arbitrary vector outline as SVG path data (e.g. `"M0 0 L100 0 ..."`),
    /// in the node's local coordinate space. Rendered by vector backends
    /// (Vello); raster backends that can't tessellate paths skip it.
    Path {
        data: String,
    },
}

/// A shape's outline.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Stroke {
    pub color: Color,
    pub width: f32,
}

impl Shape {
    /// A shape from a geometry, with no paint yet.
    fn from_geometry(geometry: ShapeGeometry) -> Self {
        Shape {
            geometry,
            fill: None,
            gradient: None,
            stroke: None,
        }
    }

    /// A rectangle (square corners).
    pub fn rect(size: Size) -> Self {
        Shape::from_geometry(ShapeGeometry::Rect {
            size,
            corner_radius: 0.0,
        })
    }

    /// A rounded rectangle.
    pub fn rounded_rect(size: Size, corner_radius: f32) -> Self {
        Shape::from_geometry(ShapeGeometry::Rect {
            size,
            corner_radius,
        })
    }

    /// An ellipse inscribed in `size`.
    pub fn ellipse(size: Size) -> Self {
        Shape::from_geometry(ShapeGeometry::Ellipse { size })
    }

    /// An arbitrary outline from SVG path data (e.g. `"M0 0 L100 0 Z"`), in local
    /// coordinates. Renders on vector backends (Vello).
    pub fn path(data: impl Into<String>) -> Self {
        Shape::from_geometry(ShapeGeometry::Path { data: data.into() })
    }

    /// Builder: set the fill color.
    pub fn with_fill(mut self, color: Color) -> Self {
        self.fill = Some(color);
        self
    }

    /// Builder: set a gradient fill (takes precedence over a solid fill).
    pub fn with_gradient(mut self, gradient: Gradient) -> Self {
        self.gradient = Some(gradient);
        self
    }

    /// Builder: set a linear gradient fill between `start` and `end` (local
    /// coordinates).
    pub fn with_linear_gradient(
        self,
        start: Vec2,
        end: Vec2,
        stops: impl IntoIterator<Item = GradientStop>,
    ) -> Self {
        self.with_gradient(Gradient::Linear {
            start,
            end,
            stops: stops.into_iter().collect(),
        })
    }

    /// Builder: set a radial gradient fill (local coordinates).
    pub fn with_radial_gradient(
        self,
        center: Vec2,
        radius: f32,
        stops: impl IntoIterator<Item = GradientStop>,
    ) -> Self {
        self.with_gradient(Gradient::Radial {
            center,
            radius,
            stops: stops.into_iter().collect(),
        })
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
    fn path_shape_round_trips_through_json() {
        let scene = Scene::new(hd()).with_root(Node::group().with_child(Node::shape(
            Shape::path("M0 0 L10 0 L10 10 Z").with_fill(Color::rgb(1.0, 0.8, 0.2)),
        )));
        let json = serde_json::to_string(&scene).unwrap();
        // Tagged as a "path" with its data preserved verbatim.
        assert!(json.contains(r#""shape":"path""#));
        assert!(json.contains(r#""data":"M0 0 L10 0 L10 10 Z""#));
        let back: Scene = serde_json::from_str(&json).unwrap();
        assert_eq!(scene, back);
    }

    #[test]
    fn gradient_fill_round_trips_through_json() {
        let scene = Scene::new(hd()).with_root(Node::group().with_child(Node::shape(
            Shape::rect(Size::new(100.0, 20.0)).with_linear_gradient(
                Vec2::new(0.0, 0.0),
                Vec2::new(100.0, 0.0),
                [
                    GradientStop::new(0.0, Color::rgb(1.0, 0.0, 0.0)),
                    GradientStop::new(1.0, Color::rgb(0.0, 0.0, 1.0)),
                ],
            ),
        )));
        let json = serde_json::to_string(&scene).unwrap();
        assert!(json.contains(r#""gradient":"linear""#));
        let back: Scene = serde_json::from_str(&json).unwrap();
        assert_eq!(scene, back);
    }

    #[test]
    fn svg_node_round_trips_through_json() {
        let scene = Scene::new(hd()).with_root(Node::group().with_children([
            Node::svg("logo.svg"),
            Node::new(NodeKind::Svg(Svg::from_markup("<svg/>"))),
        ]));
        let json = serde_json::to_string(&scene).unwrap();
        assert!(json.contains(r#""type":"svg""#));
        assert!(json.contains(r#""src":"logo.svg""#));
        assert!(json.contains(r#""markup":"<svg/>""#));
        let back: Scene = serde_json::from_str(&json).unwrap();
        assert_eq!(scene, back);
    }

    #[test]
    fn clip_round_trips_through_json() {
        let scene = Scene::new(hd()).with_root(
            Node::group()
                .with_clip(ShapeGeometry::Rect {
                    size: Size::new(100.0, 50.0),
                    corner_radius: 8.0,
                })
                .with_child(Node::text("clipped")),
        );
        let json = serde_json::to_string(&scene).unwrap();
        assert!(json.contains(r#""clip""#));
        let back: Scene = serde_json::from_str(&json).unwrap();
        assert_eq!(scene, back);
    }

    #[test]
    fn text_runs_round_trip_and_resolve() {
        let scene = Scene::new(hd()).with_root(
            Node::group().with_child(Node::new(NodeKind::Text(
                Text::new("plain")
                    .with_font_size(40.0)
                    .with_color(Color::WHITE)
                    .with_runs([
                        TextRun::new("a "),
                        TextRun::new("b")
                            .with_color(Color::rgb(1.0, 0.0, 0.0))
                            .with_font_size(80.0),
                    ]),
            ))),
        );
        let json = serde_json::to_string(&scene).unwrap();
        assert!(json.contains(r#""runs""#));
        let back: Scene = serde_json::from_str(&json).unwrap();
        assert_eq!(scene, back);

        let NodeKind::Text(t) = &scene.root.children[0].kind else {
            panic!("expected text");
        };
        let resolved = t.resolved_runs();
        assert_eq!(resolved.len(), 2);
        assert_eq!(
            (resolved[0].color, resolved[0].font_size),
            (Color::WHITE, 40.0)
        ); // inherits
        assert_eq!(resolved[1].color, Color::rgb(1.0, 0.0, 0.0)); // overrides
        assert_eq!(resolved[1].font_size, 80.0);
    }

    #[test]
    fn plain_text_resolves_to_a_single_run() {
        let resolved = Text::new("hi").with_font_size(30.0).resolved_runs();
        assert_eq!(resolved.len(), 1);
        assert_eq!(resolved[0].text, "hi");
        assert_eq!(resolved[0].font_size, 30.0);
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
