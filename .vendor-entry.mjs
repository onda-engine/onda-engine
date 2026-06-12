export { buildComposition, validateComposition } from './packages/cinema/dist/index.js'
export { renderToFile, renderStillToFile } from './packages/render/dist/index.js'
export { registerFont } from './packages/react/dist/index.js'
// loadFont feeds the AUTHOR-TIME measurement engine (so measureText resolves the
// font for centering) AND registers the bytes for the renderer — registerFont
// alone only does the latter, leaving measureText on the fallback font.
export { loadFont, preloadTextMetrics } from './packages/components/dist/index.js'
