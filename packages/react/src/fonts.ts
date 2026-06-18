//! Font registry — the single source for a composition's custom fonts.
//!
//! An author declares a font ONCE (via `@onda-engine/components`' `loadFont`, which loads
//! it into the author-time measurement engine AND calls `registerFont` here). The
//! render harness (`@onda-engine/render`) then drains this registry, materializes the
//! bytes to temp files, and hands them to the `onda` CLI (`--font`) — so the font
//! used to MEASURE the text (glyph placement) is the same one the renderer DRAWS,
//! with no separate flag. Same hub pattern as the engine-warmer registry: bytes
//! flow through `@onda-engine/react`, so neither `@onda-engine/components` nor `@onda-engine/render`
//! depends on the other.

const fonts: Uint8Array[] = []
const seen = new Set<string>()

/** A content signature so re-declaring the same font is a no-op. FNV-1a over all
 *  bytes — O(n), but this runs once per `loadFont` (not per frame), and a full
 *  hash (vs sampled bytes) means two distinct fonts never collide. */
function signature(data: Uint8Array): string {
  let h = 0x811c9dc5
  for (let i = 0; i < data.length; i++) {
    h ^= data[i] as number
    h = Math.imul(h, 0x01000193)
  }
  return `${data.length}:${h >>> 0}`
}

/** Retain font bytes so the render harness can pass them to the renderer. Deduped
 *  by content signature — declaring the same font twice is harmless. Synchronous
 *  and independent of any async engine load, so the bytes are registered the
 *  instant `loadFont` is called, even before the wasm measurement engine warms. */
export function registerFont(data: Uint8Array): void {
  const sig = signature(data)
  if (seen.has(sig)) return
  seen.add(sig)
  fonts.push(data)
}

/** A snapshot of the fonts declared so far — for the render harness to write out
 *  and pass to the CLI. Callers receive a copy and must not mutate the registry. */
export function registeredFonts(): readonly Uint8Array[] {
  return fonts.slice()
}

/** Clear the registry — for tests, or a long-running process between renders of
 *  different compositions (so one comp's fonts don't leak into the next). */
export function clearRegisteredFonts(): void {
  fonts.length = 0
  seen.clear()
}
