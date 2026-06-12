//! Inspector constants — every threshold the checks measure against, with its
//! source. Research-backed values cite the standard/paper; the rest are marked
//! PRODUCT DECISION (ours to tune, no external authority).

// ── Contrast (WCAG 2.x SC 1.4.3 — Contrast (Minimum), Level AA) ───────────────
// https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum
// Text needs a contrast ratio ≥ 4.5:1 against what's behind it, except "large
// scale" text which needs ≥ 3:1. Large scale = ≥18pt regular, or ≥14pt bold.
// At the CSS reference 96dpi, 1pt = 4/3 px → 18pt = 24px, 14pt ≈ 18.67px.

/** Minimum contrast ratio for body-size text (WCAG 2.x SC 1.4.3 AA). */
export const CONTRAST_MIN_BODY = 4.5
/** Minimum contrast ratio for large text (WCAG 2.x SC 1.4.3 AA). */
export const CONTRAST_MIN_LARGE = 3
/** "Large text" floor for regular weight: 18pt × (4/3 px/pt) = 24px. */
export const LARGE_TEXT_PX = 24
/** "Large text" floor for bold (≥700) weight: 14pt × (4/3 px/pt) ≈ 18.67px. */
export const LARGE_TEXT_BOLD_PX = (14 * 4) / 3
/** Font weight WCAG counts as bold. */
export const BOLD_WEIGHT = 700

// ── Reading time ──────────────────────────────────────────────────────────────
// The spec formula was `max(1.2s, 0.18s × words + 0.6s)` — 0.18 s/word ≈ 333 wpm,
// FASTER than any research supports, so the per-word constant is adjusted:
// - BBC Subtitle Guidelines: 160–180 wpm (0.33–0.375 s/word), minimum dwell
//   ~0.3 s/word — https://www.bbc.co.uk/accessibility/forproducts/guides/subtitles
//   (via https://www.clevercast.com/bbc-subtitling-guidelines/)
// - Brysbaert 2019 meta-analysis (190 studies, n=18,573): adults silently read
//   non-fiction at ~238 wpm ≈ 0.252 s/word — J. Memory & Language 109, 104047.
// - legibility.info "Rules for text in videos": dwell 1s per 13 characters.
// On-screen graphic titles are short, predictable, and not competing with
// dialogue (unlike subtitles), so we anchor on the Brysbaert mean rather than
// the stricter BBC subtitle floor: 0.25 s/word (240 wpm). The 0.6s orientation
// constant and 1.2s minimum are PRODUCT DECISIONS (the orientation beat covers
// saccade + entrance animation; BBC's own example floor is 1.2s for 4 words).

/** Seconds of display per word (240 wpm — Brysbaert 2019 silent-reading mean). */
export const READ_SECONDS_PER_WORD = 0.25
/** Fixed orientation beat: find the text + ride out its entrance. PRODUCT DECISION. */
export const READ_ORIENTATION_SECONDS = 0.6
/** Absolute floor for any readable text. PRODUCT DECISION (BBC-consistent). */
export const READ_MIN_SECONDS = 1.2

/** Seconds a text of `wordCount` words must stay visible:
 *  `max(1.2, 0.25 × words + 0.6)`. */
export function readingTimeSeconds(wordCount: number): number {
  return Math.max(READ_MIN_SECONDS, READ_SECONDS_PER_WORD * wordCount + READ_ORIENTATION_SECONDS)
}

// ── Formats + safe areas ──────────────────────────────────────────────────────

/** The delivery formats the inspector knows safe areas for. */
export type FormatId = '16:9' | '9:16' | '1:1' | '4:5'

/** Per-side safe-area inset as a FRACTION of the canvas axis. */
export interface SafeAreaPreset {
  top: number
  bottom: number
  left: number
  right: number
}

// px → fraction helpers against the canonical 1080×1920 social canvas.
const v1920 = (px: number): number => px / 1920
const h1080 = (px: number): number => px / 1080

