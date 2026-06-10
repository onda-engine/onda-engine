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
    /// Opt-in CINEMATIC color pipeline: render the screen-space finishing chain
    /// (bloom/blur/grade + light-wrap/halation) in LINEAR light with an ACES tone-map
    /// output, instead of the default gamma/sRGB math. Off by default → existing
    /// comps + goldens are byte-identical. GPU/export only (the CPU reference + the
    /// WebGPU preview fall back to the gamma path, like other GPU-only features).
    #[serde(default)]
    pub linear: bool,
    /// Composition-level cinematic FINISH: a screen-space chain run after the comp
    /// rasterizes, in scene-linear light with HDR headroom, ending in ONE ACES film
    /// tone-map (see [`Finish`]). This is the correct "looks shot" output transform —
    /// unlike per-node effects (Vello hands those back as 8-bit between passes, so no
    /// HDR survives), the finish decodes the final frame to float, composites the
    /// finishing in linear (bloom highlights exceed 1.0 and roll off filmically), and
    /// tone-maps once. `None` → the default gamma output. GPU/export only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub finish: Option<Finish>,
}

impl Composition {
    /// Construct a composition (gamma pipeline; opt into linear via [`with_linear`]).
    pub fn new(width: u32, height: u32, fps: f32, duration_in_frames: u32) -> Self {
        Composition {
            width,
            height,
            fps,
            duration_in_frames,
            linear: false,
            finish: None,
        }
    }

    /// Opt into the cinematic LINEAR + ACES finishing pipeline.
    pub fn with_linear(mut self, linear: bool) -> Self {
        self.linear = linear;
        self
    }

    /// Attach a composition-level cinematic [`Finish`] (linear HDR + ACES).
    pub fn with_finish(mut self, finish: Finish) -> Self {
        self.finish = Some(finish);
        self
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

/// A composition-level cinematic FINISH — the screen-space chain run in scene-linear
/// light after the comp rasterizes, ending in one ACES film tone-map. See
/// [`Composition::finish`]. The chain order: bloom + halation → exposure → grade
/// (temperature/contrast/saturation) → vignette → grain → ACES. Every field defaults
/// to a no-op, so `finish: { bloom }` behaves exactly as bloom-only.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Finish {
    /// Linear exposure multiplier applied before the tone-map (1.0 = neutral; >1
    /// lifts mids/highlights into the ACES shoulder for a brighter filmic roll-off).
    #[serde(default = "Finish::default_one")]
    pub exposure: f32,
    /// Comp-level bloom in linear HDR — bright pixels bleed real light that rolls
    /// off through the tone-map (not a clamped overlay). `None` = no bloom.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bloom: Option<FinishBloom>,
    /// Warm red/orange HALATION around highlights (film dye-layer scatter). 0 = off.
    #[serde(default)]
    pub halation: f32,
    /// Grade: white-balance shift, + warm (boost red / cut blue), − cool. 0 = neutral.
    #[serde(default)]
    pub temperature: f32,
    /// Grade: contrast around linear mid-grey. 1 = identity, >1 punchier.
    #[serde(default = "Finish::default_one")]
    pub contrast: f32,
    /// Grade: saturation. 1 = identity, 0 = greyscale, >1 richer.
    #[serde(default = "Finish::default_one")]
    pub saturation: f32,
    /// Vignette: radial edge darkening of the finished frame. 0 = off.
    #[serde(default)]
    pub vignette: f32,
    /// Film grain intensity added in linear light (luminance-banded). 0 = off.
    #[serde(default)]
    pub grain: f32,
    /// Grain animation seed — the reconciler injects the current frame, so grain
    /// *lives* (varies per frame) instead of sitting static like dirt on the lens.
    #[serde(default)]
    pub grain_seed: f32,
}

impl Finish {
    fn default_one() -> f32 {
        1.0
    }
}

impl Default for Finish {
    fn default() -> Self {
        Finish {
            exposure: 1.0,
            bloom: None,
            halation: 0.0,
            temperature: 0.0,
            contrast: 1.0,
            saturation: 1.0,
            vignette: 0.0,
            grain: 0.0,
            grain_seed: 0.0,
        }
    }
}

/// Linear-HDR bloom parameters for a [`Finish`].
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct FinishBloom {
    /// Blur σ of the highlight halo, in output px.
    pub sigma: f32,
    /// Brightness cutoff (0..1, on the linear luminance) above which pixels bloom.
    #[serde(default = "FinishBloom::default_threshold")]
    pub threshold: f32,
    /// Halo gain — how strongly the blurred highlights add back.
    #[serde(default = "FinishBloom::default_intensity")]
    pub intensity: f32,
}

impl FinishBloom {
    fn default_threshold() -> f32 {
        0.7
    }
    fn default_intensity() -> f32 {
        1.0
    }
}

/// Compositing blend mode for a node's subtree against what's behind it
/// (CSS `mix-blend-mode`). Vello renders the full set; the CPU reference
/// composites `Normal` (src-over) only.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum BlendMode {
    #[default]
    Normal,
    Multiply,
    Screen,
    Overlay,
    Darken,
    Lighten,
    ColorDodge,
    ColorBurn,
    HardLight,
    SoftLight,
    Difference,
    Exclusion,
    Hue,
    Saturation,
    Color,
    Luminosity,
}

impl BlendMode {
    fn is_normal(&self) -> bool {
        matches!(self, BlendMode::Normal)
    }
}

/// How a [`Matte`]'s rendered subtree becomes the coverage that reveals the
/// matted content (the pro "luma/alpha matte"; CSS `mask-mode`). The matte
/// subtree is rendered to its own texture; this picks which channel drives the
/// reveal, multiplying the content's alpha by it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MatteMode {
    /// Reveal where the matte is OPAQUE: content alpha ×= matte alpha. The
    /// signature media-through-type matte — an image/video shows only where the
    /// animated text or shape (drawn solid) covers. The default.
    #[default]
    Alpha,
    /// Reveal by the matte's BRIGHTNESS: content alpha ×= luma(matte.rgb) ×
    /// matte.alpha (Rec.601). White reveals, black hides — gradient wipes and
    /// luma-keyed mattes.
    Luminance,
}

