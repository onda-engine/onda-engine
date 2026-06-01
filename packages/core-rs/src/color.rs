//! RGBA color.
//!
//! Components are `f32` in the `0.0..=1.0` range, interpreted as straight
//! (non-premultiplied) sRGB. Premultiplication and linear-space conversion are
//! the renderer's concern, not the scene graph's — keeping color "as authored"
//! here means React/JSON/AI frontends all describe color the same way.

use serde::{Deserialize, Serialize};

/// Straight-alpha sRGB color, components in `0.0..=1.0`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Color {
    pub r: f32,
    pub g: f32,
    pub b: f32,
    /// Alpha. Defaults to fully opaque when omitted during deserialization.
    #[serde(default = "Color::opaque_alpha")]
    pub a: f32,
}

impl Color {
    fn opaque_alpha() -> f32 {
        1.0
    }

    /// Fully transparent (also the [`Default`]).
    pub const TRANSPARENT: Color = Color {
        r: 0.0,
        g: 0.0,
        b: 0.0,
        a: 0.0,
    };
    /// Opaque black.
    pub const BLACK: Color = Color {
        r: 0.0,
        g: 0.0,
        b: 0.0,
        a: 1.0,
    };
    /// Opaque white.
    pub const WHITE: Color = Color {
        r: 1.0,
        g: 1.0,
        b: 1.0,
        a: 1.0,
    };

    /// Construct from straight-alpha components.
    pub const fn new(r: f32, g: f32, b: f32, a: f32) -> Self {
        Color { r, g, b, a }
    }

    /// Construct an opaque color (alpha = 1.0).
    pub const fn rgb(r: f32, g: f32, b: f32) -> Self {
        Color { r, g, b, a: 1.0 }
    }

    /// Construct from 8-bit-per-channel sRGB values.
    pub fn from_rgba8(r: u8, g: u8, b: u8, a: u8) -> Self {
        Color {
            r: r as f32 / 255.0,
            g: g as f32 / 255.0,
            b: b as f32 / 255.0,
            a: a as f32 / 255.0,
        }
    }

    /// Quantize to 8-bit-per-channel `[r, g, b, a]`, clamping out-of-range
    /// components into `0..=255`.
    pub fn to_rgba8(self) -> [u8; 4] {
        [
            quantize(self.r),
            quantize(self.g),
            quantize(self.b),
            quantize(self.a),
        ]
    }

    /// Return a copy with a different alpha.
    pub fn with_alpha(self, a: f32) -> Self {
        Color { a, ..self }
    }
}

impl Default for Color {
    fn default() -> Self {
        Color::TRANSPARENT
    }
}

fn quantize(c: f32) -> u8 {
    (c.clamp(0.0, 1.0) * 255.0).round() as u8
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rgb_is_opaque() {
        assert_eq!(Color::rgb(0.1, 0.2, 0.3).a, 1.0);
    }

    #[test]
    fn default_is_transparent() {
        assert_eq!(Color::default(), Color::TRANSPARENT);
    }

    #[test]
    fn rgba8_round_trips_white_and_black() {
        assert_eq!(Color::WHITE.to_rgba8(), [255, 255, 255, 255]);
        assert_eq!(Color::BLACK.to_rgba8(), [0, 0, 0, 255]);
        assert_eq!(Color::from_rgba8(255, 255, 255, 255), Color::WHITE);
    }

    #[test]
    fn to_rgba8_clamps_out_of_range() {
        assert_eq!(
            Color::new(-1.0, 2.0, 0.5, 1.0).to_rgba8(),
            [0, 255, 128, 255]
        );
    }

    #[test]
    fn deserializes_without_alpha_as_opaque() {
        let c: Color = serde_json::from_str(r#"{"r":1.0,"g":0.0,"b":0.0}"#).unwrap();
        assert_eq!(c, Color::rgb(1.0, 0.0, 0.0));
    }
}
