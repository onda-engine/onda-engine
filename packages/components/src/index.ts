//! `@onda/components` — the Onda motion language for `@onda/react`.
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

// Components — atomic motion wrappers
export { FadeIn, type FadeInProps } from './components/FadeIn.js'
export { FadeOut, type FadeOutProps } from './components/FadeOut.js'
export { RotateIn, type RotateInProps } from './components/RotateIn.js'
export { ScaleIn, type ScaleInProps } from './components/ScaleIn.js'
export { SlideIn, type SlideInProps } from './components/SlideIn.js'
export { SlideOut, type SlideOutProps } from './components/SlideOut.js'

// Components — composites
export { BarChart, type BarChartDatum, type BarChartProps } from './components/BarChart.js'
export { CountUp, type CountUpProps } from './components/CountUp.js'
export { Marquee, type MarqueeProps } from './components/Marquee.js'
export { Highlight, type HighlightProps } from './components/Highlight.js'
export { ProgressBar, type ProgressBarProps } from './components/ProgressBar.js'
export { PulsingIndicator, type PulsingIndicatorProps } from './components/PulsingIndicator.js'
export { Spotlight, type SpotlightProps } from './components/Spotlight.js'
export { StatCard, type StatCardProps } from './components/StatCard.js'
export { TitleCard, type TitleCardProps } from './components/TitleCard.js'
export { Typewriter, type TypewriterProps } from './components/Typewriter.js'
export { Underline, type UnderlineProps } from './components/Underline.js'
export { Vignette, type VignetteProps } from './components/Vignette.js'
export { WordStagger, type WordStaggerProps } from './components/WordStagger.js'
