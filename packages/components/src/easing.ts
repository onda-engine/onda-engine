//! House easing curve.
//!
//! For physical motion (translate / scale / rotation) use the springs in
//! `motion.ts` — SPRING_SMOOTH (default, no overshoot) and SPRING_SNAPPY. The
//! HOUSE_EASE below is the canonical curve for opacity / color / non-physical
//! transitions only. Never raw linear for tracked motion.

import { cubicBezier } from '@onda-engine/react'

/** The house easing curve — a restrained ease-out (`cubic-bezier(0.16, 1, 0.3, 1)`).
 *  Use for opacity / color fades and anything the eye tracks but that doesn't
 *  move physically. (ondajs uses Remotion's `Easing.bezier`; `@onda-engine/react`
 *  exposes the same curve as `cubicBezier`.) */
export const HOUSE_EASE = cubicBezier(0.16, 1, 0.3, 1)
