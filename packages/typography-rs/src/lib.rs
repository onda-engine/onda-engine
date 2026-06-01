//! ONDA typography: shaping, layout, and glyph rasterization.
//!
//! Wraps `cosmic-text` (shaping + layout + `swash` rasterization) behind a small,
//! renderer-agnostic surface. Per the engine charter, typography is a strategic
//! pillar and the renderer is "the platform" — so this crate keeps `cosmic-text`
//! an internal detail and hands back plain *coverage masks* ([`TextRaster`]). The
//! caller (the renderer) owns color and compositing; this owns text quality.
//!
//! Two font sources are available: the host's installed fonts
//! ([`FontContext::with_system_fonts`], convenient but host-dependent) and an
//! explicit/bundled font ([`FontContext::from_font_bytes`] /
//! [`FontContext::with_default_font`]) which renders deterministically — same
//! bytes in, same pixels out, on any machine — by disabling platform fallback.
//! The bundled default is Open Sans (SIL OFL 1.1; see `assets/`).
//!
//! v0 scope: mask (grayscale-coverage) glyphs and left-to-right layout with line
//! breaks. Deferred: color/emoji glyphs, rich runs, variable-font axes, and
//! OpenType feature toggles.

use std::collections::HashMap;
use std::sync::Arc;

use cosmic_text::{
    fontdb, Attrs, Buffer, Color as CtColor, Fallback, Family, FontSystem, Metrics, Shaping, Style,
    SwashCache, Weight,
};
use unicode_script::Script;

/// Open Sans Regular (SIL Open Font License 1.1), the default family — bundled so
/// text renders out of the box, headless, without the host's fonts. See
/// `assets/OpenSans-LICENSE.txt`.
const DEFAULT_FONT: &[u8] = include_bytes!("../assets/OpenSans-Regular.ttf");

/// IBM Plex Sans (SIL OFL 1.1; `assets/IBMPlexSans-LICENSE.txt`) — a second
/// bundled family with real Bold + Italic faces, so weight/style selection works
/// out of the box (the default Open Sans ships Regular only).
const PLEX_REGULAR: &[u8] = include_bytes!("../assets/IBMPlexSans-Regular.ttf");
const PLEX_BOLD: &[u8] = include_bytes!("../assets/IBMPlexSans-Bold.ttf");
const PLEX_ITALIC: &[u8] = include_bytes!("../assets/IBMPlexSans-Italic.ttf");

/// A `Fallback` that never substitutes another font. Pairing it with an explicit
/// font database is what makes [`FontContext::from_font_bytes`] deterministic:
/// glyphs the font lacks render as `.notdef` rather than via host fonts.
struct NoFallback;

impl Fallback for NoFallback {
    fn common_fallback(&self) -> &[&'static str] {
        &[]
    }
    fn forbidden_fallback(&self) -> &[&'static str] {
        &[]
    }
    fn script_fallback(&self, _script: Script, _locale: &str) -> &[&'static str] {
        &[]
    }
}

/// Owns the font database and the glyph rasterization cache. Rasterizing mutates
/// the cache, so methods take `&mut self`. Construct once and reuse across frames.
pub struct FontContext {
    font_system: FontSystem,
    swash_cache: SwashCache,
    /// Per-face cache: cosmic font id → (stable key, font bytes, collection index).
    /// The `Arc` is stable across frames so outline renderers (Vello) can cache a
    /// built font by `key` and keep their glyph cache warm.
    faces: HashMap<fontdb::ID, (u64, Arc<Vec<u8>>, u32)>,
    next_font_key: u64,
}

impl FontContext {
    /// Use the host's installed fonts (with cosmic-text's platform fallback).
    /// Convenient and always renders, but output depends on the machine's fonts.
    /// For reproducible rendering, prefer [`FontContext::with_default_font`] or
    /// [`FontContext::from_font_bytes`].
    pub fn with_system_fonts() -> Self {
        Self::wrap(FontSystem::new())
    }

