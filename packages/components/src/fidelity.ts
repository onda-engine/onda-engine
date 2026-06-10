//! Per-component render fidelity on the @onda engine — the capability signal an
//! AI agent (e.g. ONDA Studio) needs to choose components well, exposed through
//! the machine-readable contract (apps/site /api/components.json + /llms.txt).
//!
//! - `fidelity`     — first_class (faithful on native primitives) | degraded
//!                    (works, visibly off until ONE engine feature lands) |
//!                    apes_remotion (depends on a DOM/CSS capability the vector
//!                    engine deliberately doesn't have — re-think, don't chase).
//! - `engineNative` — true when the effect is what the engine does best
//!                    (vector / layout / audio / determinism); false when it
//!                    imitates a browser feature (blur/blend/backdrop/grain).
//! - `needsFeature` — the single engine gap a degraded component waits on.
//! - `backend`      — `both` renders byte-identically on the CPU reference too;
//!                    `gpu_only` needs Vello for a capability the CPU reference
//!                    lacks: **rotation**, **clipping**, or **video** decode. (The
//!                    CPU tiny-skia backend DOES render fills, strokes, gradients,
//!                    and Bézier paths — those are no longer GPU-only.)
//!
//! Agent policy: prefer `first_class` + `engineNative`; reach for `degraded`
//! only when the design demands it; never silently pick a `gpu_only` component
//! for a CPU-verified render.

export type Fidelity = 'first_class' | 'degraded' | 'apes_remotion'
export type Backend = 'both' | 'gpu_only'

export interface ComponentFidelity {
  fidelity: Fidelity
  engineNative: boolean
  needsFeature: string | null
  backend: Backend
}

