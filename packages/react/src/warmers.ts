//! Engine-warmer registry — a hook for packages that need to load async engine
//! assets (e.g. the wasm text-measurement module) BEFORE the synchronous frame
//! render, so components bake exact values instead of estimates on export.
//!
//! `@onda/react` is the shared hub: `@onda/components` registers its warmer on
//! import (`registerEngineWarmer(preloadTextMetrics)`), and `@onda/render` awaits
//! `runEngineWarmers()` before `renderFramesJSON`. No package-to-package coupling,
//! and it's automatic — importing the components that need warming registers it.

type Warmer = () => Promise<void>

const warmers: Warmer[] = []

/** Register an async warmer to run before a render. Idempotent per function. */
export function registerEngineWarmer(warm: Warmer): void {
  if (!warmers.includes(warm)) warmers.push(warm)
}

/** Run all registered warmers (best-effort — a warmer that throws is ignored, so
 *  the render still proceeds with whatever fallback the component uses). */
export async function runEngineWarmers(): Promise<void> {
  await Promise.all(warmers.map((w) => w().catch(() => {})))
}
