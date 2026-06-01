//! ONDA animation runtime.
//!
//! The scene graph ([`onda_scene`]) is static, the universal language. Animation
//! layers on top: a [`Timeline`] of keyframe [`Track`]s, each targeting a node by
//! [`NodeId`] and a property, is *evaluated at a frame* to produce a fully static
//! [`Scene`] — which the renderer then renders like any other. So motion is just
//! "evaluate the timeline, render the result", one frame at a time.
//!
//! Everything here is plain, deterministic, serde-serializable data, so a React
//! reconciler or an AI can describe motion declaratively.
//!
//! Keyframe times are in **seconds**, independent of frame rate; evaluate at a
//! frame via the composition's fps ([`Timeline::evaluate_frame`]).
//!
//! v0 scope: keyframes + easing driving opacity / translate / scale. Springs,
//! noise, sequences, and state machines (all named in the charter) build on this
//! and are deliberate follow-ups.

use std::cmp::Ordering;

use onda_core::{Color, Vec2};
use onda_scene::{Node, NodeId, Scene};
use serde::{Deserialize, Serialize};

/// Easing curves mapping linear progress `t ∈ [0, 1]` to eased progress.
/// Closed-form (Penner-style); cubic-bézier easing is a follow-up.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Easing {
    #[default]
    Linear,
    EaseInQuad,
    EaseOutQuad,
    EaseInOutQuad,
    EaseInCubic,
    EaseOutCubic,
    EaseInOutCubic,
    /// Hermite smoothstep (3t² − 2t³).
    SmoothStep,
}

impl Easing {
    /// Map `t` (clamped to `[0, 1]`) to eased progress. Every curve maps
    /// `0 → 0` and `1 → 1`.
    pub fn apply(self, t: f32) -> f32 {
        let t = t.clamp(0.0, 1.0);
        match self {
            Easing::Linear => t,
            Easing::EaseInQuad => t * t,
            Easing::EaseOutQuad => 1.0 - (1.0 - t) * (1.0 - t),
            Easing::EaseInOutQuad => {
                if t < 0.5 {
                    2.0 * t * t
                } else {
                    1.0 - (-2.0 * t + 2.0).powi(2) / 2.0
                }
            }
            Easing::EaseInCubic => t * t * t,
            Easing::EaseOutCubic => 1.0 - (1.0 - t).powi(3),
            Easing::EaseInOutCubic => {
                if t < 0.5 {
                    4.0 * t * t * t
                } else {
                    1.0 - (-2.0 * t + 2.0).powi(3) / 2.0
                }
            }
            Easing::SmoothStep => t * t * (3.0 - 2.0 * t),
        }
    }
}

/// Linear interpolation between two values of the same type.
pub trait Lerp {
    /// Interpolate from `self` (t=0) to `other` (t=1).
    fn lerp(self, other: Self, t: f32) -> Self;
}

impl Lerp for f32 {
    fn lerp(self, other: Self, t: f32) -> Self {
        self + (other - self) * t
    }
}

impl Lerp for Vec2 {
    fn lerp(self, other: Self, t: f32) -> Self {
        Vec2::new(self.x.lerp(other.x, t), self.y.lerp(other.y, t))
    }
}

impl Lerp for Color {
    fn lerp(self, other: Self, t: f32) -> Self {
        Color::new(
            self.r.lerp(other.r, t),
            self.g.lerp(other.g, t),
            self.b.lerp(other.b, t),
            self.a.lerp(other.a, t),
        )
    }
}

/// A value at a point in time, with the easing used to *arrive* at it from the
/// previous keyframe.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Keyframe<T> {
    /// Time in seconds.
    pub time: f32,
    pub value: T,
    /// Easing for the segment ending at this keyframe. Defaults to linear.
    #[serde(default)]
    pub easing: Easing,
}

impl<T> Keyframe<T> {
    /// A keyframe reached with linear easing.
    pub fn new(time: f32, value: T) -> Self {
        Keyframe {
            time,
            value,
            easing: Easing::Linear,
        }
    }

    /// A keyframe reached with the given easing.
    pub fn eased(time: f32, value: T, easing: Easing) -> Self {
        Keyframe {
            time,
            value,
            easing,
        }
    }
}