    /// Render with the bundled families — **Open Sans** (the default) and **IBM
    /// Plex Sans** (Regular/Bold/Italic, so weight + style work) — deterministic
    /// and host-independent. The recommended default for headless/server render.
    pub fn with_default_font() -> Self {
        Self::from_fonts(&[DEFAULT_FONT, PLEX_REGULAR, PLEX_BOLD, PLEX_ITALIC])
    }

    /// Render using only the given font (`.ttf`/`.otf` bytes), with platform
    /// fallback disabled. Output depends solely on these bytes, so the same input
    /// yields identical pixels on any machine.
    pub fn from_font_bytes(data: Vec<u8>) -> Self {
        Self::from_fonts(&[&data])
    }

    /// Build a deterministic (no-fallback) context from one or more fonts. The
    /// **first** font's family becomes the default for the generic families, so
    /// unstyled text resolves to it; the rest are selectable by family/weight/style.
    pub fn from_fonts(fonts: &[&[u8]]) -> Self {
        let mut db = fontdb::Database::new();
        for font in fonts {
            db.load_font_data(font.to_vec());
        }
        // Point every generic family at the first font. Bind first so the
        // immutable `faces()` borrow ends before the `set_*` mutations.
        let family = db
            .faces()
            .next()
            .and_then(|f| f.families.first().map(|(n, _)| n.clone()));
        if let Some(family) = family {
            db.set_sans_serif_family(family.clone());
            db.set_serif_family(family.clone());
            db.set_monospace_family(family.clone());
            db.set_cursive_family(family.clone());
            db.set_fantasy_family(family);
        }
        Self::wrap(FontSystem::new_with_locale_and_db_and_fallback(
            "en-US".to_string(),
            db,
            NoFallback,
        ))
    }

    fn wrap(font_system: FontSystem) -> Self {
        FontContext {
            font_system,
            swash_cache: SwashCache::new(),
            faces: HashMap::new(),
            next_font_key: 0,
        }
    }

    /// Load an additional font (`.ttf`/`.otf` bytes) into the context, returning
    /// the family name(s) it provides — reference them by family on a [`Text`]
    /// run. Like Remotion's `loadFont`: load once, then select by family.
    pub fn load_font(&mut self, data: Vec<u8>) -> Vec<String> {
        let db = self.font_system.db_mut();
        let before = db.len();
        db.load_font_data(data);
        let mut families = Vec::new();
        for face in db.faces().skip(before) {
            for (name, _) in &face.families {
                if !families.contains(name) {
                    families.push(name.clone());
                }
            }
        }
        families
    }

    /// Resolve a face's stable key + bytes (cached). For outline renderers.
    fn face_blob(&mut self, id: fontdb::ID) -> Option<FontBlob> {
        if let Some((key, data, index)) = self.faces.get(&id) {
            return Some(FontBlob {
                key: *key,
                data: Arc::clone(data),
                index: *index,
            });
        }
        let (bytes, index) = self
            .font_system
            .db()
            .with_face_data(id, |data, index| (data.to_vec(), index))?;
        let key = self.next_font_key;
        self.next_font_key += 1;
        let data = Arc::new(bytes);
        self.faces.insert(id, (key, Arc::clone(&data), index));
        Some(FontBlob { key, data, index })
    }

