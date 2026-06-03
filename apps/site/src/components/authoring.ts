//! The composition-authoring contract for an AI agent: how to assemble a
//! timeline payload (`@onda/cinema` `CompositionPayload`) — the model, timing,
//! placement, size roles, choreography, transitions and brand. Surfaced in
//! /api/components.json under `authoring` so an agent can author without reading
//! engine source. Values mirror `@onda/cinema` (placement regions, SIZE_ROLES,
//! CHOREOGRAPHY, TRANSITIONS) — keep in sync if those change.

export const AUTHORING = {
  model: {
    shape: 'CompositionPayload { fps, width, height, scenes[], layers?[], brand? }',
    scene:
      'Scene { id, for, transition?, tracks[] } — scenes play in series via a TransitionSeries.',
    track: 'Track { entries[] } — tracks within a scene Z-STACK in array order (later = on top).',
    entry:
      'Entry { at, for, component, props, animate?[] } — places a component at `at` for `for`, with optional choreography.',
    layers:
      'Layer { under?, entries[] } — composition-level clips that span scene cuts; `under:true` = background, else overlay.',
    notes:
      'Component NAMES are the @onda/components exports (see `components`). Prefer `recommendedPalette` (first-class). One <ThemeProvider> via `brand` re-skins everything; an explicit prop overrides.',
  },
  timing: {
    spec: "TimeSpec = seconds (number) OR a string: '2s', '500ms', '0:02' (m:ss), '90f' (frames).",
    examples: { at: '0 or "0.7s"', for: '"4s" or 4 (a bare number = seconds; use "120f" for frames)' },
    note: 'A raw NUMBER is SECONDS, not frames (toFrames: 2 → 2s). Use "90f" for an explicit frame count.',
    recipes: [
      'Overlap a scene exit with the next entry ~0.4–0.6s for a soft cut.',
      'Stagger list items 3–6 frames apart (WordStagger `stagger`, StaggerGroup).',
      'Hold a hero title ~1.5–2.5s before its exit choreography.',
    ],
  },
  placement: {
    how: 'Set `props.placement` to a named region OR { x, y } as 0..1 fractions of the canvas.',
    regions: [
      'center',
      'top',
      'bottom',
      'left',
      'right',
      'top-left',
      'top-right',
      'bottom-left',
      'bottom-right',
      'upper-third',
      'lower-third',
    ],
  },
  sizeRoles: {
    how: 'Semantic type sizes resolve to px = round(role × min(width,height)). Pass the role to a size prop (e.g. TitleCard.titleSize, Highlight.size, StatCard.numberSize) OR pass explicit px via the *FontSize companion, which WINS.',
    roles: { hero: 0.15, heading: 0.09, subheading: 0.052, body: 0.03, caption: 0.02 },
    footgun:
      'Pass a role token only to a documented size prop. The bridge resolves it canvas-aware; a stray token elsewhere can become NaN. Per-component role→px prop names: see each prop’s `roleSource`/`aliasTo`.',
  },
  choreography: {
    how: 'Add entries to `animate[]`: { pattern, params }. Multiple patterns COMPOSE (opacity/scale multiply, translate sum).',
    patterns: {
      entryFade: 'delay, durationInFrames',
      entryFadeRise: 'delay, durationInFrames, travelPx',
      entrySlide: 'delay, durationInFrames, direction, distance',
      entryScale: 'delay, durationInFrames, from',
      heroReveal: 'delay, durationInFrames, travelPx — the two-phase Onda landing',
      exitFade: '—',
      exitFadeFall: 'delay, durationInFrames, travelPx',
      exitSlide: 'delay, durationInFrames, direction, distance',
      exitScale: '—',
    },
  },
  transitions: {
    how: 'Set scene.transition = { type, durationInFrames? }. Applied between this scene and the previous.',
    vectorNative: [
      'cross-fade',
      'fade',
      'slide',
      'wipe',
      'iris',
      'push',
      'zoom',
      'dip-to-color',
      'clock-wipe',
      'none',
    ],
    approximated: {
      note: 'These imitate blur/3D/blend effects the engine defers; they fall back to a stylized vector approximation (not a true filter). Prefer vectorNative for crisp results.',
      types: [
        'blur',
        'chromatic-aberration',
        'device-pullback',
        'depth-push',
        'expand-morph',
        'flip',
        'glass-wipe',
        'grid-pixelate',
        'morph',
        'type-mask',
      ],
    },
  },
  brand: {
    how: 'payload.brand maps semantic tokens to the engine theme for the whole composition.',
    tokens: [
      'bg',
      'surface',
      'surface2',
      'border',
      'borderLit',
      'text',
      'dim',
      'faint',
      'accent',
      'accentSoft',
      'fontDisplay',
      'fontBody',
    ],
    note: 'fontDisplay/fontBody name a *loaded* family; they do not ship the font.',
  },
} as const