/// A sequence of keyframes sampled to produce a value at any time. Values hold
/// constant before the first keyframe and after the last.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Track<T> {
    pub keyframes: Vec<Keyframe<T>>,
}

impl<T: Lerp + Clone> Track<T> {
    /// Build a track from keyframes; they are sorted by time so callers needn't.
    pub fn new(mut keyframes: Vec<Keyframe<T>>) -> Self {
        keyframes.sort_by(|a, b| a.time.partial_cmp(&b.time).unwrap_or(Ordering::Equal));
        Track { keyframes }
    }

    /// Sample the value at `time` (seconds). `None` only if the track is empty.
    pub fn sample(&self, time: f32) -> Option<T> {
        let first = self.keyframes.first()?;
        if time <= first.time {
            return Some(first.value.clone());
        }
        let last = self.keyframes.last().expect("non-empty checked above");
        if time >= last.time {
            return Some(last.value.clone());
        }
        for pair in self.keyframes.windows(2) {
            let (a, b) = (&pair[0], &pair[1]);
            if time >= a.time && time <= b.time {
                let span = b.time - a.time;
                let local = if span <= 0.0 {
                    1.0
                } else {
                    (time - a.time) / span
                };
                let eased = b.easing.apply(local);
                return Some(a.value.clone().lerp(b.value.clone(), eased));
            }
        }
        Some(last.value.clone()) // unreachable: time is within [first, last]
    }
}

/// Which property of a node an [`Animation`] drives.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AnimatedProperty {
    Opacity { track: Track<f32> },
    Translate { track: Track<Vec2> },
    Scale { track: Track<Vec2> },
}

/// Binds a property animation to a target node (by id).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Animation {
    pub target: NodeId,
    pub property: AnimatedProperty,
}

impl Animation {
    pub fn new(target: NodeId, property: AnimatedProperty) -> Self {
        Animation { target, property }
    }
}

/// A set of animations evaluated together against a base scene.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Timeline {
    pub animations: Vec<Animation>,
}

impl Timeline {
    pub fn new() -> Self {
        Timeline::default()
    }

    /// Builder: add an animation.
    pub fn with(mut self, animation: Animation) -> Self {
        self.animations.push(animation);
        self
    }

    /// Evaluate at `frame`, converting to seconds via the base composition's fps,
    /// and return the resulting static scene.
    pub fn evaluate_frame(&self, base: &Scene, frame: f32) -> Scene {
        let fps = base.composition.fps;
        let time = if fps > 0.0 { frame / fps } else { 0.0 };
        self.evaluate_at(base, time)
    }

    /// Evaluate at `time` (seconds) and return the resulting static scene. Nodes
    /// not targeted by any animation keep their authored values.
    pub fn evaluate_at(&self, base: &Scene, time: f32) -> Scene {
        let mut scene = base.clone();
        for animation in &self.animations {
            if let Some(node) = find_node_mut(&mut scene.root, animation.target) {
                apply(node, &animation.property, time);
            }
        }
        scene
    }
}

fn apply(node: &mut Node, property: &AnimatedProperty, time: f32) {
    match property {
        AnimatedProperty::Opacity { track } => {
            if let Some(v) = track.sample(time) {
                node.opacity = v.clamp(0.0, 1.0);
            }
        }
        AnimatedProperty::Translate { track } => {
            if let Some(v) = track.sample(time) {
                node.transform.translate = v;
            }
        }
        AnimatedProperty::Scale { track } => {
            if let Some(v) = track.sample(time) {
                node.transform.scale = v;
            }
        }
    }
}

/// A complete animated document: a base [`Scene`] plus the [`Timeline`] that
/// drives it. This is the serde-serializable unit a frontend (CLI, AI, React)
/// hands the engine to render a clip — `scene` carries the resolution/fps/length
/// (via its [`onda_scene::Composition`]), `timeline` carries the motion.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AnimatedScene {
    pub scene: Scene,
    #[serde(default)]
    pub timeline: Timeline,
}

impl AnimatedScene {
    /// A still document (empty timeline).
    pub fn new(scene: Scene) -> Self {
        AnimatedScene {
            scene,
            timeline: Timeline::new(),
        }
    }

