//! The Studio→engine PROP vocabulary — size-role tokens, prop-name aliases,
//! placement coords, and the self-anchoring list. Extracted (verbatim) from the
//! renderer in `index.tsx` so the inspector can resolve an entry's effective
//! props/placement the SAME way `buildComposition` does, without importing the
//! React renderer. Behavior is identical to the pre-extraction code.

// Placement → fraction of the canvas the element's centre is moved to. Components
// self-centre (their own `<AbsoluteFill justify="center">`), so without this every
// entry stacks dead-centre — a regression vs the Remotion path, which anchored by
// `placement`. Shifting the centred element by the centre→target delta restores
// regions; centre/thirds are exact, corners are approximate (true corner-anchoring
// needs the laid-out element size — a follow-up once the bridge can measure).
export const PLACEMENT_COORDS: Record<string, [number, number]> = {
  center: [0.5, 0.5],
  top: [0.5, 0.1],
  bottom: [0.5, 0.9],
  left: [0.1, 0.5],
  right: [0.9, 0.5],
  'top-left': [0.1, 0.1],
  'top-right': [0.9, 0.1],
  'bottom-left': [0.1, 0.9],
  'bottom-right': [0.9, 0.9],
  'upper-third': [0.5, 0.28],
  'lower-third': [0.5, 0.72],
}

// Components that consume `placement` THEMSELVES (the shared placement contract
// in @onda-engine/components, or their own legacy anchoring) — the bridge must NOT also
// shift them, or placement applies twice and they fly off-canvas. Every
// component migrated onto `usePlacement`/`PlacementShift` belongs here.
export const SELF_ANCHORING = new Set([
  'LowerThird',
  'Callout',
  'BlurReveal',
  'Button',
  'Captions',
  'ChapterCard',
  'CountUp',
  'EndCard',
  'InputField',
  'KineticText',
  'MaskReveal',
  'MatrixDecode',
  'PricingCard',
  'QuoteCard',
  'SlotMachineRoll',
  'StatCard',
  'Terminal',
  'TextAnimator',
  'TitleCard',
  'Typewriter',
])

/** Centre→anchor pixel offset for an entry's `placement` prop (string slug or
 *  `{x,y}` fractions). Returns `[0,0]` for centre / unknown. */
export function placementOffset(
  props: Record<string, unknown> | undefined,
  w: number,
  h: number,
): [number, number] {
  const p = props?.placement
  let fx = 0.5
  let fy = 0.5
  const coords = typeof p === 'string' ? PLACEMENT_COORDS[p] : undefined
  if (coords) [fx, fy] = coords
  else if (p && typeof p === 'object') {
    const o = p as { x?: unknown; y?: unknown }
    if (typeof o.x === 'number') fx = o.x
    if (typeof o.y === 'number') fy = o.y
  }
  return [(fx - 0.5) * w, (fy - 0.5) * h]
}

// ── Studio prop vocabulary → @onda-engine/components prop API ────────────────────────
// ondajs/Studio components take a semantic SIZE ROLE (a fraction of the SMALLER
// canvas dimension, resolved canvas-aware) under prop names like `size` /
// `titleSize` / `numberSize`, with a px companion (`fontSize` / `titleFontSize`,
// which wins when both are passed). The `@onda-engine/components` ports instead take
// raw px under their own names (`fontSize`, `titleSize`, `valueSize`). Without a
// translation, a real Studio payload's `size: "hero"` is either dropped (default
// size) or — worse — fed into a component's arithmetic, yielding `NaN` → a `null`
// in the scene JSON that the Rust f32 parser rejects (hard render failure).
//
// SIZE_ROLES + the resolve formula MUST match Studio's `resolveSize` exactly
// (frontend/src/lib/onda/canvas.tsx) so bridged sizes equal Studio's pixels.
export const SIZE_ROLES: Record<string, number> = {
  hero: 0.15,
  heading: 0.09,
  subheading: 0.052,
  body: 0.03,
  caption: 0.02,
}
export const roleToPx = (role: string, w: number, h: number): number =>
  Math.round((SIZE_ROLES[role] ?? 0) * Math.min(w, h))

// Per-component prop map: Studio prop name → `@onda-engine/components` prop name. Role
// sources (`…Size`/`size`) resolve through SIZE_ROLES; px sources
// (`…FontSize`/`fontSize`) pass numbers through and WIN over a role for the same
// target (matching Studio's "px wins" rule).
export const isPxSource = (name: string): boolean =>
  name === 'fontSize' || name.endsWith('FontSize')
export const PROP_ALIASES: Record<string, Record<string, string>> = {
  TitleCard: {
    titleSize: 'titleSize',
    titleFontSize: 'titleSize',
    subtitleSize: 'subtitleSize',
    subtitleFontSize: 'subtitleSize',
  },
  Highlight: { size: 'fontSize', fontSize: 'fontSize' },
  WordStagger: { size: 'fontSize', fontSize: 'fontSize' },
  Captions: { size: 'fontSize', fontSize: 'fontSize' },
  StatCard: {
    numberSize: 'valueSize',
    numberFontSize: 'valueSize',
    labelSize: 'labelSize',
    labelFontSize: 'labelSize',
  },
}

/** Translate a Studio entry's props to the `@onda-engine/components` prop API: resolve
 *  size-role tokens to canvas-aware px, alias the differing prop names, and (as a
 *  safety net) resolve any leftover role-token value in place so a stray token
 *  can never reach a component's arithmetic and produce a NaN→null scene node. */
export function adaptProps(
  component: string,
  props: Record<string, unknown> | undefined,
  w: number,
  h: number,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(props ?? {}) }
  const aliases = PROP_ALIASES[component]
  if (aliases) {
    // For each target prop, a px source wins over a role source.
    const pxValue: Record<string, number> = {}
    const roleValue: Record<string, number> = {}
    for (const [src, target] of Object.entries(aliases)) {
      if (!(src in out)) continue
      const v = out[src]
      if (isPxSource(src)) {
        if (typeof v === 'number') pxValue[target] = v
      } else if (typeof v === 'string' && v in SIZE_ROLES) {
        roleValue[target] = roleToPx(v, w, h)
      } else if (typeof v === 'number') {
        roleValue[target] = v // already px under a role-named prop
      }
      if (src !== target) delete out[src] // drop the Studio-only name
    }
    for (const target of new Set([...Object.keys(roleValue), ...Object.keys(pxValue)])) {
      out[target] = pxValue[target] ?? roleValue[target]
    }
  }
  // Generic safety net: any remaining prop whose value is a bare role token.
  for (const k of Object.keys(out)) {
    const v = out[k]
    if (typeof v === 'string' && v in SIZE_ROLES) out[k] = roleToPx(v, w, h)
  }
  return out
}
