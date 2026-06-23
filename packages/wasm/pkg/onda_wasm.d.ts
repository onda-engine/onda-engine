/* tslint:disable */
/* eslint-disable */

/**
 * Font-level vertical metrics exposed to JS — distances in pixels at the
 * measured font size. Returned by [`OndaEngine::font_metrics`].
 */
export class FontMetricsJs {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Distance from node's `y` to the baseline (same as `TextMetrics.ascent`, px).
     */
    readonly ascent: number;
    /**
     * Height of capital letters (top of caps to baseline, px).
     */
    readonly cap_height: number;
    /**
     * Distance from the node's `y` to the top of capital letters (px).
     */
    readonly cap_top: number;
    /**
     * Baseline to bottom of the line box (px).
     */
    readonly descent: number;
    /**
     * Baseline-to-baseline line height (px).
     */
    readonly lineHeight: number;
    /**
     * x-height in px (top of 'x' to baseline).
     */
    readonly x_height: number;
    /**
     * Distance from the node's `y` to the top of lowercase x (px).
     */
    readonly x_top: number;
}

/**
 * The engine: holds a renderer (with the bundled default font) and rasterizes
 * scene-graph JSON to frames. Construct once and reuse across frames.
 */
export class OndaEngine {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * World-space (canvas-coordinate) bounds of every identified node in a scene —
     * the geometry a host's selection overlay needs to put its boxes exactly where
     * the engine drew each element (re-frames, layout, and animation transforms all
     * already applied). Runs the SAME flex-layout pre-pass as `render` so laid-out
     * components report their resolved boxes; skips image decode (bounds use the
     * layout box). Returns a flat `Float64Array`: `[id, x, y, width, height, …]`
     * (one 5-tuple per identified node). Pair with `render` for the same frame.
     */
    elementBounds(scene_json: string): Float64Array;
    /**
     * Font-level vertical metrics for `font_size` + optional family/weight/italic.
     * Derived by rasterizing 'H' (cap height) and 'x' (x-height) — pixel-accurate
     * for the actual rendered font. Call once per (size, family, weight) combo, not
     * per frame. Use the returned `capTop`/`capHeight` to vertically center text
     * without empirical guesswork.
     */
    fontMetrics(font_size: number, family?: string | null, weight?: number | null, italic?: boolean | null): FontMetricsJs;
    /**
     * Kerning-aware glyph layout for `content` at `font_size`. Returns a
     * `Float32Array` with 4 floats per cluster: `[start_byte, end_byte, x, advance]`.
     * Unlike calling `measureText` per character, `advance` includes kern pairs.
     * Slice with stride 4; the total advance sum equals the shaped line width.
     */
    glyphLayout(content: string, font_size: number, family?: string | null, weight?: number | null, italic?: boolean | null, letter_spacing?: number | null): Float32Array;
    /**
     * Load an additional font (`.ttf`/`.otf` bytes) so text can select it by
     * family (e.g. a brand display face for kinetic typography). Returns the
     * family name(s) it provides, newline-joined. Loaded into BOTH the renderer
     * (which draws the glyphs) and the layout/measurement font context, so
     * author-time `measureText`/`glyphLayout`/`fontMetrics` — and therefore
     * `<TextAnimator>`/`KineticText` glyph placement — match what the engine
     * draws. This is the custom-font parity guarantee: same bytes, same shaping,
     * for measure and render. Mirrors `VelloEngine::load_font`.
     */
    loadFont(data: Uint8Array): string;
    /**
     * Measure `content` at `font_size` (px) with optional family / weight /
     * italic, returning its [`TextMetricsJs`]. The same shaping the engine draws,
     * so a component can size underlines/pills/carets to the real text — in both
     * the browser preview and (warmed once) the Node export path.
     */
    measureText(content: string, font_size: number, family?: string | null, weight?: number | null, italic?: boolean | null, letter_spacing?: number | null): TextMetricsJs;
    constructor();
    /**
     * Render a scene-graph JSON document (onda-scene format) to a frame.
     * Resolves `data:` images and flex layout first (the same pre-passes the
     * CLI runs), so an in-browser preview matches `onda export`.
     */
    render(scene_json: string): RenderedFrame;
    /**
     * Flatten any NLE timeline to the active clip's plain Video at composition
     * `frame`, returning the resolved scene JSON — the same resolution `onda
     * export` runs natively. A preview host calls this BEFORE its video-decode
     * step (to learn which clip + source-time to seek), then decodes and renders.
     * No-op for scenes without a timeline.
     */
    resolveTimeline(scene_json: string, frame: number): string;
}

/**
 * A rendered frame: RGBA8 pixels plus dimensions.
 */
export class RenderedFrame {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    readonly height: number;
    /**
     * Straight-alpha RGBA8 bytes (`width * height * 4`), ready for an
     * `ImageData` and `putImageData`.
     */
    readonly pixels: Uint8Array;
    readonly width: number;
}

/**
 * Rendered text dimensions ([`onda_renderer::TextMetrics`]) for JS — what a
 * component needs to size things to the *actual* text (proportional advance,
 * ascent/descent) instead of a glyph-count guess. Pixels at the measured size.
 */
export class TextMetricsJs {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Top of the line box to the baseline.
     */
    readonly ascent: number;
    /**
     * Baseline to the bottom of the line box.
     */
    readonly descent: number;
    /**
     * Total laid-out height (line height × line count).
     */
    readonly height: number;
    /**
     * Baseline-to-baseline line height.
     */
    readonly lineHeight: number;
    /**
     * Shaped advance width — the true rendered width of the string.
     */
    readonly width: number;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_fontmetricsjs_free: (a: number, b: number) => void;
    readonly __wbg_ondaengine_free: (a: number, b: number) => void;
    readonly __wbg_renderedframe_free: (a: number, b: number) => void;
    readonly __wbg_textmetricsjs_free: (a: number, b: number) => void;
    readonly fontmetricsjs_ascent: (a: number) => number;
    readonly fontmetricsjs_cap_height: (a: number) => number;
    readonly fontmetricsjs_cap_top: (a: number) => number;
    readonly fontmetricsjs_descent: (a: number) => number;
    readonly fontmetricsjs_lineHeight: (a: number) => number;
    readonly fontmetricsjs_x_height: (a: number) => number;
    readonly fontmetricsjs_x_top: (a: number) => number;
    readonly ondaengine_elementBounds: (a: number, b: number, c: number) => [number, number, number, number];
    readonly ondaengine_fontMetrics: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly ondaengine_glyphLayout: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => [number, number];
    readonly ondaengine_loadFont: (a: number, b: number, c: number) => [number, number];
    readonly ondaengine_measureText: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => number;
    readonly ondaengine_new: () => number;
    readonly ondaengine_render: (a: number, b: number, c: number) => [number, number, number];
    readonly ondaengine_resolveTimeline: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly renderedframe_height: (a: number) => number;
    readonly renderedframe_pixels: (a: number) => [number, number];
    readonly renderedframe_width: (a: number) => number;
    readonly textmetricsjs_ascent: (a: number) => number;
    readonly textmetricsjs_descent: (a: number) => number;
    readonly textmetricsjs_height: (a: number) => number;
    readonly textmetricsjs_lineHeight: (a: number) => number;
    readonly textmetricsjs_width: (a: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