export const COMPONENT_FIDELITY: Record<string, ComponentFidelity> = {
  AudioClip: { fidelity: 'first_class', engineNative: true, needsFeature: null, backend: 'both' },
  AudioVisualizer: {
    fidelity: 'first_class',
    engineNative: true,
    needsFeature: null,
    backend: 'gpu_only',
  },
  BarChart: { fidelity: 'first_class', engineNative: true, needsFeature: null, backend: 'both' },
  BentoGrid: {
    fidelity: 'first_class',
    engineNative: false,
    needsFeature: null,
    backend: 'both',
  },
  BlurReveal: {
    fidelity: 'first_class',
    engineNative: true,
    needsFeature: null,
    backend: 'both',
  },
  BoundingBox: {
    fidelity: 'first_class',
    engineNative: true,
    needsFeature: null,
    backend: 'both',
  },
  BrowserFrame: {
    fidelity: 'first_class',
    engineNative: true,
    needsFeature: null,
    backend: 'both',
  },
  Button: {
    fidelity: 'first_class',
    engineNative: true,
    needsFeature: null,
    backend: 'both',
  },
  Callout: {
    fidelity: 'first_class',
    engineNative: true,
    needsFeature: null,
    backend: 'both',
  },
  CameraShake: { fidelity: 'first_class', engineNative: true, needsFeature: null, backend: 'both' },
  Captions: {
    fidelity: 'first_class',
    engineNative: true,
    needsFeature: null,
    backend: 'both',
  },
  ChapterCard: {
    fidelity: 'first_class',
    engineNative: true,
    needsFeature: null,
    backend: 'both',
  },
  CodeBlock: {
    fidelity: 'first_class',
    engineNative: false,
    needsFeature: null,
    backend: 'both',
  },
  CodeDiff: { fidelity: 'first_class', engineNative: true, needsFeature: null, backend: 'both' },
  Confetti: { fidelity: 'first_class', engineNative: true, needsFeature: null, backend: 'both' },
  CountUp: { fidelity: 'first_class', engineNative: true, needsFeature: null, backend: 'both' },
  Cursor: {
    fidelity: 'first_class',
    engineNative: true,
    needsFeature: null,
    backend: 'both',
  },
  DeviceFrame: {
    fidelity: 'first_class',
    engineNative: true,
    needsFeature: null,
    backend: 'both',
  },
  DrawOn: { fidelity: 'first_class', engineNative: true, needsFeature: null, backend: 'both' },
  DynamicGrid: {
    fidelity: 'first_class',
    engineNative: true,
    needsFeature: null,
    backend: 'gpu_only',
  },
  EndCard: {
    fidelity: 'first_class',
    engineNative: true,
    needsFeature: null,
    backend: 'both',
  },
  FadeIn: { fidelity: 'first_class', engineNative: true, needsFeature: null, backend: 'both' },
  FadeOut: { fidelity: 'first_class', engineNative: true, needsFeature: null, backend: 'both' },
  FilmGrade: { fidelity: 'first_class', engineNative: true, needsFeature: null, backend: 'both' },
  GradientShift: {
    fidelity: 'first_class',
    engineNative: true,
    needsFeature: null,
    backend: 'gpu_only',
  },
  GrainOverlay: {
    fidelity: 'first_class',
    engineNative: true,
    needsFeature: null,
    backend: 'gpu_only',
  },
  Highlight: { fidelity: 'first_class', engineNative: true, needsFeature: null, backend: 'both' },
  IconPop: {
    fidelity: 'first_class',
    engineNative: true,
    needsFeature: null,
    backend: 'gpu_only',
  },
  ImageReveal: {
    fidelity: 'first_class',
    engineNative: true,
    needsFeature: null,
    backend: 'gpu_only',
  },
  InputField: {
    fidelity: 'first_class',
    engineNative: true,
    needsFeature: null,
    backend: 'both',
  },
  KanbanBoard: { fidelity: 'first_class', engineNative: true, needsFeature: null, backend: 'both' },
  KenBurns: { fidelity: 'first_class', engineNative: true, needsFeature: null, backend: 'both' },
  KineticText: {
    fidelity: 'first_class',
    engineNative: true,
    needsFeature: null,
    backend: 'both',
  },
  LineChart: {
    fidelity: 'first_class',
    engineNative: true,
    needsFeature: null,
    backend: 'gpu_only',
  },
  LogoSting: {
    fidelity: 'first_class',
    engineNative: true,
    needsFeature: null,
    backend: 'gpu_only',
  },
  LowerThird: {
    fidelity: 'first_class',
    engineNative: true,
    needsFeature: null,
    backend: 'both',
  },
  Marquee: { fidelity: 'first_class', engineNative: true, needsFeature: null, backend: 'both' },
  MaskReveal: { fidelity: 'first_class', engineNative: true, needsFeature: null, backend: 'both' },
  MatrixDecode: {
    fidelity: 'first_class',
    engineNative: true,
    needsFeature: null,
    backend: 'both',
  },
  MeshGradient: {
    fidelity: 'first_class',
    engineNative: true,
    needsFeature: null,
    backend: 'both',
  },
  NodeGraph: {
    fidelity: 'first_class',
    engineNative: true,
    needsFeature: null,
    backend: 'gpu_only',
  },
  Parallax: { fidelity: 'first_class', engineNative: true, needsFeature: null, backend: 'both' },
  PieReveal: {
    fidelity: 'first_class',
    engineNative: true,
    needsFeature: null,
    backend: 'gpu_only',
  },
  PricingCard: {
    fidelity: 'first_class',
    engineNative: true,
    needsFeature: null,
    backend: 'both',
  },
  ProgressBar: { fidelity: 'first_class', engineNative: true, needsFeature: null, backend: 'both' },
  ProgressSteps: {
    fidelity: 'first_class',
    engineNative: true,
    needsFeature: null,
    backend: 'both',
  },
  PulsingIndicator: {
    fidelity: 'first_class',
    engineNative: true,
    needsFeature: null,
    backend: 'both',
  },
  QuoteCard: { fidelity: 'first_class', engineNative: true, needsFeature: null, backend: 'both' },
  RgbGlitch: {
    fidelity: 'first_class',
    engineNative: true,
    needsFeature: null,
    backend: 'gpu_only',
  },
  RotateIn: {
    fidelity: 'first_class',
    engineNative: true,
    needsFeature: null,
    backend: 'gpu_only',
  },
  ScaleIn: {
    fidelity: 'first_class',
    engineNative: true,
    needsFeature: null,
    backend: 'both',
  },
  ShimmerSweep: {
    fidelity: 'first_class',
    engineNative: true,
    needsFeature: null,
    backend: 'gpu_only',
  },
  SkeletonCard: {
    fidelity: 'first_class',
    engineNative: false,
    needsFeature: null,
    backend: 'both',
  },
  SlideIn: { fidelity: 'first_class', engineNative: true, needsFeature: null, backend: 'both' },
  SlideOut: { fidelity: 'first_class', engineNative: true, needsFeature: null, backend: 'both' },
  SlotMachineRoll: {
    fidelity: 'first_class',
    engineNative: true,
    needsFeature: null,
    backend: 'both',
  },
  SplitScreen: {
    fidelity: 'first_class',
    engineNative: true,
    needsFeature: null,
    backend: 'both',
  },
  Spotlight: {
    fidelity: 'first_class',
    engineNative: true,
    needsFeature: null,
    backend: 'gpu_only',
  },
  SpotlightCard: {
    fidelity: 'first_class',
    engineNative: false,
    needsFeature: null,
    backend: 'both',
  },
  StaggerGroup: {
    fidelity: 'first_class',
    engineNative: true,
    needsFeature: null,
    backend: 'both',
  },
  StatCard: { fidelity: 'first_class', engineNative: true, needsFeature: null, backend: 'both' },
  Terminal: {
    fidelity: 'first_class',
    engineNative: true,
    needsFeature: null,
    backend: 'both',
  },
  TextFadeReplace: {
    fidelity: 'first_class',
    engineNative: true,
    needsFeature: null,
    backend: 'both',
  },
  Timeline: { fidelity: 'first_class', engineNative: true, needsFeature: null, backend: 'both' },
  TitleCard: { fidelity: 'first_class', engineNative: true, needsFeature: null, backend: 'both' },
  TrackingIn: {
    fidelity: 'first_class',
    engineNative: true,
    needsFeature: null,
    backend: 'both',
  },
  Typewriter: { fidelity: 'first_class', engineNative: true, needsFeature: null, backend: 'both' },
  Underline: { fidelity: 'first_class', engineNative: true, needsFeature: null, backend: 'both' },
  VideoClip: {
    fidelity: 'first_class',
    engineNative: true,
    needsFeature: null,
    backend: 'gpu_only',
  },
  Vignette: { fidelity: 'first_class', engineNative: true, needsFeature: null, backend: 'both' },
  WordRotate: { fidelity: 'first_class', engineNative: true, needsFeature: null, backend: 'both' },
  WordStagger: { fidelity: 'first_class', engineNative: true, needsFeature: null, backend: 'both' },
}