/** Safe-area presets per format.
 *
 *  - `16:9` — EBU R95 / SMPTE ST 2046-1 GRAPHICS-safe for 16:9 TV: 5% vertical,
 *    10% horizontal (action-safe is 3.5%; graphics/title content uses the
 *    stricter band) — https://tech.ebu.ch/publications/r095.
 *  - `9:16` — the UNION of the three vertical-social UI overlays at 1080×1920,
 *    so one preset clears TikTok + Instagram Reels + YouTube Shorts
 *    (per-platform 2025/26 overlay guides — kreatli.com/guides/safe-zone-guide,
 *    zeely.ai/blog/tiktok-safe-zones):
 *      · TikTok: top ~140px (profile bar), bottom ~324px (caption/sound, ~370px
 *        with an ad CTA), right ~164px (like/comment/share rail), left ~60px.
 *      · Reels: top ~108–220px, bottom ~320–420px (caption + CTA), right ~120px.
 *      · Shorts: top ~180px, bottom ~390px (channel + CTA), right ~120px.
 *    Union: top 220 / bottom 420 / left 60 / right 164 px.
 *  - `1:1`, `4:5` — feed placements; platforms overlay far less UI in-feed, but
 *    Meta crops covers and overlays the caption/CTA strip at the bottom.
 *    PRODUCT DECISION informed by the 9:16 research (no platform publishes
 *    feed-overlay pixel specs). */
export const SAFE_AREAS: Record<FormatId, SafeAreaPreset> = {
  '16:9': { top: 0.05, bottom: 0.05, left: 0.1, right: 0.1 },
  '9:16': { top: v1920(220), bottom: v1920(420), left: h1080(60), right: h1080(164) },
  '1:1': { top: 0.05, bottom: 0.1, left: 0.06, right: 0.06 },
  '4:5': { top: 0.05, bottom: 0.12, left: 0.06, right: 0.06 },
}

/** Nearest known format for a canvas size (by aspect-ratio distance). */
export function inferFormat(width: number, height: number): FormatId {
  const ratio = width / height
  const known: [FormatId, number][] = [
    ['16:9', 16 / 9],
    ['9:16', 9 / 16],
    ['1:1', 1],
    ['4:5', 4 / 5],
  ]
  let best: FormatId = '16:9'
  let bestD = Number.POSITIVE_INFINITY
  for (const [id, r] of known) {
    const d = Math.abs(Math.log(ratio / r)) // log distance — symmetric in ratio space
    if (d < bestD) {
      bestD = d
      best = id
    }
  }
  return best
}

// ── Font-size floors ─────────────────────────────────────────────────────────
// legibility.info "Rules for text in videos": for full-HD video in full-screen
// on an average smartphone, body text needs a "minimum font size of 40 to 60
// pixels" (titles ≥50% larger) — https://legibility.info/rules-for-text-in-videos.
// Vertical/feed formats are phone-first → the 40px floor applies. 16:9 is
// desktop/TV-first where the frame fills more of the visual field; 28px is a
// PRODUCT DECISION anchored between WCAG's 24px large-text line and the mobile
// floor. Floors are defined at a 1080 min-dimension and scale linearly.

/** Minimum body font size in px AT a 1080 min-dimension canvas, per format. */
export const FONT_FLOOR_PX: Record<FormatId, number> = {
  '16:9': 28,
  '9:16': 40,
  '1:1': 40,
  '4:5': 40,
}
/** The min(width,height) the floors are defined at. */
export const FONT_FLOOR_REFERENCE_DIM = 1080

/** The font floor in px for a format on an actual canvas. */
export function fontFloorPx(format: FormatId, width: number, height: number): number {
  return (FONT_FLOOR_PX[format] * Math.min(width, height)) / FONT_FLOOR_REFERENCE_DIM
}

// ── Motion timing ─────────────────────────────────────────────────────────────

/** Two FOCAL entrances beginning within this window compete for one attention
 *  slot. Backed by the attentional-blink literature: a second target appearing
 *  200–500ms after a first is frequently missed outright (Raymond, Shapiro &
 *  Arnell 1992; review: Dux & Marois 2009, Atten Percept Psychophys 71:1683).
 *  250ms sits inside that window. */
export const FOCAL_COLLISION_WINDOW_SECONDS = 0.25

/** Scene-transition duration budget. Material Design caps complex multi-element
 *  transitions at 500–700ms and finds >400ms "too slow" for simple ones
 *  (https://m2.material.io/design/motion/speed.html); film dissolves run longer,
 *  so 0.6s — inside Material's complex band — is the PRODUCT DECISION budget. */
export const TRANSITION_BUDGET_SECONDS = 0.6

// ── Density budgets (PRODUCT DECISIONS — see Miller-span/working-memory lore,
// but no citable on-screen standard exists) ───────────────────────────────────

/** Max non-ambient entries visible at once in a scene. */
export const DENSITY_MAX_NON_AMBIENT = 5
/** Max FOCAL entries visible at once (one thing to look at). */
export const DENSITY_MAX_FOCAL = 1
