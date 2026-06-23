/* tslint:disable */
/* eslint-disable */

/**
 * A rendered frame: straight-alpha RGBA8 pixels (`width * height * 4`) plus
 * dimensions — ready for an `ImageData` + `putImageData`.
 */
export class RenderedFrame {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    readonly height: number;
    readonly pixels: Uint8Array;
    readonly width: number;
}

/**
 * The GPU engine: holds a Vello renderer bound to a WebGPU device. Build it
 * once with [`VelloEngine::create`] (async — it acquires the GPU), then reuse
 * it across frames.
 */
export class VelloEngine {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Acquire a WebGPU device and build the renderer. Async (returns a JS
     * `Promise`); rejects when WebGPU is unavailable so the caller can fall
     * back to the CPU engine or Canvas2D.
     */
    static create(): Promise<VelloEngine>;
    /**
     * Load an additional font (`.ttf`/`.otf` bytes) so text can select it by
     * family (e.g. a premium display face for Apple-tier type). Returns the
     * family name(s) it provides, newline-joined. Loaded into BOTH the renderer
     * (which draws the glyphs) and the layout/measurement font context, so the
     * in-browser preview's text metrics match what it draws.
     */
    load_font(data: Uint8Array): string;
    /**
     * Render a scene-graph JSON document (onda-scene format) to a frame.
     * Resolves `data:` images and flex layout first (the same pre-passes the
     * CLI runs), so an in-browser preview matches `onda export`. Async: the GPU
     * readback awaits the buffer map rather than blocking.
     */
    render(scene_json: string): Promise<RenderedFrame>;
    /**
     * Flatten any NLE timeline to the active clip's plain Video at composition
     * `frame`, returning the resolved scene JSON — the same resolution `onda
     * export` runs natively. A preview host calls this BEFORE its video-decode
     * step (to learn which clip + source-time to seek), then decodes and renders.
     * No-op for scenes without a timeline.
     */
    resolveTimeline(scene_json: string, frame: number): string;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_renderedframe_free: (a: number, b: number) => void;
    readonly __wbg_velloengine_free: (a: number, b: number) => void;
    readonly renderedframe_height: (a: number) => number;
    readonly renderedframe_pixels: (a: number) => [number, number];
    readonly renderedframe_width: (a: number) => number;
    readonly velloengine_create: () => any;
    readonly velloengine_load_font: (a: number, b: number, c: number) => [number, number];
    readonly velloengine_render: (a: number, b: number, c: number) => any;
    readonly velloengine_resolveTimeline: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly wasm_bindgen__convert__closures_____invoke__h409cd443445aef66: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen__convert__closures_____invoke__h8ee04bbad4a2516c: (a: number, b: number, c: any, d: any) => void;
    readonly wasm_bindgen__convert__closures_____invoke__h0433b6ab806a8583: (a: number, b: number, c: any) => void;
    readonly wasm_bindgen__convert__closures_____invoke__h0433b6ab806a8583_2: (a: number, b: number, c: any) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_destroy_closure: (a: number, b: number) => void;
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
