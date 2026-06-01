//! Tiny 2D geometry primitives shared across the engine.
//!
//! Deliberately minimal: `f32` components, `Copy`, serde-friendly. The renderer,
//! animation runtime, and scene graph all build on these, so they must stay
//! cheap and dependency-free.

use serde::{Deserialize, Serialize};
use std::ops::{Add, Mul, Sub};

/// A 2D vector / point in pixel space.
#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
pub struct Vec2 {
    pub x: f32,
    pub y: f32,
}

impl Vec2 {
    /// The zero vector / origin.
    pub const ZERO: Vec2 = Vec2 { x: 0.0, y: 0.0 };

    /// Construct from components.
    pub const fn new(x: f32, y: f32) -> Self {
        Vec2 { x, y }
    }

    /// Construct with both components set to `v`.
    pub const fn splat(v: f32) -> Self {
        Vec2 { x: v, y: v }
    }

    /// Euclidean length.
    pub fn length(self) -> f32 {
        self.x.hypot(self.y)
    }

    /// Per-component (Hadamard) product.
    pub fn componentwise_mul(self, rhs: Vec2) -> Vec2 {
        Vec2::new(self.x * rhs.x, self.y * rhs.y)
    }
}

impl Add for Vec2 {
    type Output = Vec2;
    fn add(self, rhs: Vec2) -> Vec2 {
        Vec2::new(self.x + rhs.x, self.y + rhs.y)
    }
}

impl Sub for Vec2 {
    type Output = Vec2;
    fn sub(self, rhs: Vec2) -> Vec2 {
        Vec2::new(self.x - rhs.x, self.y - rhs.y)
    }
}

impl Mul<f32> for Vec2 {
    type Output = Vec2;
    fn mul(self, rhs: f32) -> Vec2 {
        Vec2::new(self.x * rhs, self.y * rhs)
    }
}

/// A 2D size (width × height) in pixels.
#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
pub struct Size {
    pub width: f32,
    pub height: f32,
}

impl Size {
    /// A zero-area size.
    pub const ZERO: Size = Size {
        width: 0.0,
        height: 0.0,
    };

    /// Construct from width and height.
    pub const fn new(width: f32, height: f32) -> Self {
        Size { width, height }
    }

    /// Area in square pixels.
    pub fn area(self) -> f32 {
        self.width * self.height
    }

    /// True when either dimension is zero or negative (nothing to draw).
    pub fn is_empty(self) -> bool {
        self.width <= 0.0 || self.height <= 0.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splat_sets_both_components() {
        assert_eq!(Vec2::splat(2.5), Vec2::new(2.5, 2.5));
    }

    #[test]
    fn default_vec2_is_zero() {
        assert_eq!(Vec2::default(), Vec2::ZERO);
    }

    #[test]
    fn vec2_arithmetic() {
        let a = Vec2::new(1.0, 2.0);
        let b = Vec2::new(3.0, 5.0);
        assert_eq!(a + b, Vec2::new(4.0, 7.0));
        assert_eq!(b - a, Vec2::new(2.0, 3.0));
        assert_eq!(a * 2.0, Vec2::new(2.0, 4.0));
    }

    #[test]
    fn vec2_length() {
        assert_eq!(Vec2::new(3.0, 4.0).length(), 5.0);
    }

    #[test]
    fn size_area_and_empty() {
        assert_eq!(Size::new(4.0, 3.0).area(), 12.0);
        assert!(Size::ZERO.is_empty());
        assert!(!Size::new(1.0, 1.0).is_empty());
        assert!(Size::new(-1.0, 5.0).is_empty());
    }
}
