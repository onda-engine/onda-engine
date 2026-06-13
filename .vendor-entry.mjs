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
