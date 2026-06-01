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
}

impl Transform {
    fn default_scale() -> Vec2 {
        Vec2::splat(1.0)
    }

    /// The identity transform: no translation, unit scale.
    pub const IDENTITY: Transform = Transform {
        translate: Vec2::ZERO,
        scale: Vec2 { x: 1.0, y: 1.0 },
    };

    /// Apply this transform to a point.
    pub fn apply(&self, p: Vec2) -> Vec2 {
        Vec2::new(
            p.x * self.scale.x + self.translate.x,
            p.y * self.scale.y + self.translate.y,
        )
    }

    /// Compose with an `inner` transform applied first: the result `r` satisfies
    /// `r.apply(p) == self.apply(inner.apply(p))`. Used to flatten a parent's
    /// transform with its child's into a single absolute transform.
    pub fn then(&self, inner: &Transform) -> Transform {
        Transform {
            scale: self.scale.componentwise_mul(inner.scale),
            translate: self.scale.componentwise_mul(inner.translate) + self.translate,
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
        };
        assert_eq!(t.apply(Vec2::new(1.0, 1.0)), Vec2::new(12.0, 22.0));
    }

    #[test]
    fn transform_then_matches_nested_apply() {
        let parent = Transform {
            translate: Vec2::new(100.0, 50.0),
            scale: Vec2::splat(2.0),
        };
        let child = Transform {
            translate: Vec2::new(10.0, 5.0),
            scale: Vec2::splat(3.0),
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
        };
        assert_eq!(t.then(&Transform::IDENTITY), t);
        assert_eq!(Transform::IDENTITY.then(&t), t);
    }
}
