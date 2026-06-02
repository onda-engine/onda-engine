//! `@onda/player` — interactive, accessible preview of ONDA compositions.
//!
//! `<Player>` previews through the **real** ONDA renderer when given an `engine`
//! (`@onda/wasm`'s `OndaEngine`, pixel-identical to `onda export`), and otherwise
//! falls back to the dependency-free Canvas2D {@link drawScene} preview.

export { cssColor, drawScene, type FrameDrawer } from './canvas-renderer.js'
export { engineDrawer, type RenderEngine, type RenderedFrame } from './engine-drawer.js'
export { Player, type PlayerProps, type PlayerHandle } from './player.js'