/// A MATTE (track matte / mask): a renderable subtree whose alpha — or luminance,
/// per [`MatteMode`] — multiplies the matted node's content alpha, revealing the
/// content only through the matte's shape. The strictly-more-powerful sibling of
/// [`Node::clip`]: `clip` masks to a static geometry; a matte masks to a fully
/// rendered subtree (animated text, a gradient, an image). The signature
/// "media-through-type" move. `source` is `Box`ed because `Node` contains `Node`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Matte {
    /// Which channel of `source` drives the reveal (alpha vs. luminance).
    #[serde(default)]
    pub mode: MatteMode,
    /// The matte subtree, rendered to its own texture; its coverage reveals the
    /// matted node's content.
    pub source: Box<Node>,
}

/// One entry in a node's ordered, screen-space effect chain. Effects render the
/// node's subtree to an offscreen surface and post-process it before
/// compositing back (see the render-to-texture design). A `Vec<Effect>` (not a
/// scalar) keeps the order explicit — sharp → blur → bloom — as later variants
/// land. Both backends currently ignore a non-empty list; only the data model
/// is wired up, so existing scene JSON and goldens stay byte-identical.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(tag = "effect", rename_all = "snake_case")]
pub enum Effect {
    /// Screen-space Gaussian blur; `sigma` is the std-dev in OUTPUT px (matching
    /// CSS `blur()`).
    Blur { sigma: f32 },
    /// Directional (motion) blur: a 1D Gaussian blur of std-dev `sigma` (OUTPUT px)
    /// smeared along `angle` (radians; `0` = horizontal, `π/2` = vertical). Unlike
    /// `Blur` (separable H+V, omnidirectional), this blurs ONLY along the motion
    /// axis — the cinematic "in-motion" tell that reads as speed. Reuses the blur
    /// kernel as a single pass along `(cos angle, sin angle)`.
    DirectionalBlur { sigma: f32, angle: f32 },
    /// Glow / bloom: the subtree's bright regions (luminance above `threshold`,
    /// scaled by `intensity`) are blurred with a large `sigma` and composited
    /// *additively* over the sharp subtree. The single biggest "premium" tell —
    /// a bright accent (neon text, a lit shape) blooms a soft halo. Reuses the
    /// blur kernel; `threshold`/`intensity` are in straight-alpha luminance.
    Bloom {
        threshold: f32,
        intensity: f32,
        sigma: f32,
    },
    /// Cinematic color grade: a per-pixel color remap on the captured subtree — no
    /// blur, so it's a single cheap pass (unlike `Blur`/`Bloom`). The product's
    /// "land AI media" wedge: drop one grade on a group of mismatched AI-generated
    /// clips and they share a cinematographer's look. Applied in order:
    /// `exposure` (linear gain `2^exposure` — `0` is identity), `contrast` (around
    /// a 0.5 pivot — `1` is identity), `saturation` (lerp toward Rec.601 luma —
    /// `1` is identity, `0` grayscale), `temperature` (warm/cool, lifting R &
    /// lowering B for positive — `0` neutral) and `tint` (green/magenta on G — `0`
    /// neutral). The neutral identity (all-zero except `contrast`/`saturation` = 1)
    /// is a visual no-op.
    ColorGrade {
        exposure: f32,
        contrast: f32,
        saturation: f32,
        temperature: f32,
        tint: f32,
    },
    /// Chromatic aberration: a lens-fringe tell — the red and blue channels are
    /// sampled at a small radial offset `amount` (px) from the composition centre
    /// (green stays put), so edges split into red/cyan fringes. Per-pixel, cheap.
    ChromaticAberration { amount: f32 },
    /// Vignette: darken the subtree toward its edges — `amount` (0..1 strength at
    /// the corners) ramped over `softness` (0..1 of the radius the falloff spans).
    /// The cinematic edge-darkening that focuses the eye. Per-pixel.
    Vignette { amount: f32, softness: f32 },
    /// Posterize: quantize each color channel to `levels` discrete steps (≥2) — the
    /// flat, banded, screen-print / cel look. Per-pixel.
    Posterize { levels: f32 },
    /// Duotone: map luminance to a two-color gradient — shadows take `shadow`,
    /// highlights `highlight` (straight-alpha RGB, components `0..1`). The editorial
    /// / brand-tint look. Per-pixel.
    Duotone {
        shadow: [f32; 3],
        highlight: [f32; 3],
    },
    /// Chroma key: knock out a key color — pixels whose RGB is within `threshold`
    /// of `key` go transparent, ramping over `smoothness` for a soft matte edge.
    /// Green-screen compositing as a node effect. `key` is straight-alpha RGB `0..1`.
    ChromaKey {
        key: [f32; 3],
        threshold: f32,
        smoothness: f32,
    },
    /// Gooey / liquid / metaball morph: the subtree is blurred with `sigma`
    /// (reusing the blur kernel), then its alpha is sharpened around `threshold`
    /// (a steep smoothstep) so overlapping shapes — whose blurred halos merge —
    /// fuse into solid forms joined by smooth necks. `threshold` is the alpha
    /// cutoff in `0..1` (default ~`0.5`): blurred alpha above it snaps toward
    /// opaque, below it toward transparent, with a few-percent ramp for AA. RGB
    /// is kept (un-premultiply-aware), so a colored blob stays its color. The
    /// classic "drops of liquid coalescing" look — same machinery as `Bloom`
    /// (blur the capture, then a per-pixel pass), proving the ordered chain.
    Goo { sigma: f32, threshold: f32 },
    /// Film grain: a luminance-banded, animated monochrome noise added LATE over the
    /// subtree — the compositing "glue" that makes mismatched sources (an AI plate, a
    /// real product shot, vector type) read as one photographed image, and the dither
    /// that hides 8-bit banding on dark gradients. Grain peaks in the midtones and
    /// falls to zero at pure black/white (a `2·√(l·(1-l))` response), so deep shadows
    /// and clipped highlights stay clean. `intensity` is the strength (~`0.04`–`0.1`
    /// is filmic), `size` the grain scale in output px (`~1` = fine 35mm, larger =
    /// coarser), `seed` an animation offset — pass the frame number for *living*
    /// grain (a fixed value is static, like dirt on the lens). Added in LINEAR light
    /// when the composition opts in, else in gamma. Honored by Vello AND the CPU
    /// reference (gamma) so the preview is never blind to it.
    Grain {
        intensity: f32,
        #[serde(default = "Effect::default_unit")]
        size: f32,
        #[serde(default)]
        seed: f32,
    },
    /// Frosted glass (CSS `backdrop-filter`). The ODD ONE OUT: every other effect
    /// captures and post-processes this node's OWN subtree; `BackdropBlur` instead
    /// samples the ALREADY-COMPOSITED backdrop *behind* the node — within the
    /// node's `clip` region, or its own `Shape` geometry, or (failing both) its
    /// subtree bounds — blurs it by `sigma` (output px, like CSS `blur()`),
    /// optionally scales `brightness`/`saturation` (CSS-style, `1.0` = identity),
    /// and tints it toward `tint` by that color's alpha. The result is drawn as the
    /// node's backing; the node's own content (e.g. a translucent panel fill) then
    /// composites on top. Vello samples the rendered backdrop; the CPU reference
    /// samples its live framebuffer. A node carrying `BackdropBlur` ignores any
    /// other (subtree-capture) effects in the same list for now.
    BackdropBlur {
        /// Gaussian std-dev of the backdrop blur, in OUTPUT px (CSS `blur()`).
        sigma: f32,
        /// Tint laid over the blurred backdrop; the color's ALPHA is the strength
        /// (alpha 0 = no tint). Default = transparent (no tint).
        #[serde(default)]
        tint: Color,
        /// CSS `brightness()` multiplier on the blurred backdrop; `1.0` = identity.
        #[serde(default = "Effect::default_unit")]
        brightness: f32,
        /// CSS `saturate()` multiplier (lerp toward Rec.601 luma); `1.0` = identity,
        /// `0.0` = grayscale.
        #[serde(default = "Effect::default_unit")]
        saturation: f32,
    },
    /// Light-wrap: the #1 "integrated vs pasted" compositing tell. Like
    /// `BackdropBlur` it samples the ALREADY-COMPOSITED backdrop *behind* the node,
    /// but instead of laying it under the node it bleeds that blurred background
    /// light onto the node's own FEATHERED EDGES — the way a real lens lets a bright
    /// background spill a few pixels onto a foreground subject's silhouette, so a
    /// cut-out plate reads as *shot in* the scene, not pasted on top. The blurred
    /// backdrop (`sigma`) is added, in LINEAR light, over the inner edge band of the
    /// node's alpha (`strength` scales it; `0` = off). Resolved natively in `build`
    /// (like `BackdropBlur`); export/native only — the web preview draws the node
    /// un-wrapped (graceful degrade). A node carrying `LightWrap` ignores any other
    /// (subtree-capture) effects in the same list for now.
    LightWrap {
        /// Gaussian std-dev of the backdrop blur that gets wrapped onto the edges,
        /// in OUTPUT px. Larger = a softer, wider spill of background light.
        sigma: f32,
        /// How strongly the wrapped light is added onto the edge band; `0` = off,
        /// `~1` = a natural spill. Default `1.0`.
        #[serde(default = "Effect::default_unit")]
        strength: f32,
    },
}