    /// The bundled default font's raw bytes — for renderers that draw glyph
    /// *outlines* (e.g. Vello) rather than coverage masks. Glyph ids from
    /// [`FontContext::layout`] index this font when the context was built with
    /// [`FontContext::with_default_font`].
    pub fn default_font_bytes() -> &'static [u8] {
        DEFAULT_FONT
    }

    /// Shape and lay out `content` into positioned glyphs (no rasterization).
    /// Each [`GlyphPosition`] carries the font glyph index and pen position in
    /// pixels (`y` is the baseline). For outline renderers; pair with a font
    /// built from the same bytes so glyph ids line up.
    pub fn layout(&mut self, content: &str, font_size: f32) -> Vec<GlyphPosition> {
        if content.is_empty() || font_size <= 0.0 {
            return Vec::new();
        }
        let metrics = Metrics::new(font_size, font_size * 1.2);
        let mut buffer = Buffer::new(&mut self.font_system, metrics);
        buffer.set_size(&mut self.font_system, None, None);
        buffer.set_text(
            &mut self.font_system,
            content,
            &Attrs::new(),
            Shaping::Advanced,
            None,
        );
        buffer.shape_until_scroll(&mut self.font_system, false);

        let mut glyphs = Vec::new();
        for run in buffer.layout_runs() {
            for glyph in run.glyphs {
                glyphs.push(GlyphPosition {
                    id: glyph.glyph_id as u32,
                    x: glyph.x,
                    y: run.line_y,
                });
            }
        }
        glyphs
    }

    /// Shape + lay out styled runs ([`StyledRun`]) into positioned glyphs, each
    /// carrying its run's pixel size and straight-alpha RGBA color — for rich
    /// (multi-style) text. Outline renderers (Vello) group glyphs by size+color
    /// and draw a run per group. Single font family for now; weight/family land
    /// with font loading.
    pub fn layout_rich(&mut self, runs: &[StyledRun]) -> RichLayout {
        let runs: Vec<&StyledRun> = runs
            .iter()
            .filter(|r| !r.text.is_empty() && r.font_size > 0.0)
            .collect();
        if runs.is_empty() {
            return RichLayout::default();
        }
        // Buffer base metrics: the largest run so the line fits the tallest text.
        let base = runs.iter().map(|r| r.font_size).fold(0.0_f32, f32::max);
        let metrics = Metrics::new(base, base * 1.2);
        let mut buffer = Buffer::new(&mut self.font_system, metrics);
        buffer.set_size(&mut self.font_system, None, None);

        let spans: Vec<(&str, Attrs)> = runs
            .iter()
            .map(|r| {
                let [cr, cg, cb, ca] = r.color;
                let to8 = |c: f32| (c.clamp(0.0, 1.0) * 255.0).round() as u8;
                let mut attrs = Attrs::new()
                    .metrics(Metrics::new(r.font_size, r.font_size * 1.2))
                    .color(CtColor::rgba(to8(cr), to8(cg), to8(cb), to8(ca)))
                    .weight(Weight(r.weight))
                    .style(if r.italic {
                        Style::Italic
                    } else {
                        Style::Normal
                    });
                if let Some(family) = r.family {
                    attrs = attrs.family(Family::Name(family));
                }
                (r.text, attrs)
            })
            .collect();
        buffer.set_rich_text(
            &mut self.font_system,
            spans.iter().map(|(t, a)| (*t, a.clone())),
            &Attrs::new(),
            Shaping::Advanced,
            None,
        );
        buffer.shape_until_scroll(&mut self.font_system, false);

        // Collect glyphs + their face ids while the buffer (which borrows
        // `font_system`) is alive, then drop it before resolving faces (which
        // also needs `&mut self`).
        let mut raw: Vec<(u32, f32, f32, f32, [f32; 4], fontdb::ID)> = Vec::new();
        for run in buffer.layout_runs() {
            for glyph in run.glyphs {
                let color = glyph.color_opt.map_or([1.0, 1.0, 1.0, 1.0], |c| {
                    [
                        c.r() as f32 / 255.0,
                        c.g() as f32 / 255.0,
                        c.b() as f32 / 255.0,
                        c.a() as f32 / 255.0,
                    ]
                });
                raw.push((
                    glyph.glyph_id as u32,
                    glyph.x,
                    run.line_y,
                    glyph.font_size,
                    color,
                    glyph.font_id,
                ));
            }
        }
        drop(buffer);

        let mut fonts: Vec<FontBlob> = Vec::new();
        let mut glyphs = Vec::with_capacity(raw.len());
        for (id, x, y, font_size, color, font_id) in raw {
            let font_key = match self.face_blob(font_id) {
                Some(blob) => {
                    if !fonts.iter().any(|f| f.key == blob.key) {
                        fonts.push(blob.clone());
                    }
                    blob.key
                }
                None => 0,
            };
            glyphs.push(RichGlyph {
                id,
                x,
                y,
                font_size,
                color,
                font_key,
            });
        }
        RichLayout { glyphs, fonts }
    }

    /// Shape and rasterize `content` at `font_size` into a coverage mask using
    /// the default family. See [`FontContext::rasterize_with`] for font selection.
    pub fn rasterize(&mut self, content: &str, font_size: f32) -> Option<TextRaster> {
        self.rasterize_with(content, font_size, None, 400, false)
    }

    /// Shape and rasterize `content` with explicit font selection (family/weight/
    /// italic) into a coverage mask. Returns `None` when nothing is drawn — empty/
    /// whitespace text, or no usable font for the requested glyphs.
    pub fn rasterize_with(
        &mut self,
        content: &str,
        font_size: f32,
        family: Option<&str>,
        weight: u16,
        italic: bool,
    ) -> Option<TextRaster> {
        if content.is_empty() || font_size <= 0.0 {
            return None;
        }

        // Line height 1.2x is a conventional default; line spacing control lands
        // with richer text styling.
        let metrics = Metrics::new(font_size, font_size * 1.2);
        let mut buffer = Buffer::new(&mut self.font_system, metrics);
        // No width bound: lay out on a single line (explicit `\n` still breaks).
        buffer.set_size(&mut self.font_system, None, None);
        let mut attrs = Attrs::new().weight(Weight(weight)).style(if italic {
            Style::Italic
        } else {
            Style::Normal
        });
        if let Some(family) = family {
            attrs = attrs.family(Family::Name(family));
        }
        buffer.set_text(
            &mut self.font_system,
            content,
            &attrs,
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

/// A laid-out glyph: the font glyph index and its pen position in pixels,
/// relative to the layout origin (top-left of the first line). `y` is the
/// baseline. Produced by [`FontContext::layout`] for outline renderers.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct GlyphPosition {
    pub id: u32,
    pub x: f32,
    pub y: f32,
}

/// One styled input span for [`FontContext::layout_rich`]: text plus its pixel
/// size, color, and font selection (family/weight/style).
#[derive(Debug, Clone, PartialEq)]
pub struct StyledRun<'a> {
    pub text: &'a str,
    pub font_size: f32,
    /// Straight-alpha RGBA, components 0..=1.
    pub color: [f32; 4],
    /// Font family name; `None` resolves to the default (Open Sans).
    pub family: Option<&'a str>,
    /// CSS weight 1..=1000 (400 = normal, 700 = bold).
    pub weight: u16,
    pub italic: bool,
}