export const FIDELITY_SUMMARY = {
  firstClass: 72,
  degraded: 0,
  apesRemotion: 0,
} as const

/** The safe, recommended palette: every first-class component. An agent can
 *  default to these in one read and only escalate to degraded ones on demand. */
export const RECOMMENDED_PALETTE: readonly string[] = [
  'AudioClip',
  'AudioVisualizer',
  'BentoGrid',
  'BarChart',
  'BlurReveal',
  'BoundingBox',
  'Button',
  'BrowserFrame',
  'Callout',
  'ChapterCard',
  'CameraShake',
  'Captions',
  'CodeBlock',
  'CodeDiff',
  'Confetti',
  'CountUp',
  'Cursor',
  'DeviceFrame',
  'DrawOn',
  'DynamicGrid',
  'EndCard',
  'FadeIn',
  'FadeOut',
  'FilmGrade',
  'GradientShift',
  'GrainOverlay',
  'Highlight',
  'ImageReveal',
  'InputField',
  'IconPop',
  'KanbanBoard',
  'KenBurns',
  'KineticText',
  'LogoSting',
  'LowerThird',
  'LineChart',
  'MatrixDecode',
  'MeshGradient',
  'Marquee',
  'MaskReveal',
  'NodeGraph',
  'PricingCard',
  'Parallax',
  'PieReveal',
  'ProgressBar',
  'ProgressSteps',
  'PulsingIndicator',
  'QuoteCard',
  'RgbGlitch',
  'RotateIn',
  'SkeletonCard',
  'ScaleIn',
  'ShimmerSweep',
  'SlideIn',
  'SlotMachineRoll',
  'SpotlightCard',
  'SplitScreen',
  'SlideOut',
  'Spotlight',
  'StaggerGroup',
  'StatCard',
  'Terminal',
  'TextFadeReplace',
  'TrackingIn',
  'Timeline',
  'TitleCard',
  'Typewriter',
  'Underline',
  'VideoClip',
  'Vignette',
  'WordRotate',
  'WordStagger',
]

/** Engine capability statement — what the agent should lean on, and what it must
 *  NOT author for. The "don't chase" features want a filter/blend/3D pipeline the
 *  vector engine deliberately omits; the engine's job is the best deterministic
 *  GPU vector renderer, not a headless browser. */