impl Effect {
    /// A neutral [`Effect::ColorGrade`] — the identity remap (exposure 0,
    /// contrast 1, saturation 1, temperature 0, tint 0). Adjust the fields for a
    /// look.
    pub const NEUTRAL_GRADE: Effect = Effect::ColorGrade {
        exposure: 0.0,
        contrast: 1.0,
        saturation: 1.0,
        temperature: 0.0,
        tint: 0.0,
    };

    /// Serde default for unit-gain effect fields (`brightness`/`saturation` = 1.0).
    fn default_unit() -> f32 {
        1.0
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
    /// Optional MATTE (mask): reveal this node's content only through the matte
    /// subtree's alpha/luminance ([`Matte`]). The strictly-more-powerful sibling
    /// of `clip` (a static geometry) — a matte is a fully rendered subtree, e.g.
    /// media revealed through animated type. Honored via render-to-texture by
    /// Vello + the CPU reference; omitted from JSON when `None`, so existing
    /// scenes and goldens stay byte-identical.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub matte: Option<Matte>,
    /// Compositing blend mode for this node's subtree against the backdrop
    /// (CSS `mix-blend-mode`). Honored by Vello; the CPU reference composites
    /// `Normal` (src-over).
    #[serde(default, skip_serializing_if = "BlendMode::is_normal")]
    pub blend: BlendMode,
    /// Ordered screen-space effect chain (e.g. blur). Empty (the default) leaves
    /// the node untouched and is omitted from serialized JSON — so existing
    /// scenes and goldens are byte-identical. Honored via render-to-texture;
    /// backends that don't yet read it draw the subtree as-is.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub effects: Vec<Effect>,
    /// Optional flex layout: when set, this node positions its direct children
    /// (sets their `transform.translate`) per the rules — resolved by the
    /// `onda-layout` pre-pass before rendering, so backends just draw.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub layout: Option<Layout>,
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
    /// A video clip. Structurally an [`Image`] plus a source `time` — the frame
    /// at that time is decoded by a pre-pass (browser: `<video>`/WebCodecs in the
    /// player; native: ffmpeg) and attached as [`Video::data`], which renderers
    /// draw exactly like an image.
    Video(Video),
    /// A non-visual audio clip on the timeline. Renderers ignore it; the player
    /// plays it for preview, and (in future) export muxes it. Carried in the
    /// scene graph so it travels with the composition.
    Audio(Audio),
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
            matte: None,
            blend: BlendMode::Normal,
            effects: Vec::new(),
            layout: None,
            kind,
            children: Vec::new(),
        }
    }

    /// Builder: set the node's blend mode (CSS `mix-blend-mode`).
    pub fn with_blend(mut self, blend: BlendMode) -> Self {
        self.blend = blend;
        self
    }

    /// Builder: append an effect to this node's chain (applied in order).
    pub fn with_effect(mut self, effect: Effect) -> Self {
        self.effects.push(effect);
        self
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

    /// A video node referencing `src` (decoding lives elsewhere — see [`Video`]).
    pub fn video(src: impl Into<String>) -> Self {
        Node::new(NodeKind::Video(Video::new(src)))
    }

    /// A non-visual audio node referencing `src` (see [`Audio`]).
    pub fn audio(src: impl Into<String>) -> Self {
        Node::new(NodeKind::Audio(Audio::new(src)))
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

    /// Builder: reveal this node's content through `source`'s alpha (an alpha
    /// matte — the media-through-type / shape-wipe move). See [`Node::matte`].
    pub fn with_matte(mut self, source: Node) -> Self {
        self.matte = Some(Matte {
            mode: MatteMode::Alpha,
            source: Box::new(source),
        });
        self
    }

    /// Builder: reveal this node's content through `source`, reading its coverage
    /// per `mode` (alpha or luminance). See [`Node::matte`].
    pub fn with_matte_mode(mut self, source: Node, mode: MatteMode) -> Self {
        self.matte = Some(Matte {
            mode,
            source: Box::new(source),
        });
        self
    }

    /// Builder: flex-lay-out this node's direct children.
    pub fn with_layout(mut self, layout: Layout) -> Self {
        self.layout = Some(layout);
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
    /// Extra horizontal space between glyphs, in pixels (CSS `letter-spacing` /
    /// tracking). Added on top of the shaped advance after each glyph; `0` (the
    /// default) is natural spacing. May be negative to tighten.
    #[serde(default, skip_serializing_if = "is_zero")]
    pub letter_spacing: f32,
    /// Rich multi-style runs. When non-empty, these replace `content` — each run
    /// is laid out inline and may override color/size/family/weight/style.
    /// Empty = a single run from `content`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub runs: Vec<TextRun>,
}

/// Serde helper: omit a zero float (keeps serialized scenes clean + back-compat).
#[allow(clippy::trivially_copy_pass_by_ref)]
fn is_zero(v: &f32) -> bool {
    *v == 0.0
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
            letter_spacing: 0.0,
            runs: Vec::new(),
        }
    }

    /// Builder: set the font size in pixels.
    pub fn with_font_size(mut self, font_size: f32) -> Self {
        self.font_size = font_size;
        self
    }

    /// Builder: set letter-spacing (extra px between glyphs; CSS `letter-spacing`).
    pub fn with_letter_spacing(mut self, letter_spacing: f32) -> Self {
        self.letter_spacing = letter_spacing;
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

/// A bitmap image referenced by `src` (a file path, URL, or `data:` URI).
/// Decoding is a pre-pass (the `onda-image` crate) that fills [`Image::data`];
/// renderers draw from that and skip an image whose pixels aren't resolved yet.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Image {
    pub src: String,
    /// Decoded pixels, attached by the image-loading pass. Never serialized —
    /// the scene-graph JSON stays portable, carrying only `src`.
    #[serde(skip)]
    pub data: Option<ImageData>,
    /// Target box width in px. With `height`, the renderer fits the decoded image
    /// into this box per [`Image::fit`]. When either is `None` the image draws at
    /// its intrinsic pixel size (the original behavior).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub height: Option<f32>,
    /// How the decoded image is fitted into the `width`×`height` box. Ignored
    /// without a box. Defaults to [`ImageFit::Cover`].
    #[serde(default)]
    pub fit: ImageFit,
    /// Gaussian blur radius (sigma, in *source* pixels) applied to the decoded
    /// pixels by the image-loading pass. `0` (the default) leaves the image
    /// sharp. Animating this frame-to-frame gives a soft→sharp "focus pull"
    /// entrance. Applied in the shared decode pass, so native, GPU and CPU
    /// backends are byte-identical (no renderer support needed).
    #[serde(default, skip_serializing_if = "is_zero")]
    pub blur: f32,
}

/// How a bitmap is fitted into its `width`×`height` box. The renderer — which
/// knows the decoded intrinsic dimensions — computes the scale/crop; a pure
/// frame→scene function can't read those dimensions back.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ImageFit {
    /// Stretch to exactly fill the box, ignoring aspect ratio.
    Fill,
    /// Scale to cover the box (preserve aspect; crop the overflow) — the common
    /// "photo fills the frame" behavior, and the default.
    #[default]
    Cover,
    /// Scale to fit inside the box (preserve aspect; letterbox the remainder).
    Contain,
}