/// A laid-out glyph from [`FontContext::layout_rich`], carrying its run's size,
/// color, and the key of the face it uses (see [`RichLayout::fonts`]).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RichGlyph {
    pub id: u32,
    pub x: f32,
    pub y: f32,
    pub font_size: f32,
    /// Straight-alpha RGBA, components 0..=1.
    pub color: [f32; 4],
    /// Stable key of the face this glyph uses; index into [`RichLayout::fonts`].
    pub font_key: u64,
}

/// A font face used by a [`RichLayout`]: a stable `key`, the raw font bytes, and
/// the face index within a collection. The `Arc` is stable across layouts so an
/// outline renderer can cache a built font by `key`.
#[derive(Debug, Clone)]
pub struct FontBlob {
    pub key: u64,
    pub data: Arc<Vec<u8>>,
    pub index: u32,
}

/// The result of [`FontContext::layout_rich`]: positioned glyphs plus the unique
/// faces they use.
#[derive(Debug, Clone, Default)]
pub struct RichLayout {
    pub glyphs: Vec<RichGlyph>,
    pub fonts: Vec<FontBlob>,
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

    #[test]
    fn default_font_renders_text() {
        let mut ctx = FontContext::with_default_font();
        let raster = ctx
            .rasterize("Hello ONDA", 32.0)
            .expect("bundled font should render");
        assert!(raster.inked_pixels() > 0);
        assert!(raster.width > raster.height);
    }

