export { buildComposition, inspect, validateComposition } from './packages/cinema/dist/index.js'
export { renderToFile, renderStillToFile } from './packages/render/dist/index.js'
// renderFrameRangeJSON: a frame window → frames.json for the CLI's vision verbs
// (lint / contact-sheet / render-frame --crop / export-frames) — the agent's
// motion-perception bridge (measure + see a transition without a full render).
export { registerFont, renderFrameRangeJSON } from './packages/react/dist/index.js'
// loadFont feeds the AUTHOR-TIME measurement engine (so measureText resolves the
// font for centering) AND registers the bytes for the renderer — registerFont
// alone only does the latter, leaving measureText on the fallback font.
export { loadFont, preloadTextMetrics } from './packages/components/dist/index.js'
// flattenResponsive: BAKE the per-element magic-reframe into the payload before the
// native binary renders it — so EXPORT matches the React PREVIEW (the binary has no
// per-element reframe of its own). The embedding app calls it with the output canvas.
export { flattenResponsive } from './packages/components/dist/index.js'
// Author-time layout primitives (text measurement + placement) and the component
// MANIFEST — consumed by embedding apps (ONDA Studio's occlusion gate + the agent
// vocabulary) so they don't need the source packages at runtime.
export { isPlacement, measureText, resolvePlacement } from './packages/components/dist/index.js'
export { CAPABILITIES, MANIFEST } from './packages/components/dist/manifest.js'