impl Image {
    /// Construct from a path, URL, or `data:` URI (no pixels yet).
    pub fn new(src: impl Into<String>) -> Self {
        Image {
            src: src.into(),
            data: None,
            width: None,
            height: None,
            fit: ImageFit::default(),
            blur: 0.0,
        }
    }

    /// Set the target box the decoded image is fitted into (see [`Image::fit`]).
    pub fn with_box(mut self, width: f32, height: f32, fit: ImageFit) -> Self {
        self.width = Some(width);
        self.height = Some(height);
        self.fit = fit;
        self
    }

    /// Set the gaussian blur sigma (source pixels) applied by the decode pass.
    pub fn with_blur(mut self, blur: f32) -> Self {
        self.blur = blur;
        self
    }

    /// Attach decoded pixels (used by the `onda-image` loading pass).
    pub fn with_data(mut self, data: ImageData) -> Self {
        self.data = Some(data);
        self
    }
}

/// A video clip. Mirrors [`Image`] (a `src` + an optional `width`×`height` box
/// fitted per [`ImageFit`]) and adds a source `time` (seconds): the frame to
/// show. Decoding is a pre-pass — the browser player seeks a `<video>`/WebCodecs
/// decoder, native export uses ffmpeg — that attaches the frame's pixels as
/// [`Video::data`]; renderers then draw that exactly like an image. A video whose
/// pixels aren't resolved yet draws nothing.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Video {
    pub src: String,
    /// Source position in seconds of the frame to display. The decoder picks the
    /// nearest frame; `0.0` is the first frame.
    #[serde(default)]
    pub time: f32,
    /// Decoded pixels for the current frame, attached by a decode pass. Never
    /// serialized — the JSON stays portable, carrying only `src` + `time`.
    #[serde(skip)]
    pub data: Option<ImageData>,
    /// Target box width in px. With `height`, the renderer fits the frame into
    /// this box per [`Video::fit`]. When either is `None` the frame draws at its
    /// intrinsic pixel size.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub height: Option<f32>,
    /// How the frame is fitted into the `width`×`height` box. Defaults to
    /// [`ImageFit::Cover`].
    #[serde(default)]
    pub fit: ImageFit,
}