    #[test]
    fn layout_positions_glyphs_left_to_right() {
        let mut ctx = FontContext::with_default_font();
        let glyphs = ctx.layout("Hi", 32.0);
        assert!(glyphs.len() >= 2, "two letters → at least two glyphs");
        // Pen advances along +x; the baseline is positive (below the top).
        assert!(glyphs[1].x > glyphs[0].x);
        assert!(glyphs.iter().all(|g| g.y > 0.0));
    }

    fn run<'a>(text: &'a str, family: Option<&'a str>, weight: u16, italic: bool) -> StyledRun<'a> {
        StyledRun {
            text,
            font_size: 32.0,
            color: [1.0, 1.0, 1.0, 1.0],
            family,
            weight,
            italic,
        }
    }

    #[test]
    fn layout_rich_selects_distinct_faces_per_run() {
        // The bundled default ships Open Sans + IBM Plex Sans (Regular/Bold/
        // Italic), so a run in the default family and a run in IBM Plex Bold must
        // resolve to *different* faces.
        let mut ctx = FontContext::with_default_font();
        let layout = ctx.layout_rich(&[
            run("plain ", None, 400, false),
            run("bold", Some("IBM Plex Sans"), 700, false),
        ]);
        assert!(!layout.glyphs.is_empty());
        let keys: std::collections::HashSet<u64> =
            layout.glyphs.iter().map(|g| g.font_key).collect();
        assert!(
            keys.len() >= 2,
            "default vs IBM Plex Bold should differ: {keys:?}"
        );
        assert!(layout.fonts.len() >= 2, "two faces reported");
        // Italic resolves to the Plex italic face too.
        let italic = ctx.layout_rich(&[run("x", Some("IBM Plex Sans"), 400, true)]);
        assert!(!italic.glyphs.is_empty());
    }

    #[test]
    fn load_font_then_select_by_family() {
        // Loading a font and selecting it by family resolves (IBM Plex bytes,
        // loaded under a fresh context).
        let mut ctx = FontContext::with_default_font();
        let families = ctx.load_font(PLEX_BOLD.to_vec());
        assert!(
            families.iter().any(|f| f.contains("Plex")),
            "got {families:?}"
        );
        assert!(ctx
            .rasterize_with("Hi", 32.0, families.first().map(String::as_str), 700, false)
            .is_some());
    }

    #[test]
    fn layout_of_empty_is_empty() {
        let mut ctx = FontContext::with_default_font();
        assert!(ctx.layout("", 32.0).is_empty());
        assert!(ctx.layout("x", 0.0).is_empty());
    }

    #[test]
    fn default_font_is_deterministic() {
        // Two independent contexts from the same font bytes must produce
        // byte-identical output — the core reproducibility guarantee.
        let mut a = FontContext::with_default_font();
        let mut b = FontContext::with_default_font();
        assert_eq!(
            a.rasterize("Reproducible!", 28.0),
            b.rasterize("Reproducible!", 28.0)
        );
    }

    #[test]
    fn from_font_bytes_matches_default() {
        let mut a = FontContext::with_default_font();
        let mut b = FontContext::from_font_bytes(DEFAULT_FONT.to_vec());
        assert_eq!(a.rasterize("Hi", 40.0), b.rasterize("Hi", 40.0));
    }
}
