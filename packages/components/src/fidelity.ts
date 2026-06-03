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
//! - `backend`      — `both` renders on the CPU reference too (byte-identical
//!                    CPU==GPU verification holds); `gpu_only` needs Vello today
//!                    because the CPU reference rasterizes solid rect/ellipse
//!                    only (gradients collapse to first stop; paths/strokes/
//!                    video skipped). P1/P2 (CPU gradients + paths) promote these.
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
    fidelity: 'degraded',
    engineNative: true,
    needsFeature: 'gradients',
    backend: 'gpu_only',
  },
  BarChart: { fidelity: 'first_class', engineNative: true, needsFeature: null, backend: 'both' },
  BentoGrid: {
    fidelity: 'degraded',
    engineNative: false,
    needsFeature: 'backdrop-blur',
    backend: 'both',
  },
  BlurReveal: {
    fidelity: 'degraded',
    engineNative: false,
    needsFeature: 'blur pass',
    backend: 'both',
  },
  BoundingBox: {
    fidelity: 'degraded',
    engineNative: true,
    needsFeature: 'stroke-dash',
    backend: 'gpu_only',
  },
  BrowserFrame: {
    fidelity: 'degraded',
    engineNative: true,
    needsFeature: 'object-fit',
    backend: 'both',
  },
  Button: {
    fidelity: 'degraded',
    engineNative: true,
    needsFeature: 'letter-spacing',
    backend: 'both',
  },
  Callout: {
    fidelity: 'degraded',
    engineNative: true,
    needsFeature: 'letter-spacing',
    backend: 'both',
  },
  CameraShake: { fidelity: 'first_class', engineNative: true, needsFeature: null, backend: 'both' },
  Captions: {
    fidelity: 'degraded',
    engineNative: true,
    needsFeature: 'letter-spacing',
    backend: 'both',
  },
  ChapterCard: {
    fidelity: 'degraded',
    engineNative: true,
    needsFeature: 'letter-spacing',
    backend: 'both',
  },
  CodeBlock: {
    fidelity: 'degraded',
    engineNative: false,
    needsFeature: 'backdrop-blur',
    backend: 'both',
  },
  CodeDiff: { fidelity: 'first_class', engineNative: true, needsFeature: null, backend: 'both' },
  Confetti: { fidelity: 'first_class', engineNative: true, needsFeature: null, backend: 'both' },
  CountUp: { fidelity: 'first_class', engineNative: true, needsFeature: null, backend: 'both' },
  Cursor: {
    fidelity: 'degraded',
    engineNative: true,
    needsFeature: 'transform-origin',
    backend: 'both',
  },
  DeviceFrame: {
    fidelity: 'degraded',
    engineNative: true,
    needsFeature: 'object-fit',
    backend: 'both',
  },
  DrawOn: { fidelity: 'first_class', engineNative: true, needsFeature: null, backend: 'both' },
  DynamicGrid: {
    fidelity: 'degraded',
    engineNative: true,
    needsFeature: 'gradients',
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
    fidelity: 'degraded',
    engineNative: true,
    needsFeature: 'gradients',
    backend: 'gpu_only',
  },
  GrainOverlay: {
    fidelity: 'apes_remotion',
    engineNative: false,
    needsFeature: null,
    backend: 'both',
  },
  Highlight: { fidelity: 'first_class', engineNative: true, needsFeature: null, backend: 'both' },
  IconPop: {
    fidelity: 'degraded',
    engineNative: true,
    needsFeature: 'line-cap/line-join',
    backend: 'gpu_only',
  },
  ImageReveal: {
    fidelity: 'degraded',
    engineNative: false,
    needsFeature: 'blur pass',
    backend: 'both',
  },
  InputField: {
    fidelity: 'degraded',
    engineNative: true,
    needsFeature: 'letter-spacing',
    backend: 'both',
  },
  KanbanBoard: { fidelity: 'first_class', engineNative: true, needsFeature: null, backend: 'both' },
  KenBurns: { fidelity: 'first_class', engineNative: true, needsFeature: null, backend: 'both' },
  LineChart: {
    fidelity: 'degraded',
    engineNative: true,
    needsFeature: 'line-cap/line-join',
    backend: 'gpu_only',
  },
  LogoSting: {
    fidelity: 'degraded',
    engineNative: true,
    needsFeature: 'stroke-dash',
    backend: 'gpu_only',
  },
  LowerThird: {
    fidelity: 'degraded',
    engineNative: true,
    needsFeature: 'letter-spacing',
    backend: 'both',
  },
  Marquee: { fidelity: 'first_class', engineNative: true, needsFeature: null, backend: 'both' },
  MaskReveal: { fidelity: 'first_class', engineNative: true, needsFeature: null, backend: 'both' },
  MatrixDecode: {
    fidelity: 'degraded',
    engineNative: true,
    needsFeature: 'letter-spacing',
    backend: 'both',
  },
  MeshGradient: {
    fidelity: 'degraded',
    engineNative: true,
    needsFeature: 'gradients',
    backend: 'gpu_only',
  },
  NodeGraph: {
    fidelity: 'degraded',
    engineNative: true,
    needsFeature: 'gradients',
    backend: 'gpu_only',
  },
  Parallax: { fidelity: 'first_class', engineNative: true, needsFeature: null, backend: 'both' },
  PieReveal: {
    fidelity: 'degraded',
    engineNative: true,
    needsFeature: 'gradients',
    backend: 'gpu_only',
  },
  PricingCard: {
    fidelity: 'degraded',
    engineNative: true,
    needsFeature: 'letter-spacing',
    backend: 'both',
  },
  ProgressBar: { fidelity: 'first_class', engineNative: true, needsFeature: null, backend: 'both' },
  ProgressSteps: {
    fidelity: 'degraded',
    engineNative: true,
    needsFeature: 'color-mix',
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
    fidelity: 'degraded',
    engineNative: false,
    needsFeature: 'blend modes',
    backend: 'both',
  },
  RotateIn: {
    fidelity: 'degraded',
    engineNative: true,
    needsFeature: 'transform-origin',
    backend: 'both',
  },
  ScaleIn: {
    fidelity: 'degraded',
    engineNative: true,
    needsFeature: 'transform-origin',
    backend: 'both',
  },
  ShimmerSweep: {
    fidelity: 'degraded',
    engineNative: true,
    needsFeature: 'gradients',
    backend: 'gpu_only',
  },
  SkeletonCard: {
    fidelity: 'degraded',
    engineNative: false,
    needsFeature: 'backdrop-blur',
    backend: 'both',
  },
  SlideIn: { fidelity: 'first_class', engineNative: true, needsFeature: null, backend: 'both' },
  SlideOut: { fidelity: 'first_class', engineNative: true, needsFeature: null, backend: 'both' },
  SlotMachineRoll: {
    fidelity: 'degraded',
    engineNative: true,
    needsFeature: 'letter-spacing',
    backend: 'both',
  },
  SplitScreen: {
    fidelity: 'degraded',
    engineNative: true,
    needsFeature: 'letter-spacing',
    backend: 'both',
  },
  Spotlight: {
    fidelity: 'degraded',
    engineNative: true,
    needsFeature: 'gradients',
    backend: 'gpu_only',
  },
  SpotlightCard: {
    fidelity: 'degraded',
    engineNative: false,
    needsFeature: 'backdrop-blur',
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
    fidelity: 'degraded',
    engineNative: true,
    needsFeature: 'letter-spacing',
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
    fidelity: 'degraded',
    engineNative: true,
    needsFeature: 'letter-spacing',
    backend: 'both',
  },
  Typewriter: { fidelity: 'first_class', engineNative: true, needsFeature: null, backend: 'both' },
  Underline: { fidelity: 'first_class', engineNative: true, needsFeature: null, backend: 'both' },
  VideoClip: {
    fidelity: 'degraded',
    engineNative: true,
    needsFeature: 'video decode',
    backend: 'gpu_only',
  },
  Vignette: { fidelity: 'first_class', engineNative: true, needsFeature: null, backend: 'both' },
  WordRotate: { fidelity: 'first_class', engineNative: true, needsFeature: null, backend: 'both' },
  WordStagger: { fidelity: 'first_class', engineNative: true, needsFeature: null, backend: 'both' },
}