impl Video {
    /// Construct from a path, URL, or `data:` URI (no pixels yet), at time 0.
    pub fn new(src: impl Into<String>) -> Self {
        Video {
            src: src.into(),
            time: 0.0,
            data: None,
            width: None,
            height: None,
            fit: ImageFit::default(),
        }
    }

    /// Set the source time (seconds) of the frame to display.
    pub fn at(mut self, time: f32) -> Self {
        self.time = time;
        self
    }

    /// Set the target box the frame is fitted into (see [`Video::fit`]).
    pub fn with_box(mut self, width: f32, height: f32, fit: ImageFit) -> Self {
        self.width = Some(width);
        self.height = Some(height);
        self.fit = fit;
        self
    }

    /// Attach decoded pixels for the current frame (used by a decode pass).
    pub fn with_data(mut self, data: ImageData) -> Self {
        self.data = Some(data);
        self
    }
}

/// A non-visual audio clip on the timeline. Renderers ignore it; it rides in the
/// scene graph so audio travels with the composition — the player plays it for
/// preview, and export can mux it. `start` is when the clip begins in the
/// composition (seconds); `start_at` trims into the source; `volume` is a 0..1
/// gain.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Audio {
    pub src: String,
    /// Composition time (seconds) at which the clip begins playing.
    #[serde(default)]
    pub start: f32,
    /// Seconds into the source to begin from (trim the head).
    #[serde(default)]
    pub start_at: f32,
    /// Linear gain, 0..1.
    #[serde(default = "Audio::default_volume")]
    pub volume: f32,
}

impl Audio {
    fn default_volume() -> f32 {
        1.0
    }

    /// Construct from a path, URL, or `data:` URI, starting at composition time 0,
    /// from the source's beginning, at full volume.
    pub fn new(src: impl Into<String>) -> Self {
        Audio {
            src: src.into(),
            start: 0.0,
            start_at: 0.0,
            volume: 1.0,
        }
    }
}

/// Decoded bitmap pixels: straight-alpha RGBA8, row-major, `width`×`height`.
/// Shared via `Arc` so cloning a scene per frame stays cheap.
#[derive(Debug, Clone, PartialEq)]
pub struct ImageData {
    pub width: u32,
    pub height: u32,
    pub rgba: std::sync::Arc<Vec<u8>>,
}

/// Main-axis direction of a [`Layout`] container.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Direction {
    /// Lay children out left-to-right.
    #[default]
    Row,
    /// Lay children out top-to-bottom.
    Column,
}

/// Main-axis distribution of free space in a [`Layout`] (CSS `justify-content`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Justify {
    #[default]
    Start,
    Center,
    End,
    SpaceBetween,
    SpaceAround,
}

/// Cross-axis alignment of children in a [`Layout`] (CSS `align-items`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Align {
    #[default]
    Start,
    Center,
    End,
}

/// Flex layout for a node's direct children — a small, CSS-flexbox-shaped subset
/// resolved to absolute child translations by the `onda-layout` pre-pass.
///
/// When `width`/`height` are omitted the container shrink-wraps its content (so
/// `justify` distribution only has an effect when an explicit size leaves free
/// space). Children are measured by their intrinsic size (shape geometry, image
/// pixels, measured text, or a nested container's resolved box).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Layout {
    #[serde(default)]
    pub direction: Direction,
    #[serde(default)]
    pub justify: Justify,
    #[serde(default)]
    pub align: Align,
    /// Space between adjacent children, in pixels.
    #[serde(default)]
    pub gap: f32,
    /// Uniform inner padding, in pixels.
    #[serde(default)]
    pub padding: f32,
    /// Wrap children onto multiple lines when they overflow the main axis
    /// (CSS `flex-wrap`). Needs a fixed main-axis size to have an effect.
    #[serde(default)]
    pub wrap: bool,
    /// Fixed container width; shrink-to-content when absent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<f32>,
    /// Fixed container height; shrink-to-content when absent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub height: Option<f32>,
}

