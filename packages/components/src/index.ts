//! `@onda-engine/components` — the Onda motion language for `@onda-engine/react`.
//!
//! A Remotion-shaped choreography vocabulary + component library, ported from
//! ondajs. Author with these instead of re-deriving translate-fade math: the
//! motion fingerprint comes from the closed token system (durations, the house
//! spring, the house ease), shared by every component.

// Motion tokens
export {
  DURATION,
  type DurationToken,
  OVERSHOOT,
  SPRING_SMOOTH,
  SPRING_SNAPPY,
  STAGGER,
  staggerFrames,
} from './motion.js'

// House easing
export { HOUSE_EASE } from './easing.js'

// TimeInput — one duration grammar (frames or '0.5s'/'500ms'/'12f' strings)
// for every delay/duration-typed prop.
export { TIME_DESCRIPTION, type TimeInput, framesOf, timeSchema } from './time.js'

// Clip-aware timing — settle-time registry ("does it land before the cut?")
// + the fitToClip/maxSettle clamp.
export {
  COMPONENT_SETTLE,
  type FitToClipOpts,
  type SettleFn,
  settleTime,
  staggeredSettle,
  useTimeScale,
} from './timing.js'

// Real text measurement (the engine's cosmic-text shaping) for components that
// size to actual text; `preloadTextMetrics` warms it before a Node export.
export {
  measureText,
  fontMetrics,
  glyphLayout,
  type FontMetrics,
  type GlyphInfo,
  loadFont,
  type MeasureOpts,
  preloadTextMetrics,
  type TextMetrics,
  useFontMetrics,
  useGlyphLayout,
  useTextMetrics,
  useTextMetricsReady,
} from './text-metrics.js'

// Backend divergence — "what I see vs what ships", queryable per scene.
export {
  type Divergence,
  type DivergenceOpts,
  divergenceReport,
  matchesExport,
  type RenderBackend,
} from './divergence.js'

// Engine render-fidelity metadata — the capability signal for the agent contract.
export {
  type Backend,
  COMPONENT_FIDELITY,
  type ComponentFidelity,
  ENGINE_CAPABILITIES,
  type Fidelity,
  FIDELITY_SUMMARY,
  RECOMMENDED_PALETTE,
} from './fidelity.js'

// The agent catalog — per-component metadata + @onda-native Zod prop schemas,
// richer than ondajs (per-prop role/themeable, fidelity, sceneRole, examples).
// Replaces the `ondajs` manifest as the Studio agent's single source of truth.
export {
  compactCatalog,
  firstClassEntries,
  MANIFEST,
  MANIFEST_NAMES,
  type ManifestEntry,
  manifestEntry,
  type PropMeta,
} from './manifest.js'

// Glyph line — the ONE per-glyph text-layout primitive the text family
// (SlotMachineRoll / KineticText / TextAnimator / MatrixDecode) is built on.
export {
  type GlyphCell,
  type GlyphLine,
  type GlyphLineOpts,
  LINE_RATIO,
  layoutGlyphLine,
  lineStartX,
  lineTopY,
} from './glyph-line.js'

// Layout queries + single-line auto-fit (keep type on the frame)
export {
  type FitOpts,
  fitFontSize,
  fitMaxWidth,
  type ResolvedBounds,
  useFittedFontSize,
  useResolvedBounds,
} from './bounds.js'

// Placement — the ONE placement contract every placeable component speaks
// (region keywords or normalized {x,y}, element-center anchored).
export {
  type ElementSize,
  type FrameSize,
  isPlacement,
  PLACEMENT_DESCRIPTION,
  PLACEMENT_REGIONS,
  type Placement,
  type PlacementPoint,
  type PlacementRegion,
  type PlacedProps,
  Placed,
  PlacementShift,
  type PlacementShiftProps,
  placementSchema,
  type ResolvedPlacement,
  resolvePlacement,
  SAFE_MARGIN,
  usePlacement,
} from './placement.js'

// Theme (brand tokens — colors, fonts, logo) via React context
export {
  type Theme,
  type ThemeProviderProps,
  ThemeProvider,
  defaultTheme,
  useTheme,
} from './theme.js'

// Choreography vocabulary (pure frame → Motion functions)
export {
  type Motion,
  type PatternInput,
  entryFade,
  entryFadeRise,
  entryScale,
  entrySlide,
  exitFade,
  exitFadeFall,
  exitScale,
  exitSlide,
  heroReveal,
  stateSwap,
} from './choreography.js'

