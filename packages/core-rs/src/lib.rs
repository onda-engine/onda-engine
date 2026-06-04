//! Core shared types for the ONDA engine.
//!
//! These primitives are intentionally tiny and dependency-light: every other
//! crate in the workspace (`scene`, `renderer`, future `animation`/`vector`)
//! builds on them, so they must stay framework-agnostic and cheap to depend on.
//! Per the engine charter, nothing here may reference React, the DOM, a browser,
//! or any consumer of the engine.

use serde::{Deserialize, Serialize};

mod color;
mod geometry;

pub use color::Color;
pub use geometry::{Size, Vec2};

/// A 2D affine-ish transform. v0 only models translation + uniform-ish scale;
/// rotation/shear land with the animation runtime (Milestone 3). It exists now
/// so the scene graph node shape is stable before those features arrive.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Transform {
    /// Translation in pixels.
    #[serde(default)]
    pub translate: Vec2,
    /// Scale factor (1.0 = identity).
    #[serde(default = "Transform::default_scale")]
    pub scale: Vec2,
    /// Clockwise rotation in **degrees** about [`Transform::origin`] (default the
    /// node's local origin, `(0,0)`). Honored by vector backends (Vello) —
    /// including nested rotation, composed as affine matrices down the tree. The
    /// CPU reference rasterizer ignores rotation (like clips); [`Transform::apply`]
    /// and [`Transform::then`] operate on translate + scale (about the origin).
    #[serde(default)]
    pub rotate: f32,
    /// Pivot for scale + rotation in the node's local space (CSS `transform-origin`).
    /// Default `(0,0)` (top-left). Scale-about-origin folds into translate, so the
    /// CPU path honors it; rotation-about-origin is a Vello concern.
    #[serde(default, skip_serializing_if = "vec2_is_zero")]
    pub origin: Vec2,
}

/// Serde helper: omit a zero origin (keeps serialized transforms clean + back-compat).
#[allow(clippy::trivially_copy_pass_by_ref)]
fn vec2_is_zero(v: &Vec2) -> bool {
    *v == Vec2::ZERO
}

impl Transform {
    fn default_scale() -> Vec2 {
        Vec2::splat(1.0)
    }

    /// The identity transform: no translation, unit scale, no rotation, origin 0.
    pub const IDENTITY: Transform = Transform {
        translate: Vec2::ZERO,
        scale: Vec2 { x: 1.0, y: 1.0 },
        rotate: 0.0,
        origin: Vec2::ZERO,
    };

    /// Translate with the scale-about-origin pivot folded in. For the no-rotation
    /// (translate + scale) path, `scale·(p − origin) + origin + translate`
    /// simplifies to `scale·p + effective_translate`, so origin reduces to a
    /// translate offset — which is why [`Transform::then`] can flatten it.
    fn effective_translate(&self) -> Vec2 {
        Vec2::new(
            self.translate.x + self.origin.x * (1.0 - self.scale.x),
            self.translate.y + self.origin.y * (1.0 - self.scale.y),
        )
    }

    /// Apply this transform's scale-about-origin + translate to a point (rotation
    /// excluded — see the field docs; rotation is a vector-backend concern).
    pub fn apply(&self, p: Vec2) -> Vec2 {
        let t = self.effective_translate();
        Vec2::new(p.x * self.scale.x + t.x, p.y * self.scale.y + t.y)
    }

    /// Compose with an `inner` transform applied first (translate + scale, origin
    /// folded): `r.apply(p) == self.apply(inner.apply(p))`. Flattens a parent's
    /// transform with its child's. The result carries the combined translate+scale
    /// with origin reduced to 0; rotation is not composed here (the CPU path
    /// ignores it; Vello composes rotation via affine matrices instead).
    pub fn then(&self, inner: &Transform) -> Transform {
        Transform {
            scale: self.scale.componentwise_mul(inner.scale),
            translate: self.scale.componentwise_mul(inner.effective_translate())
                + self.effective_translate(),
            rotate: 0.0,
            origin: Vec2::ZERO,
        }
    }
}

impl Default for Transform {
    fn default() -> Self {
        Transform::IDENTITY
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transform_identity_is_a_noop() {
        let p = Vec2::new(3.0, 4.0);
        assert_eq!(Transform::IDENTITY.apply(p), p);
    }

    #[test]
    fn transform_applies_scale_then_translate() {
        let t = Transform {
            translate: Vec2::new(10.0, 20.0),
            scale: Vec2::splat(2.0),
            ..Transform::IDENTITY
        };
        assert_eq!(t.apply(Vec2::new(1.0, 1.0)), Vec2::new(12.0, 22.0));
    }

    #[test]
    fn scale_about_origin_holds_the_pivot() {
        // Scale 2× about the pivot (100,100): the pivot stays fixed; a point 50px
        // away from it moves to 100px away.
        let t = Transform {
            scale: Vec2::splat(2.0),
            origin: Vec2::new(100.0, 100.0),
            ..Transform::IDENTITY
        };
        assert_eq!(t.apply(Vec2::new(100.0, 100.0)), Vec2::new(100.0, 100.0));
        assert_eq!(t.apply(Vec2::new(150.0, 100.0)), Vec2::new(200.0, 100.0));
    }

    #[test]
    fn then_flattens_transform_origin() {
        // A scale-about-origin still composes correctly (origin folds into the
        // result's translate): r.apply(p) == identity.apply(t.apply(p)).
        let t = Transform {
            scale: Vec2::splat(2.0),
            origin: Vec2::new(100.0, 100.0),
            ..Transform::IDENTITY
        };
        let composed = Transform::IDENTITY.then(&t);
        for p in [Vec2::new(0.0, 0.0), Vec2::new(150.0, 200.0)] {
            assert_eq!(composed.apply(p), t.apply(p));
        }
    }

    #[test]
    fn transform_then_matches_nested_apply() {
        let parent = Transform {
            translate: Vec2::new(100.0, 50.0),
            scale: Vec2::splat(2.0),
            ..Transform::IDENTITY
        };
        let child = Transform {
            translate: Vec2::new(10.0, 5.0),
            scale: Vec2::splat(3.0),
            ..Transform::IDENTITY
        };
        let composed = parent.then(&child);
        let p = Vec2::new(4.0, 7.0);
        assert_eq!(composed.apply(p), parent.apply(child.apply(p)));
    }

    #[test]
    fn transform_then_identity_is_noop() {
        let t = Transform {
            translate: Vec2::new(3.0, 9.0),
            scale: Vec2::new(2.0, 4.0),
            ..Transform::IDENTITY
        };
        assert_eq!(t.then(&Transform::IDENTITY), t);
        assert_eq!(Transform::IDENTITY.then(&t), t);
    }
}