impl Default for Layout {
    fn default() -> Self {
        Layout {
            direction: Direction::default(),
            justify: Justify::default(),
            align: Align::default(),
            gap: 0.0,
            padding: 0.0,
            wrap: false,
            width: None,
            height: None,
        }
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
    /// A drop shadow / glow drawn behind the shape (CSS `box-shadow`). Rendered by
    /// Vello as an analytic blurred rounded-rect; the CPU reference skips it
    /// (GPU-only, like clip/rotation).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shadow: Option<Shadow>,
}

/// A drop shadow / glow behind a [`Shape`] (CSS `box-shadow`): a blurred
/// solid-color rounded-rect, offset + grown by `spread`, in `color`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Shadow {
    pub color: Color,
    /// Gaussian blur std-dev in px (the softness).
    pub blur: f32,
    /// Shadow displacement from the shape (px). `(0,0)` = a centered glow.
    #[serde(default)]
    pub offset: Vec2,
    /// Grow the shadow box by this many px on every side (CSS spread). Default 0.
    #[serde(default)]
    pub spread: f32,
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
    /// A procedural FRACTAL-NOISE gradient — fBm (fractal Brownian motion) over
    /// Simplex noise: the "wispy, expensive" animated gradient (Stripe/Linear
    /// tier), NOT smooth blobs. Several octaves of noise (each higher-frequency,
    /// lower-amplitude) give detailed flowing structure; the field value `0..1`
    /// samples the `stops` color ramp. `scale` is the base spatial frequency
    /// (cycles across the shape), `time` advances the flow (animate per frame for
    /// a living gradient), `warp` domain-warps the field for richer organic
    /// structure. Rendered by Vello via a GPU compute pass; the CPU reference and
    /// the WebGPU PREVIEW degrade to the first stop's color — author it for native
    /// export (the premium-hero path).
    Fbm {
        stops: Vec<GradientStop>,
        #[serde(default = "Gradient::default_fbm_scale")]
        scale: f32,
        #[serde(default)]
        time: f32,
        #[serde(default)]
        warp: f32,
    },
}

impl Gradient {
    fn default_fbm_scale() -> f32 {
        2.0
    }
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
    /// A BOOLEAN combination of sub-shapes (After Effects' "Merge Paths"): each
    /// operand is resolved to a path in this geometry's local space, then folded
    /// together by `op` (union / difference / intersect / xor) into one outline that
    /// fills/strokes like any other geometry. Curves are flattened before the
    /// boolean; renderer-resolved on both backends (via i_overlay).
    Boolean {
        op: BooleanOp,
        operands: Vec<BooleanOperand>,
    },
}

/// The operation for a [`ShapeGeometry::Boolean`]. Operands fold pairwise, so for
/// `Difference` it's `operands[0]` minus the rest, and `Intersect` is the area
/// common to all.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BooleanOp {
    Union,
    Difference,
    Intersect,
    Xor,
}

/// One input to a [`ShapeGeometry::Boolean`]: a sub-geometry plus the transform that
/// places it in the boolean's local space (so positioned/scaled/rotated operands
/// combine correctly).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BooleanOperand {
    pub geometry: ShapeGeometry,
    pub transform: Transform,
}

/// Stroke end-cap style (CSS `stroke-linecap`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LineCap {
    #[default]
    Butt,
    Round,
    Square,
}

impl LineCap {
    fn is_default(&self) -> bool {
        matches!(self, LineCap::Butt)
    }
}

/// Stroke corner-join style (CSS `stroke-linejoin`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LineJoin {
    #[default]
    Miter,
    Round,
    Bevel,
}

impl LineJoin {
    fn is_default(&self) -> bool {
        matches!(self, LineJoin::Miter)
    }
}

/// A shape's outline. `dash` (on/off px, empty = solid), `cap`, and `join` are
/// honored by both backends (Vello + the tiny-skia CPU reference).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Stroke {
    pub color: Color,
    pub width: f32,
    #[serde(default, skip_serializing_if = "LineCap::is_default")]
    pub cap: LineCap,
    #[serde(default, skip_serializing_if = "LineJoin::is_default")]
    pub join: LineJoin,
    /// Dash pattern: alternating on/off lengths in px. Empty = a solid stroke.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub dash: Vec<f32>,
    /// Phase offset into the dash pattern (px). Animate it for a draw-on reveal.
    #[serde(default, skip_serializing_if = "is_zero")]
    pub dash_offset: f32,
    /// TRIM PATHS: draw only the `[start, end]` arc-length slice of this stroked
    /// outline (fractions 0..1 of the path's total length), rotated by `offset`.
    /// The mograph "line draw" — animate `end` 0→1 for a draw-on reveal. See [`Trim`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub trim: Option<Trim>,
}

/// A path TRIM (After Effects' "Trim Paths"): render only a contiguous arc-length
/// slice of the stroked outline. `start`/`end` are fractions 0..1 of the path's
/// total length; `offset` rotates the visible window around the path (wrapping on
/// closed shapes). The engine measures the path length and converts this to a
/// length-normalised dash, so a caller never needs to know the path's pixel length.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Trim {
    #[serde(default)]
    pub start: f32,
    #[serde(default = "Trim::default_end")]
    pub end: f32,
    #[serde(default)]
    pub offset: f32,
}

impl Trim {
    fn default_end() -> f32 {
        1.0
    }

    /// Resolve this trim against a path of arc length `length` (px) into how the
    /// stroke should be drawn. Both backends share this so the line-draw is identical.
    pub fn resolve(&self, length: f32) -> TrimDash {
        let start = self.start.clamp(0.0, 1.0);
        let end = self.end.clamp(0.0, 1.0);
        let span = end - start;
        if span >= 1.0 {
            return TrimDash::Solid; // whole path visible
        }
        if span <= 0.0 {
            return TrimDash::Hidden; // nothing visible
        }
        let on = span * length;
        // A gap ≥ the path length guarantees a single visible run (no repeat, even on
        // a closed path). Phase the pattern so the run begins at `(start + offset)·L`.
        let gap = length + on + 1.0;
        let dash_offset = -((start + self.offset) * length);
        TrimDash::Dash(vec![on, gap], dash_offset)
    }
}