    /// Builder: attach a timeline.
    pub fn with_timeline(mut self, timeline: Timeline) -> Self {
        self.timeline = timeline;
        self
    }

    /// Frames per second (from the composition).
    pub fn fps(&self) -> f32 {
        self.scene.composition.fps
    }

    /// Number of frames to render (at least one).
    pub fn frame_count(&self) -> u32 {
        self.scene.composition.duration_in_frames.max(1)
    }

    /// The static scene at frame `n` (timeline evaluated).
    pub fn frame(&self, n: u32) -> Scene {
        self.timeline.evaluate_frame(&self.scene, n as f32)
    }
}

/// Depth-first search for the first node with the given id.
fn find_node_mut(node: &mut Node, id: NodeId) -> Option<&mut Node> {
    if node.id == Some(id) {
        return Some(node);
    }
    for child in &mut node.children {
        if let Some(found) = find_node_mut(child, id) {
            return Some(found);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use onda_scene::{Composition, Node, NodeKind};

    #[test]
    fn easing_hits_endpoints_and_clamps() {
        for e in [
            Easing::Linear,
            Easing::EaseInQuad,
            Easing::EaseOutQuad,
            Easing::EaseInOutQuad,
            Easing::EaseInCubic,
            Easing::EaseOutCubic,
            Easing::EaseInOutCubic,
            Easing::SmoothStep,
        ] {
            assert!((e.apply(0.0) - 0.0).abs() < 1e-6, "{e:?} at 0");
            assert!((e.apply(1.0) - 1.0).abs() < 1e-6, "{e:?} at 1");
            // Clamps out-of-range input.
            assert_eq!(e.apply(-1.0), e.apply(0.0));
            assert_eq!(e.apply(2.0), e.apply(1.0));
        }
        assert_eq!(Easing::Linear.apply(0.5), 0.5);
        assert_eq!(Easing::EaseInQuad.apply(0.5), 0.25);
        assert_eq!(Easing::SmoothStep.apply(0.5), 0.5);
    }

    #[test]
    fn lerp_midpoints() {
        assert_eq!(2.0_f32.lerp(4.0, 0.5), 3.0);
        assert_eq!(
            Vec2::new(0.0, 0.0).lerp(Vec2::new(10.0, 20.0), 0.5),
            Vec2::new(5.0, 10.0)
        );
        assert_eq!(
            Color::new(0.0, 0.0, 0.0, 0.0).lerp(Color::new(1.0, 1.0, 1.0, 1.0), 0.5),
            Color::new(0.5, 0.5, 0.5, 0.5)
        );
    }

    #[test]
    fn track_clamps_and_interpolates() {
        let track = Track::new(vec![Keyframe::new(0.0, 0.0_f32), Keyframe::new(1.0, 100.0)]);
        assert_eq!(track.sample(-1.0), Some(0.0)); // before first
        assert_eq!(track.sample(0.0), Some(0.0));
        assert_eq!(track.sample(0.5), Some(50.0)); // linear midpoint
        assert_eq!(track.sample(1.0), Some(100.0));
        assert_eq!(track.sample(2.0), Some(100.0)); // after last
    }

    #[test]
    fn track_applies_segment_easing() {
        let track = Track::new(vec![
            Keyframe::new(0.0, 0.0_f32),
            Keyframe::eased(1.0, 100.0, Easing::EaseInQuad),
        ]);
        // EaseInQuad(0.5) = 0.25 -> 25.0
        assert_eq!(track.sample(0.5), Some(25.0));
    }

    #[test]
    fn track_single_keyframe_is_constant_and_empty_is_none() {
        let one = Track::new(vec![Keyframe::new(5.0, 7.0_f32)]);
        assert_eq!(one.sample(0.0), Some(7.0));
        assert_eq!(one.sample(99.0), Some(7.0));
        let empty: Track<f32> = Track::new(vec![]);
        assert_eq!(empty.sample(0.0), None);
    }

    fn scene_with_text() -> Scene {
        Scene::new(Composition::new(100, 100, 30.0, 60))
            .with_root(Node::group().with_child(Node::text("hi").with_id(1)))
    }

    #[test]
    fn timeline_animates_opacity_over_frames() {
        let base = scene_with_text();
        let timeline = Timeline::new().with(Animation::new(
            NodeId(1),
            AnimatedProperty::Opacity {
                track: Track::new(vec![Keyframe::new(0.0, 0.0), Keyframe::new(1.0, 1.0)]),
            },
        ));

        // 30 fps: frame 0 -> 0s, frame 15 -> 0.5s, frame 30 -> 1s.
        let opacity_at = |frame: f32| {
            let scene = timeline.evaluate_frame(&base, frame);
            scene.root.children[0].opacity
        };
        assert_eq!(opacity_at(0.0), 0.0);
        assert_eq!(opacity_at(15.0), 0.5);
        assert_eq!(opacity_at(30.0), 1.0);
    }

    #[test]
    fn timeline_animates_translate() {
        let base = scene_with_text();
        let timeline = Timeline::new().with(Animation::new(
            NodeId(1),
            AnimatedProperty::Translate {
                track: Track::new(vec![
                    Keyframe::new(0.0, Vec2::new(0.0, 0.0)),
                    Keyframe::new(1.0, Vec2::new(100.0, 0.0)),
                ]),
            },
        ));
        let scene = timeline.evaluate_frame(&base, 15.0); // 0.5s
        assert_eq!(
            scene.root.children[0].transform.translate,
            Vec2::new(50.0, 0.0)
        );
    }

    #[test]
    fn evaluate_leaves_base_untouched_and_ignores_missing_targets() {
        let base = scene_with_text();
        let timeline = Timeline::new().with(Animation::new(
            NodeId(999), // no such node
            AnimatedProperty::Opacity {
                track: Track::new(vec![Keyframe::new(0.0, 0.0)]),
            },
        ));
        let scene = timeline.evaluate_frame(&base, 10.0);
        assert_eq!(scene, base); // unchanged
        assert_eq!(base.root.children[0].opacity, 1.0); // base not mutated
    }

    #[test]
    fn timeline_round_trips_through_json() {
        let timeline = Timeline::new()
            .with(Animation::new(
                NodeId(1),
                AnimatedProperty::Opacity {
                    track: Track::new(vec![
                        Keyframe::new(0.0, 0.0),
                        Keyframe::eased(0.5, 1.0, Easing::EaseOutCubic),
                    ]),
                },
            ))
            .with(Animation::new(
                NodeId(1),
                AnimatedProperty::Translate {
                    track: Track::new(vec![Keyframe::new(0.0, Vec2::new(0.0, 40.0))]),
                },
            ));
        let json = serde_json::to_string(&timeline).unwrap();
        let back: Timeline = serde_json::from_str(&json).unwrap();
        assert_eq!(timeline, back);
    }

    #[test]
    fn node_kind_text_helper_compiles() {
        // Guards against accidental scene API drift used by examples.
        let n = Node::new(NodeKind::Group).with_id(2);
        assert_eq!(n.id, Some(NodeId(2)));
    }

    #[test]
    fn animated_scene_frames_and_count() {
        let doc = AnimatedScene::new(scene_with_text()).with_timeline(Timeline::new().with(
            Animation::new(
                NodeId(1),
                AnimatedProperty::Opacity {
                    track: Track::new(vec![Keyframe::new(0.0, 0.0), Keyframe::new(2.0, 1.0)]),
                },
            ),
        ));
        assert_eq!(doc.frame_count(), 60); // composition duration_in_frames
        assert_eq!(doc.fps(), 30.0);
        assert_eq!(doc.frame(0).root.children[0].opacity, 0.0);
        assert_eq!(doc.frame(30).root.children[0].opacity, 0.5); // 1s of a 2s ramp
    }

    #[test]
    fn animated_scene_defaults_timeline_when_absent_in_json() {
        let json = r#"{
            "scene": {
                "composition": { "width": 16, "height": 16, "fps": 24.0, "duration_in_frames": 5 },
                "root": { "kind": { "type": "group" } }
            }
        }"#;
        let doc: AnimatedScene = serde_json::from_str(json).unwrap();
        assert!(doc.timeline.animations.is_empty());
        assert_eq!(doc.frame_count(), 5);
    }
}