export const ENGINE_CAPABILITIES = {
  supported: [
    'vector fills / strokes (cap/join/dash) / rounded-rect / arbitrary Bézier paths',
    'linear + radial gradients with stops (CPU + GPU)',
    'per-glyph vector text (resolution-independent) with letter-spacing / tracking',
    'author-time text metrics (measureText width; fontMetrics capHeight/xHeight/capTop; glyphLayout kerning-accurate per-char positions)',
    'taffy flexbox layout (direction/justify/align/gap/padding/wrap)',
    '2D affine transforms (translate / scale / rotate) with transform-origin pivot',
    'clipping (rect / ellipse / path) in local space',
    'images + video frames with cover/contain/fill fit',
    'audio decode + FFT spectrum (symphonia + rustfft)',
    'deterministic CPU==GPU verification; parallel frame export',
    'blend modes (multiply / screen / overlay / soft-light / …, GPU)',
    'procedural film grain (onda-noise source + overlay blend, GPU)',
    'drop-shadow / glow (analytic blurred rounded-rect)',
    'animated image blur — gaussian focus-pull in the image pass (CPU+GPU+native byte-identical)',
    'content/text blur — screen-space gaussian over an arbitrary subtree (Group/Text/…) via the render-to-texture pass; the `blur` sugar prop, ramps for soft→sharp reveals (CPU+GPU)',
    'backdrop blur — frosted-glass blur of what is BEHIND a node (CSS `backdrop-filter`); the `backdropBlur` node prop samples the already-composited backdrop, blurs + tints + brightens it, and draws it as the node’s backing (Vello samples the rendered backdrop, the CPU reference its live framebuffer)',
    "mattes / masks — reveal one subtree THROUGH another's shape (CSS mask-image / SVG mask): the `matte` node prop (+ matteMode 'alpha'|'luminance') renders content + matte to textures and multiplies alpha — media-through-type, shape wipes, gradient reveals (render-to-texture)",
    'bloom / glow — bright-pass → large-σ blur → additive composite, the single biggest premium tell; the `bloom` node prop (CPU+GPU)',
    'cinematic color grade — per-pixel exposure / contrast / saturation / temperature / tint; the `grade` node prop, the "land mixed/AI media into one look" wedge (CPU+GPU)',
    'goo / metaball morph — blur → alpha-threshold so overlapping shapes fuse into liquid forms with smooth necks; the `goo` node prop (GPU)',
    "light-wrap — the blurred backdrop's light bleeds onto a cut-out node's feathered EDGES (the #1 'shot in, not pasted on' tell for landing a plate); the `lightWrap` node prop (GPU/export)",
    'directional / motion blur — a 1D gaussian smear of std-dev σ along an angle (the in-motion streak); the `directionalBlur` node prop (CPU+GPU)',
    'per-pixel stylize, one shared compute pipeline: `chromaticAberration` (lens RGB split), `vignette` (radial edge darkening), `posterize` (quantize to N levels), `duotone` (luminance → two colors), `chromaKey` (green-screen knock-out with despill) — all CPU+GPU node props',
    'fBm fractal-noise ANIMATED gradients (GPU compute over 2D simplex + domain-warp); CPU reference + WebGPU preview degrade to a smooth gradient, so judge on the native render',
    'composition-level cinematic FINISH — a scene-linear HDR chain (bloom + warm halation + grade + vignette + grain) ending in ONE ACES film tone-map; the "looks shot" output transform via `<Composition finish={…}>` (GPU/export-only — preview/CPU render un-finished)',
    'per-object MOTION BLUR — shutter-angle temporal supersampling via `<Composition motionBlur={…}>`: every moving element smears by its OWN motion (translation/rotation/scale), static stays sharp (export-only, N× render cost)',
    'trim paths — `trimStart`/`trimEnd`/`trimOffset` (0..1) on any stroked shape draw only that arc-length slice of the outline; the mograph line-draw, animate `trimEnd` 0→1 (CPU+GPU)',
    'repeater — `<Repeater count offsetX offsetY rotation scale startOpacity endOpacity>` stamps a subtree with COMPOUNDING transforms: grids (nest two), radial arrays, spirals, motion trails (all backends)',
    'boolean ops (merge paths) — `<Merge op="union|difference|intersect|xor">` combines shape children into ONE outline (ring = circle−circle, lens = circle∩circle, speech bubble = rect∪triangle); curves flattened, resolved on both backends (i_overlay)',
    'particles — `<Particles count seed x y speed angle spread gravity lifetime emitOver loop size opacity colors spin>` is a DETERMINISTIC emitter (bursts / fountains / confetti / sparks / dust / snow): every particle is a pure function of frame+seed+index, frame-based, rendered as plain shapes (position/size/opacity/colour are CPU==GPU; `spin` is rotation → GPU-only)',
    'Camera — pan / zoom viewport primitive for 2.5D camera moves',
    'no-Chromium export (ffmpeg / GIF / PNG)',
  ],
  unsupported: [
    { feature: '3D / perspective transforms', status: '2d-affine-only' },
    { feature: 'SVG filters / embedded text+image / gradient paint', status: 'flattened-to-solid' },
    { feature: 'color / emoji glyphs / variable fonts', status: 'outline-only' },
  ],
  backendNotes:
    "CPU reference (tiny-skia) renders fills, strokes (cap/join/dash), linear+radial gradients, and Bézier paths — byte-identical to Vello for those. It does NOT apply rotation or clipping (Vello-only) or decode video. A 'gpu_only' component needs one of those three; prefer 'both' components for a CPU-verified render.",
} as const