/// How a [`Trim`] resolves for a given path length — what the stroke pass should do.
#[derive(Debug, Clone, PartialEq)]
pub enum TrimDash {
    /// The full path is visible — draw a normal solid (or explicitly-dashed) stroke.
    Solid,
    /// Nothing is visible — skip the stroke entirely.
    Hidden,
    /// Draw the stroke with this `(dash_pattern, dash_offset)`.
    Dash(Vec<f32>, f32),
}

impl Default for Trim {
    fn default() -> Self {
        Trim {
            start: 0.0,
            end: 1.0,
            offset: 0.0,
        }
    }
}

impl Shape {
    /// A shape from a geometry, with no paint yet.
    fn from_geometry(geometry: ShapeGeometry) -> Self {
        Shape {
            geometry,
            fill: None,
            gradient: None,
            stroke: None,
            shadow: None,
        }
    }

    /// Builder: add a drop shadow / glow behind the shape.
    pub fn with_shadow(mut self, shadow: Shadow) -> Self {
        self.shadow = Some(shadow);
        self
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

    /// A shape that is the BOOLEAN combination of `operands` (merge paths).
    pub fn boolean(op: BooleanOp, operands: Vec<BooleanOperand>) -> Self {
        Shape::from_geometry(ShapeGeometry::Boolean { op, operands })
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
        self.stroke = Some(Stroke {
            color,
            width,
            cap: LineCap::default(),
            join: LineJoin::default(),
            dash: Vec::new(),
            dash_offset: 0.0,
            trim: None,
        });
        self
    }

    /// Builder: TRIM the stroke to a `[start, end]` arc-length slice (the mograph
    /// line-draw). Requires a stroke — set one with [`Shape::with_stroke`] first; a
    /// no-op otherwise.
    pub fn with_trim(mut self, trim: Trim) -> Self {
        if let Some(stroke) = self.stroke.as_mut() {
            stroke.trim = Some(trim);
        }
        self
    }

    /// Builder: set the stroke's dash pattern (alternating on/off px). No-op if
    /// the shape has no stroke yet (call after [`Shape::with_stroke`]).
    pub fn with_stroke_dash(mut self, dash: impl Into<Vec<f32>>) -> Self {
        if let Some(s) = self.stroke.as_mut() {
            s.dash = dash.into();
        }
        self
    }

    /// Builder: set the stroke's cap + join. No-op without a stroke.
    pub fn with_stroke_caps(mut self, cap: LineCap, join: LineJoin) -> Self {
        if let Some(s) = self.stroke.as_mut() {
            s.cap = cap;
            s.join = join;
        }
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
    fn fbm_gradient_round_trips_and_defaults() {
        let scene = Scene::new(hd()).with_root(Node::group().with_child(Node::shape(
            Shape::rect(Size::new(1280.0, 720.0)).with_gradient(Gradient::Fbm {
                stops: vec![
                    GradientStop::new(0.0, Color::rgb(0.04, 0.04, 0.10)),
                    GradientStop::new(1.0, Color::rgb(1.0, 0.69, 0.48)),
                ],
                scale: 1.0,
                time: 4.0,
                warp: 0.5,
            }),
        )));
        let json = serde_json::to_string(&scene).unwrap();
        assert!(json.contains(r#""gradient":"fbm""#));
        let back: Scene = serde_json::from_str(&json).unwrap();
        assert_eq!(scene, back);

        // Minimal fBm JSON: only stops → scale defaults to 2.0, time/warp to 0.
        let json = r#"{ "composition": { "width": 1280, "height": 720, "fps": 30.0, "duration_in_frames": 1 },
            "root": { "kind": { "type": "shape",
                "geometry": { "shape": "rect", "size": { "width": 8, "height": 8 } },
                "gradient": { "gradient": "fbm", "stops": [
                    { "offset": 0.0, "color": { "r": 0.0, "g": 0.0, "b": 0.0, "a": 1.0 } } ] } } } }"#;
        let scene: Scene = serde_json::from_str(json).unwrap();
        match &scene.root.kind {
            NodeKind::Shape(s) => match s.gradient.as_ref().unwrap() {
                Gradient::Fbm {
                    scale, time, warp, ..
                } => assert_eq!((*scale, *time, *warp), (2.0, 0.0, 0.0)),
                _ => panic!("expected fbm"),
            },
            _ => panic!("expected shape"),
        }
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
    fn image_box_and_fit_round_trip_and_default() {
        // A boxed, contained image round-trips with its fit.
        let scene = Scene::new(hd()).with_root(Node::group().with_child(Node::new(
            NodeKind::Image(Image::new("a.png").with_box(120.0, 80.0, ImageFit::Contain)),
        )));
        let json = serde_json::to_string(&scene).unwrap();
        assert!(json.contains(r#""fit":"contain""#));
        assert!(json.contains(r#""width":120.0"#));
        let back: Scene = serde_json::from_str(&json).unwrap();
        assert_eq!(scene, back);

        // Hand-written JSON with no box / no fit → None box, Cover default.
        let json = r#"{ "composition": { "width": 1280, "height": 720, "fps": 30.0, "duration_in_frames": 1 },
            "root": { "kind": { "type": "group" }, "children": [ { "kind": { "type": "image", "src": "b.png" } } ] } }"#;
        let scene: Scene = serde_json::from_str(json).unwrap();
        match &scene.root.children[0].kind {
            NodeKind::Image(img) => {
                assert_eq!((img.width, img.height), (None, None));
                assert_eq!(img.fit, ImageFit::Cover);
            }
            _ => panic!("expected image"),
        }
    }

    #[test]
    fn video_box_time_round_trip_and_default() {
        // A boxed video at a source time round-trips with its time + fit.
        let scene = Scene::new(hd()).with_root(Node::group().with_child(Node::new(
            NodeKind::Video(Video::new("clip.mp4").at(1.5).with_box(
                640.0,
                360.0,
                ImageFit::Contain,
            )),
        )));
        let json = serde_json::to_string(&scene).unwrap();
        assert!(json.contains(r#""type":"video""#));
        assert!(json.contains(r#""time":1.5"#));
        assert!(json.contains(r#""fit":"contain""#));
        let back: Scene = serde_json::from_str(&json).unwrap();
        assert_eq!(scene, back);

        // Minimal video JSON: no time / box → time 0, None box, Cover default.
        let json = r#"{ "composition": { "width": 1280, "height": 720, "fps": 30.0, "duration_in_frames": 1 },
            "root": { "kind": { "type": "group" }, "children": [ { "kind": { "type": "video", "src": "v.mp4" } } ] } }"#;
        let scene: Scene = serde_json::from_str(json).unwrap();
        match &scene.root.children[0].kind {
            NodeKind::Video(v) => {
                assert_eq!(v.time, 0.0);
                assert_eq!((v.width, v.height), (None, None));
                assert_eq!(v.fit, ImageFit::Cover);
            }
            _ => panic!("expected video"),
        }
    }

    #[test]
    fn audio_round_trips_with_volume_default() {
        let mut audio = Audio::new("track.mp3");
        audio.start = 1.5;
        audio.volume = 0.5;
        let scene =
            Scene::new(hd()).with_root(Node::group().with_child(Node::new(NodeKind::Audio(audio))));
        let json = serde_json::to_string(&scene).unwrap();
        assert!(json.contains(r#""type":"audio""#));
        assert!(json.contains(r#""start":1.5"#));
        let back: Scene = serde_json::from_str(&json).unwrap();
        assert_eq!(scene, back);

        // Minimal audio JSON: no start/volume → start 0, volume 1 (default).
        let json = r#"{ "composition": { "width": 1280, "height": 720, "fps": 30.0, "duration_in_frames": 1 },
            "root": { "kind": { "type": "group" }, "children": [ { "kind": { "type": "audio", "src": "a.mp3" } } ] } }"#;
        let scene: Scene = serde_json::from_str(json).unwrap();
        match &scene.root.children[0].kind {
            NodeKind::Audio(a) => {
                assert_eq!(a.start, 0.0);
                assert_eq!(a.volume, 1.0);
            }
            _ => panic!("expected audio"),
        }
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
    fn matte_round_trips_and_skips_when_absent() {
        // No matte → the `matte` key is omitted (skip-if-none), so existing scenes
        // and goldens serialize byte-identically.
        let plain = Node::group();
        let json = serde_json::to_string(&plain).unwrap();
        assert!(!json.contains("matte"));

        // An alpha matte (the default mode) round-trips with the bundled shape.
        let masked = Node::image("photo.png").with_matte(Node::text("REVEAL"));
        let json = serde_json::to_string(&masked).unwrap();
        assert!(json.contains(r#""matte":{"mode":"alpha","source":{"#));
        let back: Node = serde_json::from_str(&json).unwrap();
        assert_eq!(masked, back);

        // A luminance matte serializes its snake_case mode and round-trips.
        let luma = Node::image("photo.png").with_matte_mode(Node::group(), MatteMode::Luminance);
        let json = serde_json::to_string(&luma).unwrap();
        assert!(json.contains(r#""mode":"luminance""#));
        let back: Node = serde_json::from_str(&json).unwrap();
        assert_eq!(luma, back);
    }

    #[test]
    fn effects_skip_when_empty_and_round_trip() {
        // No effects → the `effects` key is omitted entirely (skip-if-empty), so
        // existing scenes and goldens serialize byte-identically.
        let plain = Node::group();
        let json = serde_json::to_string(&plain).unwrap();
        assert!(!json.contains("effects"));

        // A blur effect serializes with the serde tag shape and round-trips.
        let node = Node::text("Onda").with_effect(Effect::Blur { sigma: 6.0 });
        let json = serde_json::to_string(&node).unwrap();
        assert!(json.contains(r#""effects":[{"effect":"blur","sigma":6.0}]"#));
        let back: Node = serde_json::from_str(&json).unwrap();
        assert_eq!(node, back);
        assert_eq!(back.effects, vec![Effect::Blur { sigma: 6.0 }]);

        // A bloom effect serializes snake_case with all three fields and round-trips.
        let glow = Node::text("Onda").with_effect(Effect::Bloom {
            threshold: 0.6,
            intensity: 1.5,
            sigma: 12.0,
        });
        let json = serde_json::to_string(&glow).unwrap();
        assert!(json.contains(
            r#""effects":[{"effect":"bloom","threshold":0.6,"intensity":1.5,"sigma":12.0}]"#
        ));
        let back: Node = serde_json::from_str(&json).unwrap();
        assert_eq!(glow, back);

        // A color-grade effect serializes snake_case with all five fields and round-trips.
        let graded = Node::image("clip.png").with_effect(Effect::ColorGrade {
            exposure: 0.2,
            contrast: 1.1,
            saturation: 0.8,
            temperature: 0.3,
            tint: -0.1,
        });
        let json = serde_json::to_string(&graded).unwrap();
        assert!(json.contains(
            r#""effects":[{"effect":"color_grade","exposure":0.2,"contrast":1.1,"saturation":0.8,"temperature":0.3,"tint":-0.1}]"#
        ));
        let back: Node = serde_json::from_str(&json).unwrap();
        assert_eq!(graded, back);

        // A goo effect serializes snake_case ("goo") with both fields and round-trips.
        let goo = Node::group().with_effect(Effect::Goo {
            sigma: 8.0,
            threshold: 0.5,
        });
        let json = serde_json::to_string(&goo).unwrap();
        assert!(json.contains(r#""effects":[{"effect":"goo","sigma":8.0,"threshold":0.5}]"#));
        let back: Node = serde_json::from_str(&json).unwrap();
        assert_eq!(goo, back);

        // The neutral grade is the documented identity.
        assert_eq!(
            Effect::NEUTRAL_GRADE,
            Effect::ColorGrade {
                exposure: 0.0,
                contrast: 1.0,
                saturation: 1.0,
                temperature: 0.0,
                tint: 0.0,
            }
        );
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
