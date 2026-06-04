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
    fidelity: 'degraded',
    engineNative: false,
    needsFeature: 'blur pass',
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
    fidelity: 'degraded',
    engineNative: false,
    needsFeature: 'blur pass',
    backend: 'both',
  },
  FadeIn: { fidelity: 'first_class', engineNative: true, needsFeature: null, backend: 'both' },
  FadeOut: { fidelity: 'first_class', engineNative: true, needsFeature: null, backend: 'both' },
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
    fidelity: 'degraded',
    engineNative: false,
    needsFeature: 'blur pass',
    backend: 'both',
  },
  InputField: {
    fidelity: 'first_class',
    engineNative: true,
    needsFeature: null,
    backend: 'both',
  },
  KanbanBoard: { fidelity: 'first_class', engineNative: true, needsFeature: null, backend: 'both' },
  KenBurns: { fidelity: 'first_class', engineNative: true, needsFeature: null, backend: 'both' },
  LineChart: {
    fidelity: 'first_class',
    engineNative: true,
    needsFeature: null,
    backend: 'gpu_only',
  },
  LogoSting: {
    fidelity: 'degraded',
    engineNative: true,
    needsFeature: 'stroke-dash',
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
  firstClass: 66,
  degraded: 4,
  apesRemotion: 0,
} as const

/** The safe, recommended palette: every first-class component. An agent can
 *  default to these in one read and only escalate to degraded ones on demand. */
export const RECOMMENDED_PALETTE: readonly string[] = [
  'AudioClip',
  'AudioVisualizer',
  'BentoGrid',
  'BarChart',
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
  'FadeIn',
  'FadeOut',
  'GradientShift',
  'GrainOverlay',
  'Highlight',
  'InputField',
  'IconPop',
  'KanbanBoard',
  'KenBurns',
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
    'author-time text metrics (measureText — size underlines/pills to real text)',
    'taffy flexbox layout (direction/justify/align/gap/padding/wrap)',
    '2D affine transforms (translate / scale / rotate) with transform-origin pivot',
    'clipping (rect / ellipse / path) in local space',
    'images + video frames with cover/contain/fill fit',
    'audio decode + FFT spectrum (symphonia + rustfft)',
    'deterministic CPU==GPU verification; parallel frame export',
    'blend modes (multiply / screen / overlay / soft-light / …, GPU)',
    'procedural film grain (onda-noise source + overlay blend, GPU)',
    'drop-shadow / glow (analytic blurred rounded-rect)',
    'no-Chromium export (ffmpeg / GIF / PNG)',
  ],
  unsupported: [
    {
      feature: 'blur / backdrop-blur / drop-shadow',
      status: 'deferred-gpu-layer',
      guidance: "Don't author for blur; use stylized fills/gradients.",
    },
    { feature: '3D / perspective transforms', status: '2d-affine-only' },
    { feature: 'SVG filters / embedded text+image / gradient paint', status: 'flattened-to-solid' },
    { feature: 'color / emoji glyphs / variable fonts', status: 'outline-only' },
  ],
  backendNotes:
    "CPU reference (tiny-skia) renders fills, strokes (cap/join/dash), linear+radial gradients, and Bézier paths — byte-identical to Vello for those. It does NOT apply rotation or clipping (Vello-only) or decode video. A 'gpu_only' component needs one of those three; prefer 'both' components for a CPU-verified render.",
} as const