export const FIDELITY_SUMMARY = {
  firstClass: 30,
  degraded: 39,
  apesRemotion: 1,
} as const

/** The safe, recommended palette: every first-class component. An agent can
 *  default to these in one read and only escalate to degraded ones on demand. */
export const RECOMMENDED_PALETTE: readonly string[] = [
  'AudioClip',
  'BarChart',
  'CameraShake',
  'CodeDiff',
  'Confetti',
  'CountUp',
  'DrawOn',
  'FadeIn',
  'FadeOut',
  'Highlight',
  'KanbanBoard',
  'KenBurns',
  'Marquee',
  'MaskReveal',
  'Parallax',
  'ProgressBar',
  'PulsingIndicator',
  'QuoteCard',
  'SlideIn',
  'SlideOut',
  'StaggerGroup',
  'StatCard',
  'TextFadeReplace',
  'Timeline',
  'TitleCard',
  'Typewriter',
  'Underline',
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
    'vector fills / strokes / rounded-rect / arbitrary Bézier paths',
    'linear + radial gradients with stops (GPU)',
    'per-glyph vector text (resolution-independent)',
    'taffy flexbox layout (direction/justify/align/gap/padding/wrap)',
    '2D affine transforms (translate / scale / rotate)',
    'clipping (rect / ellipse / path) in local space',
    'images + video frames with cover/contain/fill fit',
    'audio decode + FFT spectrum (symphonia + rustfft)',
    'deterministic CPU==GPU verification; parallel frame export',
    'no-Chromium export (ffmpeg / GIF / PNG)',
  ],
  unsupported: [
    {
      feature: 'blur / backdrop-blur / drop-shadow',
      status: 'deferred-gpu-layer',
      guidance: "Don't author for blur; use stylized fills/gradients.",
    },
    { feature: 'blend modes beyond src-over', status: 'deferred' },
    { feature: 'transform-origin / 3D / perspective', status: '2d-affine-only' },
    { feature: 'letter-spacing / per-glyph tracking', status: 'not-exposed' },
    { feature: 'author-time text metrics', status: 'size-only' },
    { feature: 'SVG filters / embedded text+image / gradient paint', status: 'flattened-to-solid' },
    { feature: 'color / emoji glyphs / variable fonts', status: 'outline-only' },
  ],
  backendNotes:
    "CPU reference backend renders solid rect/ellipse only — gradients collapse to first stop; paths/strokes/video skipped. For byte-identical CPU==GPU output prefer backend:'both' components until CPU gradient+path support lands.",
} as const
