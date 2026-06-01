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

    /// Gamma-decode the RGB channels from sRGB to linear light (alpha
    /// unchanged). Color math — interpolation, blending, blurs — is physically
    /// correct in linear space; doing it in sRGB darkens/muddies mid-tones.
    pub fn to_linear(self) -> Color {
        Color::new(
            srgb_to_linear(self.r),
            srgb_to_linear(self.g),
            srgb_to_linear(self.b),
            self.a,
        )
    }

    /// Gamma-encode the RGB channels from linear light back to sRGB (alpha
    /// unchanged). Inverse of [`Color::to_linear`].
    pub fn from_linear(self) -> Color {
        Color::new(
            linear_to_srgb(self.r),
            linear_to_srgb(self.g),
            linear_to_srgb(self.b),
            self.a,
        )
    }
}

/// sRGB transfer function (gamma decode), one channel.
fn srgb_to_linear(c: f32) -> f32 {
    if c <= 0.04045 {
        c / 12.92
    } else {
        ((c + 0.055) / 1.055).powf(2.4)
    }
}

/// Inverse sRGB transfer function (gamma encode), one channel.
fn linear_to_srgb(c: f32) -> f32 {
    if c <= 0.003_130_8 {
        c * 12.92
    } else {
        1.055 * c.powf(1.0 / 2.4) - 0.055
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
    fn linear_conversion_endpoints_and_roundtrip() {
        // 0 and 1 are fixed points; alpha is never gamma-converted.
        assert_eq!(Color::BLACK.to_linear(), Color::BLACK);
        assert_eq!(Color::WHITE.to_linear(), Color::WHITE);
        assert_eq!(Color::new(0.5, 0.5, 0.5, 0.3).to_linear().a, 0.3);
        // sRGB 0.5 decodes to ~0.214 linear (decidedly darker — the whole point).
        assert!((srgb_to_linear(0.5) - 0.214).abs() < 0.005);
        // Round-trips back to itself.
        let c = Color::new(0.2, 0.6, 0.9, 0.5);
        let back = c.to_linear().from_linear();
        for (x, y) in [(c.r, back.r), (c.g, back.g), (c.b, back.b), (c.a, back.a)] {
            assert!((x - y).abs() < 1e-5, "{x} != {y}");
        }
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
