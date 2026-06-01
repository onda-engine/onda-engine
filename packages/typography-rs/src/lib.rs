//! ONDA typography: shaping, layout, and glyph rasterization.
//!
//! Wraps `cosmic-text` (shaping + layout + `swash` rasterization) behind a small,
//! renderer-agnostic surface. Per the engine charter, typography is a strategic
//! pillar and the renderer is "the platform" — so this crate keeps `cosmic-text`
//! an internal detail and hands back plain *coverage masks* ([`TextRaster`]). The
//! caller (the renderer) owns color and compositing; this owns text quality.
//!
//! v0 scope: the host's installed fonts, mask (grayscale-coverage) glyphs, and
//! left-to-right layout with line breaks. Deferred: explicit/bundled fonts for
//! reproducible headless rendering (cosmic-text's platform fallback makes output
//! host-dependent today), color/emoji glyphs, rich runs, variable-font axes, and
//! OpenType feature toggles.

use cosmic_text::{Attrs, Buffer, Color as CtColor, FontSystem, Metrics, Shaping, SwashCache};

/// Owns the font database and the glyph rasterization cache. Rasterizing mutates
/// the cache, so methods take `&mut self`. Construct once and reuse across frames.
pub struct FontContext {
    font_system: FontSystem,
    swash_cache: SwashCache,
}

impl FontContext {
    /// Use the host's installed fonts (with cosmic-text's platform fallback).
    /// Convenient and always renders, but output depends on the machine's fonts;
    /// reproducible rendering from bundled/explicit fonts is a planned follow-up.
    pub fn with_system_fonts() -> Self {
        FontContext {
            font_system: FontSystem::new(),
            swash_cache: SwashCache::new(),
        }
    }

    /// Shape and rasterize `content` at `font_size` (in pixels) into a coverage
    /// mask. Returns `None` when nothing is drawn — empty/whitespace text, or no
    /// usable font for the requested glyphs.
    pub fn rasterize(&mut self, content: &str, font_size: f32) -> Option<TextRaster> {
        if content.is_empty() || font_size <= 0.0 {
            return None;
        }

        // Line height 1.2x is a conventional default; line spacing control lands
        // with richer text styling.
        let metrics = Metrics::new(font_size, font_size * 1.2);
        let mut buffer = Buffer::new(&mut self.font_system, metrics);
        // No width bound: lay out on a single line (explicit `\n` still breaks).
        buffer.set_size(&mut self.font_system, None, None);
        buffer.set_text(
            &mut self.font_system,
            content,
            &Attrs::new(),
            Shaping::Advanced,
            None,
        );
        buffer.shape_until_scroll(&mut self.font_system, false);

        // One pass: collect inked pixels (mask glyphs => callback alpha == glyph
        // coverage), then size the mask to the actual inked bounds.
        //
        // Caveat: this keeps only coverage, so a *color* glyph (e.g. an emoji)
        // collapses to a silhouette filled with the caller's text color rather
        // than its true colors. Acceptable for v0 (a coverage mask is grayscale
        // by construction); proper color glyphs need a richer, color-carrying
        // raster and are a deliberate follow-up.
        let mut pixels: Vec<(i32, i32, u8)> = Vec::new();
        let white = CtColor::rgb(255, 255, 255);
        buffer.draw(
            &mut self.font_system,
            &mut self.swash_cache,
            white,
            |x, y, w, h, color| {
                let coverage = color.a();
                if coverage == 0 {
                    return;
                }
                for dy in 0..h as i32 {
                    for dx in 0..w as i32 {
                        pixels.push((x + dx, y + dy, coverage));
                    }
                }
            },
        );

        if pixels.is_empty() {
            return None;
        }

        let min_x = pixels.iter().map(|p| p.0).min().unwrap();
        let min_y = pixels.iter().map(|p| p.1).min().unwrap();
        let max_x = pixels.iter().map(|p| p.0).max().unwrap();
        let max_y = pixels.iter().map(|p| p.1).max().unwrap();
        let width = (max_x - min_x + 1) as u32;
        let height = (max_y - min_y + 1) as u32;

        let mut coverage = vec![0u8; (width as usize) * (height as usize)];
        for (x, y, c) in pixels {
            let idx = ((y - min_y) as usize) * (width as usize) + (x - min_x) as usize;
            // Glyphs can overlap (kerning/diacritics); keep the strongest coverage.
            coverage[idx] = coverage[idx].max(c);
        }

        Some(TextRaster {
            offset_x: min_x,
            offset_y: min_y,
            width,
            height,
            coverage,
        })
    }
}

/// A rasterized text block as an alpha-coverage mask, positioned relative to the
/// text's layout origin (top-left of the first line, +x right, +y down).
///
/// `coverage` is row-major, `width * height` bytes in `0..=255`. The mask's
/// top-left sits at `(offset_x, offset_y)` from the layout origin (offsets may be
/// negative for glyphs with left/upward overhang).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TextRaster {
    pub offset_x: i32,
    pub offset_y: i32,
    pub width: u32,
    pub height: u32,
    pub coverage: Vec<u8>,
}

impl TextRaster {
    /// Coverage (`0..=255`) at mask-local `(x, y)`; `0` if out of bounds.
    pub fn coverage_at(&self, x: u32, y: u32) -> u8 {
        if x >= self.width || y >= self.height {
            return 0;
        }
        self.coverage[(y as usize) * (self.width as usize) + (x as usize)]
    }

    /// Total inked pixels (coverage > 0). Handy for tests and metrics.
    pub fn inked_pixels(&self) -> usize {
        self.coverage.iter().filter(|&&c| c > 0).count()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_string_and_zero_size_yield_none() {
        let mut ctx = FontContext::with_system_fonts();
        assert!(ctx.rasterize("", 32.0).is_none());
        assert!(ctx.rasterize("Hello", 0.0).is_none());
    }

    #[test]
    fn rasterizes_visible_text() {
        let mut ctx = FontContext::with_system_fonts();
        let raster = ctx
            .rasterize("Hello", 32.0)
            .expect("text should render with system fonts");
        assert!(raster.width > 0 && raster.height > 0);
        assert!(raster.inked_pixels() > 0);
        // A 5-glyph run at 32px is wider than it is tall.
        assert!(raster.width > raster.height);
    }

    #[test]
    fn larger_font_inks_more_pixels() {
        let mut ctx = FontContext::with_system_fonts();
        let small = ctx.rasterize("Ag", 16.0).unwrap().inked_pixels();
        let large = ctx.rasterize("Ag", 64.0).unwrap().inked_pixels();
        assert!(
            large > small,
            "64px ({large}) should ink more than 16px ({small})"
        );
    }
}