// React hooks
export {
  type EntranceOptions,
  type EntranceType,
  useEntrance,
  useSceneProgress,
  useSpringValue,
  useStaggeredEntrance,
  useTextReveal,
} from './hooks.js'
export {
  type AudioAnalyzer,
  type Beats,
  type BeatsHandle,
  beatPulse,
  framesSinceBeat,
  isBeat,
  useAudioBeats,
  useAudioData,
} from './audio.js'

// Components (atomic wrappers + composites + effects), ported from ondajs.
export { AudioClip, type AudioClipProps } from './components/AudioClip.js'
export { AudioVisualizer, type AudioVisualizerProps } from './components/AudioVisualizer.js'
export { BarChart, type BarChartDatum, type BarChartProps } from './components/BarChart.js'
export { BentoGrid, type BentoGridProps, type BentoItem } from './components/BentoGrid.js'
export { BlurReveal, type BlurRevealProps } from './components/BlurReveal.js'
export { BoundingBox, type BoundingBoxProps } from './components/BoundingBox.js'
export { BrowserFrame, type BrowserFrameProps } from './components/BrowserFrame.js'
export { Button, type ButtonProps } from './components/Button.js'
export { Callout, type CalloutProps, type CalloutDirection } from './components/Callout.js'
export { CameraShake, type CameraShakeProps } from './components/CameraShake.js'
export { CardShowcase, type CardShowcaseProps } from './components/CardShowcase.js'
export { Captions, type CaptionsProps, type CaptionEntry } from './components/Captions.js'
export { ChapterCard, type ChapterCardProps } from './components/ChapterCard.js'
export { CodeBlock, type CodeBlockProps } from './components/CodeBlock.js'
export {
  CodeDiff,
  type CodeDiffProps,
  type DiffLine,
  type DiffLineType,
} from './components/CodeDiff.js'
export { Confetti, type ConfettiProps } from './components/Confetti.js'
export { CountUp, type CountUpProps } from './components/CountUp.js'
export { Cursor, type CursorProps } from './components/Cursor.js'
export { DeviceFrame, type DeviceFrameProps } from './components/DeviceFrame.js'
export { DrawOn, type DrawOnProps } from './components/DrawOn.js'
export { DynamicGrid, type DynamicGridProps } from './components/DynamicGrid.js'
export { EndCard, type EndCardProps } from './components/EndCard.js'
export { FadeIn, type FadeInProps } from './components/FadeIn.js'
export { FadeOut, type FadeOutProps } from './components/FadeOut.js'
export { FilmGrade, type FilmGradeProps, type FilmLook } from './components/FilmGrade.js'
export { GradientShift, type GradientShiftProps } from './components/GradientShift.js'
export { GrainOverlay, type GrainOverlayProps } from './components/GrainOverlay.js'
export { Highlight, type HighlightProps } from './components/Highlight.js'
export { IconPop, type IconPopProps, type IconShape } from './components/IconPop.js'
export {
  ImageReveal,
  type ImageRevealProps,
  type ImageRevealMotion,
  type ImageRevealFit,
} from './components/ImageReveal.js'
export { InputField, type InputFieldProps } from './components/InputField.js'
export { KanbanBoard, type KanbanBoardProps, type KanbanColumn } from './components/KanbanBoard.js'
export { KenBurns, type KenBurnsProps } from './components/KenBurns.js'
export {
  Keyframes,
  type KeyframesProps,
  type KeyframesImageContent,
  type KeyframesTextContent,
  type PosKey,
  type ValKey,
  type Ease,
} from './components/Keyframes.js'
// Shared keyframe sampler — consumed by the cinema EXPORT choreography + the
// Studio preview so both interpolate identically (no twin to drift).
export {
  sampleKeyframes,
  sampleTrack,
  hasKeyframeTracks,
  type KeyframeTracks,
  type SampledKeyframes,
} from './keyframes-sampler.js'
// "Magic Resize" — per-element responsive re-framing (Canva/Figma constraints), so
// one master adapts to any aspect ratio. Shared by the cinema export + Studio preview.
export {
  type Box,
  type ResponsiveTransform,
  entryDesignAnchor,
  responsiveEntryTransform,
} from './responsive.js'
export {
  KineticText,
  type KineticTextPreset,
  type KineticTextProps,
} from './components/KineticText.js'
export { LineChart, type LineChartProps } from './components/LineChart.js'
export { LogoReveal, type LogoRevealPreset, type LogoRevealProps } from './components/LogoReveal.js'
export { LogoSting, type LogoStingProps } from './components/LogoSting.js'
export {
  LookbookShot,
  type LookbookLayout,
  type LookbookShotProps,
} from './components/LookbookShot.js'
export { LowerThird, type LowerThirdProps } from './components/LowerThird.js'
export { Marquee, type MarqueeProps } from './components/Marquee.js'
export { MaskReveal, type MaskRevealProps } from './components/MaskReveal.js'
export { MatrixDecode, type MatrixDecodeProps } from './components/MatrixDecode.js'
export { MeshGradient, type MeshGradientProps } from './components/MeshGradient.js'
export { Moodboard, type MoodboardProps } from './components/Moodboard.js'
export { NodeGraph, type NodeGraphProps, type Satellite } from './components/NodeGraph.js'
export { Parallax, type ParallaxProps, type ParallaxLayer } from './components/Parallax.js'
export { PathMorph, type PathMorphProps } from './components/PathMorph.js'
export { PieReveal, type PieRevealProps, type PieRevealSlice } from './components/PieReveal.js'
export { PriceTag, type PriceTagProps } from './components/PriceTag.js'
export { PricingCard, type PricingCardProps } from './components/PricingCard.js'
export { ProductWall, type ProductWallProps } from './components/ProductWall.js'
export { ProgressBar, type ProgressBarProps } from './components/ProgressBar.js'
export { ProgressSteps, type ProgressStepsProps } from './components/ProgressSteps.js'
export { PulsingIndicator, type PulsingIndicatorProps } from './components/PulsingIndicator.js'
export { QuoteCard, type QuoteCardProps } from './components/QuoteCard.js'
export { RgbGlitch, type RgbGlitchProps } from './components/RgbGlitch.js'
export { RotateIn, type RotateInProps } from './components/RotateIn.js'
export { ScaleIn, type ScaleInProps } from './components/ScaleIn.js'
export { Scrim, type ScrimProps } from './components/Scrim.js'
export { SiteReveal, type SiteRevealProps } from './components/SiteReveal.js'
export { ShimmerSweep, type ShimmerSweepProps } from './components/ShimmerSweep.js'
export { SkeletonCard, type SkeletonCardProps } from './components/SkeletonCard.js'
export { SlideIn, type SlideInProps } from './components/SlideIn.js'
export { SlideOut, type SlideOutProps } from './components/SlideOut.js'
export { SlotMachineRoll, type SlotMachineRollProps } from './components/SlotMachineRoll.js'
export { SplitScreen, type SplitScreenProps } from './components/SplitScreen.js'
export { Spotlight, type SpotlightProps } from './components/Spotlight.js'
export { SpotlightCard, type SpotlightCardProps } from './components/SpotlightCard.js'
export { StaggerGroup, type StaggerGroupProps } from './components/StaggerGroup.js'
export { SplitLockup, type SplitLockupProps } from './components/SplitLockup.js'
export { StatCard, type StatCardProps } from './components/StatCard.js'
export { Terminal, type TerminalProps } from './components/Terminal.js'
export {
  TextAnimator,
  type TextAnimate,
  type TextAnimatorDirection,
  type TextAnimatorProps,
  type TextAnimatorUnit,
} from './components/TextAnimator.js'
export { TextFadeReplace, type TextFadeReplaceProps } from './components/TextFadeReplace.js'
export { Timeline, type TimelineEvent, type TimelineProps } from './components/Timeline.js'
export { TitleCard, type TitleCardProps } from './components/TitleCard.js'
export { TrackingIn, type TrackingInProps } from './components/TrackingIn.js'
export { Typewriter, type TypewriterProps } from './components/Typewriter.js'
export { Underline, type UnderlineProps } from './components/Underline.js'
export { VideoClip, type VideoClipProps } from './components/VideoClip.js'
export { Vignette, type VignetteProps } from './components/Vignette.js'
export { WordRotate, type WordRotateProps } from './components/WordRotate.js'
export { WordStagger, type WordStaggerProps } from './components/WordStagger.js'
